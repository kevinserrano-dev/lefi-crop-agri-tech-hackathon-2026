"""LEFI CROP BRAIN — central backend of LEFI CROP AI (modular monolith, ADR-001/002)."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("lefi-brain")
except PackageNotFoundError:  # running from a source tree without installation
    __version__ = "0.0.0+source"
