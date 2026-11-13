"""Zone markers (QR codes) in an image, read with Apple's Vision framework (ADR-088). macOS only.

Blocking: called from a worker thread. The image never leaves Lefi Brain's PC.
"""

from __future__ import annotations

import sys
from typing import Any

from lefi_brain.modules.cameras.domain import CameraError, Marker


class VisionMarkerReader:
    def __init__(self) -> None:
        import Vision
        from Foundation import NSData

        self._vision: Any = Vision
        self._nsdata: Any = NSData

    def read(self, image: bytes) -> list[Marker]:
        v = self._vision
        data = self._nsdata.dataWithBytes_length_(image, len(image))
        request = v.VNDetectBarcodesRequest.alloc().init()
        request.setSymbologies_([v.VNBarcodeSymbologyQR])
        handler = v.VNImageRequestHandler.alloc().initWithData_options_(data, None)
        ok, err = handler.performRequests_error_([request], None)
        if not ok:
            raise CameraError(f"the zone markers could not be read: {err}")
        out: list[Marker] = []
        for o in request.results() or []:
            payload = o.payloadStringValue()
            if not payload:
                continue
            b = o.boundingBox()  # normalised, origin bottom-left
            x, y, w, h = b.origin.x, b.origin.y, b.size.width, b.size.height
            out.append(Marker(str(payload), float(x), float(1.0 - y - h), float(w), float(h)))
        return out


class UnavailableMarkerReader:
    def __init__(self, reason: str) -> None:
        self._reason = reason

    def read(self, image: bytes) -> list[Marker]:
        raise CameraError(self._reason)


def default_markers() -> VisionMarkerReader | UnavailableMarkerReader:
    if sys.platform != "darwin":
        return UnavailableMarkerReader(
            f"reading zone markers is built for macOS only; this Lefi Brain runs on {sys.platform}"
        )
    try:
        return VisionMarkerReader()
    except ImportError as exc:
        return UnavailableMarkerReader(f"Apple's Vision framework is not available: {exc}")
