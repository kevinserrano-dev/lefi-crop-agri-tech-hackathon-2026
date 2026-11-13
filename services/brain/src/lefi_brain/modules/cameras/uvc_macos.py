"""UVC control requests to a USB camera on macOS, through IOKit (ctypes, no extra package).

macOS keeps the camera as a normal webcam (its UVC driver owns the interfaces), but the USB
*device* can still be opened and class requests sent on its control endpoint (ADR-073, verified on
the OBSBOT Tiny 2 Lite). Only the requests built in `obsbot.py` are ever sent: an allowlist.
Blocking calls: run them in a worker thread.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import sys
import threading
import uuid
from ctypes import (
    POINTER,
    Structure,
    byref,
    c_char_p,
    c_int32,
    c_uint8,
    c_uint16,
    c_uint32,
    c_void_p,
)

GET_CUR, GET_MIN, GET_MAX, GET_RES, GET_INFO = 0x81, 0x82, 0x83, 0x84, 0x86
SET_CUR = 0x01


class UsbControlError(Exception):
    """The camera could not be reached or refused the request."""


class _CFUUIDBytes(Structure):
    _fields_ = [(f"b{i}", c_uint8) for i in range(16)]


class _DevRequest(Structure):
    _fields_ = [
        ("bmRequestType", c_uint8),
        ("bRequest", c_uint8),
        ("wValue", c_uint16),
        ("wIndex", c_uint16),
        ("wLength", c_uint16),
        ("pData", c_void_p),
        ("wLenDone", c_uint32),
    ]


def _uuid_bytes(text: str) -> _CFUUIDBytes:
    return _CFUUIDBytes(*uuid.UUID(text).bytes)


# IOKit plug-in ids (IOKit/usb/IOUSBLib.h, IOKit/IOCFPlugIn.h)
_USB_DEVICE_USER_CLIENT = "9dc7b780-9ec0-11d4-a54f-000a27052861"
_CF_PLUGIN_INTERFACE = "c244e858-109c-11d4-91d4-0050e4c6426f"
_USB_DEVICE_INTERFACE = "5c8187d0-9ef3-11d4-8b45-000a27052861"

# Slots in the IOUSBDeviceInterface vtable (IUnknown first: 0 reserved, 1 QI, 2 AddRef, 3 Release)
_QI, _RELEASE = 1, 3
_OPEN, _CLOSE, _VENDOR, _PRODUCT, _LOCATION, _DEVICE_REQUEST = 8, 9, 13, 14, 20, 26
_EXCLUSIVE_ACCESS = 0xE00002C5 - (1 << 32)  # kIOReturnExclusiveAccess as int32


class _IOKit:
    """Lazily loaded frameworks (importing this module never touches IOKit)."""

    _lock = threading.Lock()
    _loaded: _IOKit | None = None

    def __init__(self) -> None:
        iokit = ctypes.cdll.LoadLibrary(ctypes.util.find_library("IOKit") or "IOKit")
        cf = ctypes.cdll.LoadLibrary(ctypes.util.find_library("CoreFoundation") or "CF")
        self.iokit, self.cf = iokit, cf
        cf.CFStringCreateWithCString.restype = c_void_p
        cf.CFStringCreateWithCString.argtypes = [c_void_p, c_char_p, c_uint32]
        cf.CFNumberCreate.restype = c_void_p
        cf.CFNumberCreate.argtypes = [c_void_p, c_int32, c_void_p]
        cf.CFDictionarySetValue.argtypes = [c_void_p, c_void_p, c_void_p]
        cf.CFRelease.argtypes = [c_void_p]
        iokit.IOServiceMatching.restype = c_void_p
        iokit.IOServiceMatching.argtypes = [c_char_p]
        iokit.IOServiceGetMatchingService.restype = c_uint32
        iokit.IOServiceGetMatchingService.argtypes = [c_uint32, c_void_p]
        iokit.IOObjectRelease.argtypes = [c_uint32]
        iokit.IOCreatePlugInInterfaceForService.restype = c_int32
        iokit.IOCreatePlugInInterfaceForService.argtypes = [
            c_uint32,
            c_void_p,
            c_void_p,
            POINTER(c_void_p),
            POINTER(c_int32),
        ]
        cf.CFUUIDGetConstantUUIDWithBytes.restype = c_void_p
        cf.CFUUIDGetConstantUUIDWithBytes.argtypes = [c_void_p] + [c_uint8] * 16

    @classmethod
    def get(cls) -> _IOKit:
        if sys.platform != "darwin":
            raise UsbControlError("camera control is built for macOS only so far")
        with cls._lock:
            if cls._loaded is None:
                cls._loaded = _IOKit()
            return cls._loaded

    def cf_uuid(self, text: str) -> int:
        return int(self.cf.CFUUIDGetConstantUUIDWithBytes(None, *uuid.UUID(text).bytes))

    def cf_str(self, s: str) -> int:
        return int(self.cf.CFStringCreateWithCString(None, s.encode(), 0x08000100))

    def cf_int(self, v: int) -> int:
        n = c_int32(v)
        return int(self.cf.CFNumberCreate(None, 3, byref(n)))  # kCFNumberSInt32Type


def _method(obj: c_void_p, slot: int, restype: type, *argtypes: type) -> object:
    """A function from a COM-style IOKit interface: obj -> *vtable -> slot."""
    vtable = ctypes.cast(obj, POINTER(POINTER(c_void_p))).contents
    proto = ctypes.CFUNCTYPE(restype, c_void_p, *argtypes)
    return proto(vtable[slot])


class UvcDevice:
    """One opened USB camera. Use as a context manager; every call is synchronous."""

    def __init__(self, vendor_id: int, product_id: int, location: int) -> None:
        self._vid, self._pid, self._loc = vendor_id, product_id, location
        self._dev: c_void_p | None = None
        self._opened = False

    def __enter__(self) -> UvcDevice:
        k = _IOKit.get()
        matching = k.iokit.IOServiceMatching(b"IOUSBHostDevice")
        if not matching:
            raise UsbControlError("IOKit matching failed")
        for key, value in (
            ("idVendor", self._vid),
            ("idProduct", self._pid),
            ("locationID", self._loc),
        ):
            ks, vs = k.cf_str(key), k.cf_int(value)
            k.cf.CFDictionarySetValue(matching, ks, vs)
            k.cf.CFRelease(ks)
            k.cf.CFRelease(vs)
        service = k.iokit.IOServiceGetMatchingService(0, matching)  # consumes `matching`
        if not service:
            raise UsbControlError("the camera is not plugged in at that USB port")
        try:
            plugin = c_void_p()
            score = c_int32()
            kr = k.iokit.IOCreatePlugInInterfaceForService(
                service,
                c_void_p(k.cf_uuid(_USB_DEVICE_USER_CLIENT)),
                c_void_p(k.cf_uuid(_CF_PLUGIN_INTERFACE)),
                byref(plugin),
                byref(score),
            )
            if kr != 0 or not plugin:
                raise UsbControlError(
                    f"cannot open the camera's USB device (0x{kr & 0xFFFFFFFF:x})"
                )
        finally:
            k.iokit.IOObjectRelease(service)
        dev = c_void_p()
        qi = _method(plugin, _QI, c_int32, _CFUUIDBytes, POINTER(c_void_p))
        res = qi(plugin, _uuid_bytes(_USB_DEVICE_INTERFACE), byref(dev))  # type: ignore[operator]
        _method(plugin, _RELEASE, c_uint32)(plugin)  # type: ignore[operator]
        if res != 0 or not dev:
            raise UsbControlError("the camera's USB device has no device interface")
        self._dev = dev
        vendor = c_uint16()
        _method(dev, _VENDOR, c_int32, POINTER(c_uint16))(dev, byref(vendor))  # type: ignore[operator]
        if vendor.value != self._vid:  # vtable layout check before any request is sent
            self.__exit__(None, None, None)
            raise UsbControlError("unexpected USB device interface layout")
        kr = _method(dev, _OPEN, c_int32)(dev)  # type: ignore[operator]
        # Exclusive access = macOS's video driver holds it: control requests still work.
        if kr not in (0, _EXCLUSIVE_ACCESS):
            self.__exit__(None, None, None)
            raise UsbControlError(f"cannot open the camera (0x{int(kr) & 0xFFFFFFFF:x})")
        self._opened = kr == 0
        return self

    def __exit__(self, *_: object) -> None:
        dev = self._dev
        if dev is None:
            return
        if self._opened:
            _method(dev, _CLOSE, c_int32)(dev)  # type: ignore[operator]
        _method(dev, _RELEASE, c_uint32)(dev)  # type: ignore[operator]
        self._dev = None

    def request(
        self, request: int, selector: int, unit: int, data: bytes | int, interface: int = 0
    ) -> bytes:
        """One UVC class request to `unit` on the video-control interface. `data` is the bytes
        to SET, or the length to GET."""
        if self._dev is None:
            raise UsbControlError("camera not opened")
        is_set = request == SET_CUR
        buf = ctypes.create_string_buffer(data if isinstance(data, bytes) else int(data))
        length = len(data) if isinstance(data, bytes) else int(data)
        req = _DevRequest(
            bmRequestType=0x21 if is_set else 0xA1,
            bRequest=request,
            wValue=selector << 8,
            wIndex=(unit << 8) | interface,
            wLength=length,
            pData=ctypes.cast(buf, c_void_p),
            wLenDone=0,
        )
        fn = _method(self._dev, _DEVICE_REQUEST, c_int32, POINTER(_DevRequest))
        kr = fn(self._dev, byref(req))  # type: ignore[operator]
        if kr != 0:
            raise UsbControlError(f"the camera refused the request (0x{int(kr) & 0xFFFFFFFF:x})")
        return bytes(buf.raw[: req.wLenDone]) if not is_set else b""
