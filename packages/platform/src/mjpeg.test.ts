import { describe, expect, it } from 'vitest';
import { MjpegParser } from './mjpeg';

const part = (body: string) =>
  new TextEncoder().encode(
    `--lefi-frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${body.length}\r\n\r\n${body}\r\n`,
  );

describe('MJPEG parser', () => {
  it('returns whole frames whatever the chunk sizes, even with boundary-like bytes inside', () => {
    const all = new Uint8Array([...part('one'), ...part('t\r\n\r\n--lefi-frame wo')]);
    const p = new MjpegParser();
    const out: string[] = [];
    for (let i = 0; i < all.length; i += 5) {
      p.push(all.subarray(i, i + 5));
      for (let f = p.next(); f; f = p.next()) out.push(new TextDecoder().decode(f));
    }
    expect(out).toEqual(['one', 't\r\n\r\n--lefi-frame wo']);
  });

  it('refuses a part without a length', () => {
    const p = new MjpegParser();
    p.push(new TextEncoder().encode('--lefi-frame\r\nContent-Type: image/jpeg\r\n\r\nxx'));
    expect(() => p.next()).toThrow();
  });
});
