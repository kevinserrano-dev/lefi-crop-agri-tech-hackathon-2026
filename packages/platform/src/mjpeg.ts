/** Splits an MJPEG body (`multipart/x-mixed-replace`, each part with a Content-Length) into
 * JPEGs. Same rules as the Rust parser in Lefi Desktop (ADR-079). */
const MAX_FRAME = 8 * 1024 * 1024;
const enc = new TextEncoder();
const HEAD_END = enc.encode('\r\n\r\n');

function indexOf(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export class MjpegParser {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): void {
    const next = new Uint8Array(this.buf.length + chunk.length);
    next.set(this.buf);
    next.set(chunk, this.buf.length);
    this.buf = next;
  }

  /** The next complete JPEG, or null until more bytes arrive. Throws on a malformed part. */
  next(): Uint8Array | null {
    const end = indexOf(this.buf, HEAD_END);
    if (end < 0) return null;
    const head = new TextDecoder().decode(this.buf.subarray(0, end));
    const m = /content-length:\s*(\d+)/i.exec(head);
    if (!m) throw new Error('camera stream: part without length');
    const length = Number(m[1]);
    if (length > MAX_FRAME) throw new Error('camera stream: frame too large');
    const start = end + 4;
    if (this.buf.length < start + length) return null;
    const frame = this.buf.slice(start, start + length);
    this.buf = this.buf.slice(start + length);
    return frame;
  }
}
