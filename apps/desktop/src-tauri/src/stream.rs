//! A camera's live video from Lefi Brain (ADR-079): `GET /api/v1/cameras/{id}/stream` is MJPEG
//! (`multipart/x-mixed-replace`), read here through the same pinned, paired connection as every
//! other request (ADR-022) and handed to the WebView one JPEG at a time over a binary channel.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::error::{AppError, AppResult};

const MAX_FRAME: usize = 8 * 1024 * 1024;
const MAX_BUFFER: usize = 16 * 1024 * 1024;

/// Splits an MJPEG body (each part has a `Content-Length`) into JPEGs.
#[derive(Default)]
pub struct MjpegParser {
    buf: Vec<u8>,
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

impl MjpegParser {
    pub fn push(&mut self, chunk: &[u8]) -> AppResult<()> {
        self.buf.extend_from_slice(chunk);
        if self.buf.len() > MAX_BUFFER {
            return Err(AppError::InvalidRequest(
                "camera stream: part too large".into(),
            ));
        }
        Ok(())
    }

    /// The next complete JPEG, if the buffer holds one.
    pub fn next_frame(&mut self) -> AppResult<Option<Vec<u8>>> {
        let Some(head_end) = find(&self.buf, b"\r\n\r\n") else {
            return Ok(None);
        };
        let head = String::from_utf8_lossy(&self.buf[..head_end]).to_string();
        let length = head
            .lines()
            .find_map(|l| {
                let (k, v) = l.split_once(':')?;
                k.trim()
                    .eq_ignore_ascii_case("content-length")
                    .then(|| v.trim().parse::<usize>().ok())
                    .flatten()
            })
            .ok_or_else(|| AppError::InvalidRequest("camera stream: part without length".into()))?;
        if length > MAX_FRAME {
            return Err(AppError::InvalidRequest(
                "camera stream: frame too large".into(),
            ));
        }
        let start = head_end + 4;
        if self.buf.len() < start + length {
            return Ok(None);
        }
        let frame = self.buf[start..start + length].to_vec();
        self.buf.drain(..start + length);
        Ok(Some(frame))
    }
}

/// Open streams, so the WebView can stop one (closing the camera panel).
#[derive(Default)]
pub struct Streams(Mutex<HashMap<u32, Arc<tokio::sync::Notify>>>);

impl Streams {
    pub fn open(&self, id: u32) -> Arc<tokio::sync::Notify> {
        let stop = Arc::new(tokio::sync::Notify::new());
        let mut map = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(old) = map.insert(id, stop.clone()) {
            old.notify_one();
        }
        stop
    }

    pub fn close(&self, id: u32) {
        let mut map = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(stop) = map.remove(&id) {
            stop.notify_one();
        }
    }
}

pub fn valid_camera_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 32
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn part(jpeg: &[u8]) -> Vec<u8> {
        let mut p = format!(
            "--lefi-frame\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\nX-Captured-At: 1.0\r\n\r\n",
            jpeg.len()
        )
        .into_bytes();
        p.extend_from_slice(jpeg);
        p.extend_from_slice(b"\r\n");
        p
    }

    #[test]
    fn frames_come_out_whole_whatever_the_chunks() {
        let mut body = part(b"\xff\xd8one\xff\xd9");
        body.extend(part(b"\xff\xd8two\r\n\r\n--lefi-frame\xff\xd9")); // boundary-like bytes inside
        let mut p = MjpegParser::default();
        let mut out = vec![];
        for chunk in body.chunks(7) {
            p.push(chunk).unwrap();
            while let Some(f) = p.next_frame().unwrap() {
                out.push(f);
            }
        }
        assert_eq!(out.len(), 2);
        assert_eq!(out[0], b"\xff\xd8one\xff\xd9");
        assert!(out[1].ends_with(b"\xff\xd9"));
    }

    #[test]
    fn a_part_without_length_or_too_big_is_refused() {
        let mut p = MjpegParser::default();
        p.push(b"--lefi-frame\r\nContent-Type: image/jpeg\r\n\r\nxx")
            .unwrap();
        assert!(p.next_frame().is_err());
        let mut p = MjpegParser::default();
        p.push(b"--lefi-frame\r\nContent-Length: 999999999\r\n\r\n")
            .unwrap();
        assert!(p.next_frame().is_err());
    }

    #[test]
    fn only_plain_camera_ids_reach_a_path() {
        assert!(valid_camera_id("cam-01"));
        for bad in ["", "../x", "cam/01", "cam 01", "a?b=1", &"x".repeat(33)] {
            assert!(!valid_camera_id(bad), "{bad}");
        }
    }
}
