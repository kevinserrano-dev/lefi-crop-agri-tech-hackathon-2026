"""Frames from a USB camera on macOS through AVFoundation (PyObjC), for the preview (ADR-074).

A capture session runs only while someone looks: it starts on the first frame asked for and
stops after `IDLE_STOP_S` without requests, so the camera is not kept busy (and its light off).
Preview frames (≤ 960 px, up to 25 a second for the live stream) are kept in memory only; a photo
(ADR-079) is the next full-resolution frame, handed to the caller who stores it. macOS asks the
person at the Mac for camera permission the first time; until then frames are refused, with why.
"""

from __future__ import annotations

import threading
import time
from typing import Any

from lefi_brain.modules.cameras.domain import Frame

IDLE_STOP_S = 30.0
ENCODE_EVERY_S = 0.04  # at most 25 preview JPEGs a second (the live stream), whatever the camera
PREVIEW_WIDTH = 960
JPEG_QUALITY = 0.6
PHOTO_QUALITY = 0.88


class CaptureError(Exception):
    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message)
        self.reason = reason  # permission_denied · permission_pending · not_found · failed


def av_unique_id(vendor_id: int, product_id: int, location: str) -> str:
    """macOS names a UVC camera `0x<locationID><vid><pid>` (seen on the OBSBOT Tiny 2 Lite:
    `0x21000003564fef9` for locationID 0x02100000)."""
    return f"0x{int(location, 16):x}{vendor_id:04x}{product_id:04x}"


def _frameworks() -> tuple[Any, Any, Any, Any]:
    try:
        import AVFoundation
        import CoreMedia  # noqa: F401  (loads CMSampleBuffer functions)
        import objc
        import Quartz
        from Foundation import NSObject
    except ImportError as exc:  # not macOS, or PyObjC missing
        raise CaptureError("video capture is built for macOS only so far", "failed") from exc
    return AVFoundation, Quartz, NSObject, objc


_delegate_class: Any = None


def _delegate_cls() -> Any:
    global _delegate_class
    if _delegate_class is not None:
        return _delegate_class
    _, quartz, nsobject, objc = _frameworks()
    import CoreMedia

    class LefiFrameSink(nsobject):  # type: ignore[misc, valid-type]
        def init(self) -> Any:
            self = objc.super(LefiFrameSink, self).init()
            if self is None:
                return None
            self.latest: Frame | None = None
            self.failure: str | None = None
            self.want_photo = False
            self.photo: Frame | None = None
            self.last_encode = 0.0
            self.ctx = quartz.CIContext.contextWithOptions_(None)
            return self

        def captureOutput_didOutputSampleBuffer_fromConnection_(
            self, _output: Any, sample: Any, _conn: Any
        ) -> None:
            # Runs on AVFoundation's queue: an exception escaping here would end the whole
            # Lefi Brain process, so nothing may escape.
            try:
                self.encode(sample)
            except Exception as exc:
                self.failure = repr(exc)[:200]

        @objc.python_method  # type: ignore[untyped-decorator]
        def encode(self, sample: Any) -> None:
            now = time.time()
            photo = self.want_photo
            if not photo and now - self.last_encode < ENCODE_EVERY_S:
                return
            pixels = CoreMedia.CMSampleBufferGetImageBuffer(sample)
            if pixels is None:
                return
            image = quartz.CIImage.imageWithCVPixelBuffer_(pixels)
            extent = image.extent()
            w, h = extent.size.width, extent.size.height
            if photo:
                full = self.ctx.JPEGRepresentationOfImage_colorSpace_options_(
                    image,
                    quartz.CGColorSpaceCreateWithName(quartz.kCGColorSpaceSRGB),
                    {quartz.kCGImageDestinationLossyCompressionQuality: PHOTO_QUALITY},
                )
                if full is not None:
                    self.photo = Frame(bytes(full), int(w), int(h), now)
                    self.want_photo = False
                return
            self.last_encode = now
            if w > PREVIEW_WIDTH:
                k = PREVIEW_WIDTH / w
                image = image.imageByApplyingTransform_(quartz.CGAffineTransformMakeScale(k, k))
                w, h = w * k, h * k
            data = self.ctx.JPEGRepresentationOfImage_colorSpace_options_(
                image,
                quartz.CGColorSpaceCreateWithName(quartz.kCGColorSpaceSRGB),
                {quartz.kCGImageDestinationLossyCompressionQuality: JPEG_QUALITY},
            )
            if data is not None:
                self.latest = Frame(bytes(data), int(w), int(h), now)

    _delegate_class = LefiFrameSink
    return _delegate_class


class _Session:
    def __init__(self, unique_id: str) -> None:
        av, _, _, _ = _frameworks()
        device = av.AVCaptureDevice.deviceWithUniqueID_(unique_id)
        if device is None:
            raise CaptureError("macOS does not list this camera for video", "not_found")
        session = av.AVCaptureSession.alloc().init()
        # 1080p for photos; the live preview is scaled down to PREVIEW_WIDTH.
        for preset in (av.AVCaptureSessionPreset1920x1080, av.AVCaptureSessionPreset1280x720):
            if session.canSetSessionPreset_(preset):
                session.setSessionPreset_(preset)
                break
        camera_input, error = av.AVCaptureDeviceInput.deviceInputWithDevice_error_(device, None)
        if camera_input is None or not session.canAddInput_(camera_input):
            raise CaptureError(f"cannot open the camera for video: {error}", "failed")
        session.addInput_(camera_input)
        output = av.AVCaptureVideoDataOutput.alloc().init()
        output.setAlwaysDiscardsLateVideoFrames_(True)
        import dispatch  # PyObjC libdispatch bindings

        self.queue = dispatch.dispatch_queue_create(b"ai.leficrop.camera", None)
        self.sink = _delegate_cls().alloc().init()
        output.setSampleBufferDelegate_queue_(self.sink, self.queue)
        if not session.canAddOutput_(output):
            raise CaptureError("cannot read frames from the camera", "failed")
        session.addOutput_(output)
        session.startRunning()
        self.session = session
        self.last_request = time.time()

    def stop(self) -> None:
        self.session.stopRunning()


class AvCapture:
    """One capture session per camera at most, shared by every viewer."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: dict[str, _Session] = {}
        self._reaper: threading.Thread | None = None

    def permission(self) -> str:
        """`granted`, `denied`, `restricted` or `not_determined` (macOS's own answer)."""
        av, _, _, _ = _frameworks()
        status = av.AVCaptureDevice.authorizationStatusForMediaType_(av.AVMediaTypeVideo)
        return {0: "not_determined", 1: "restricted", 2: "denied", 3: "granted"}.get(
            int(status), "denied"
        )

    def _ask(self) -> None:
        av, _, _, _ = _frameworks()
        av.AVCaptureDevice.requestAccessForMediaType_completionHandler_(
            av.AVMediaTypeVideo, lambda _granted: None
        )

    def frame(self, unique_id: str, wait_s: float = 3.0) -> Frame:
        """The newest frame (blocking up to `wait_s` while a new session warms up)."""
        session = self._session(unique_id)
        deadline = time.time() + wait_s
        while True:
            latest: Frame | None = session.sink.latest
            if latest is not None:
                return latest
            if time.time() > deadline:
                why = session.sink.failure
                raise CaptureError(
                    f"no image could be made: {why}" if why else "the camera sent no image",
                    "failed",
                )
            time.sleep(0.05)

    def photo(self, unique_id: str, wait_s: float = 4.0) -> Frame:
        """The next full-resolution frame (a new one, never one taken before the request)."""
        self.frame(unique_id, wait_s)  # the session runs and delivers frames
        session = self._session(unique_id)
        session.sink.photo = None
        session.sink.want_photo = True
        deadline = time.time() + wait_s
        while True:
            taken: Frame | None = session.sink.photo
            if taken is not None:
                session.sink.photo = None
                return taken
            if time.time() > deadline:
                session.sink.want_photo = False
                raise CaptureError("the camera did not deliver a photo in time", "failed")
            time.sleep(0.02)

    def _session(self, unique_id: str) -> _Session:
        state = self.permission()
        if state == "not_determined":
            self._ask()
            raise CaptureError(
                "macOS is asking for camera permission on Lefi Brain's Mac: allow it there",
                "permission_pending",
            )
        if state != "granted":
            raise CaptureError(
                "macOS does not allow Lefi Brain to use the camera: System Settings → Privacy & "
                "Security → Camera",
                "permission_denied",
            )
        with self._lock:
            session = self._sessions.get(unique_id)
            if session is None:
                session = _Session(unique_id)
                self._sessions[unique_id] = session
                self._start_reaper()
            session.last_request = time.time()
        return session

    def stop(self, unique_id: str) -> None:
        with self._lock:
            session = self._sessions.pop(unique_id, None)
        if session:
            session.stop()

    def close(self) -> None:
        with self._lock:
            sessions, self._sessions = list(self._sessions.values()), {}
        for s in sessions:
            s.stop()

    def _start_reaper(self) -> None:
        if self._reaper and self._reaper.is_alive():
            return

        def reap() -> None:
            while True:
                time.sleep(5)
                with self._lock:
                    idle = [
                        k
                        for k, s in self._sessions.items()
                        if time.time() - s.last_request > IDLE_STOP_S
                    ]
                    stopped = [self._sessions.pop(k) for k in idle]
                    empty = not self._sessions
                for s in stopped:
                    s.stop()
                if empty:
                    return

        self._reaper = threading.Thread(target=reap, name="camera-idle-stop", daemon=True)
        self._reaper.start()
