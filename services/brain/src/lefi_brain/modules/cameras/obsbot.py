"""What Lefi Brain may send to an OBSBOT Tiny 2 Lite, and how it is encoded (ADR-073, ADR-074).
Pure: builds bytes, never sends them.

Two channels on the camera's control endpoint:
- **standard UVC** camera-terminal controls (unit 1): pan/tilt absolute (selector 0x0D, arc-seconds)
  and zoom absolute (selector 0x0B) — the camera reports their own ranges;
- the **OBSBOT vendor extension unit** (unit 2, GUID {9A1E7291-6843-4683-6D92-39BC7906EE49}),
  selector 2, 60-byte "V3" frames. Only three commands are allowed here: wake, sleep, recenter.
  Their encoding comes from the MIT project lxman/obsbot-mcp (PROTOCOL.md, tiny2_specification.md),
  which reports them working on the Tiny 2 Lite; each one was also tried on the owner's camera
  before being allowed. Nothing else of the vendor command surface is ever sent: probing unknown
  opcodes has taken these cameras off the USB bus.
"""

from __future__ import annotations

import struct

UNIT_CAMERA = 1
UNIT_VENDOR = 2
SEL_ZOOM_ABS = 0x0B
SEL_PANTILT_ABS = 0x0D
SEL_VENDOR = 0x02
ARCSEC = 3600  # UVC pan/tilt unit: 1/3600 degree

FRAME_LEN = 60
HOST = 0x0A
CMD_SET_DEV_STATUS = 0xA0C2  # receiver 0x02 (camera): wake / sleep
CMD_GIMBAL_RECENTER = 0x00C3  # receiver 0x03 (gimbal)


def crc16_usb(data: bytes) -> int:
    """CRC-16/USB: poly 0xA001 (reflected), init 0xFFFF, xorout 0xFFFF."""
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc ^ 0xFFFF


def v3_frame(seq: int, cmd: int, payload: bytes) -> bytes:
    """A SET frame (flags 0x25) with its nested payload segment; receiver = cmd & 0x3F."""
    if len(payload) > FRAME_LEN - 16:
        raise ValueError("payload too long")
    f = bytearray(FRAME_LEN)
    f[0], f[1] = 0xAA, 0x25
    struct.pack_into("<HH", f, 2, seq & 0xFFFF, 12)
    f[8], f[9] = HOST, cmd & 0x3F
    struct.pack_into("<H", f, 10, cmd)
    struct.pack_into("<H", f, 6, crc16_usb(bytes(f[:12])))
    if payload:
        struct.pack_into("<H", f, 12, len(payload))
        f[16 : 16 + len(payload)] = payload
        struct.pack_into("<H", f, 14, crc16_usb(bytes(f[12 : 16 + len(payload)])))
    return bytes(f)


def wake_frame(seq: int) -> bytes:
    return v3_frame(seq, CMD_SET_DEV_STATUS, bytes([0, 0, 0, 0]))


def sleep_frame(seq: int) -> bytes:
    return v3_frame(seq, CMD_SET_DEV_STATUS, bytes([1, 0, 0, 0]))


def recenter_frame(seq: int) -> bytes:
    return v3_frame(seq, CMD_GIMBAL_RECENTER, bytes(6))


def pantilt_bytes(pan_deg: float, tilt_deg: float) -> bytes:
    return struct.pack("<ii", round(pan_deg * ARCSEC), round(tilt_deg * ARCSEC))


def parse_pantilt(raw: bytes) -> tuple[float, float]:
    if len(raw) < 8:
        raise ValueError("pan/tilt answer too short")
    pan, tilt = struct.unpack_from("<ii", raw)
    return pan / ARCSEC, tilt / ARCSEC


def zoom_bytes(units: int) -> bytes:
    return struct.pack("<H", units)


def parse_zoom(raw: bytes) -> int:
    if len(raw) < 2:
        raise ValueError("zoom answer too short")
    return int(struct.unpack_from("<H", raw)[0])


# A position is (pan°, tilt°, zoom). The camera reports position in 1° steps while it moves.
Position = tuple[float, float, float]
REACHED_WITHIN = 1.0  # degrees / zoom units: the camera settles to ±1° (UVC GET_RES = 1°)
STILL_READS = 3  # equal reads in a row = not moving
NO_MOTION_READS = 6  # nothing moved for this many reads: nothing is going to


def at_rest(reads: list[Position], target: dict[str, float] | None = None) -> bool:
    """Whether the camera has finished a command, from the positions read since it was sent.
    With a target: reached it and still. Without: still after having moved, or never moved."""
    if len(reads) < 2:
        return False
    last = reads[-1]
    still = len(reads) >= STILL_READS and all(r == last for r in reads[-STILL_READS:])
    if target is not None:
        axes = {"pan": 0, "tilt": 1, "zoom": 2}
        reached = all(abs(last[axes[k]] - v) <= REACHED_WITHIN for k, v in target.items())
        return reached and reads[-2] == last
    moved = any(r != reads[0] for r in reads)
    return still and (moved or len(reads) >= NO_MOTION_READS)
