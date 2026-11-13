#!/bin/sh
# SUDO_ASKPASS for an install started from Lefi Crop Helper: there is no terminal to type in, so
# macOS asks with a password dialog. Cancel exits non-zero and that step fails with a clear error.
exec /usr/bin/osascript \
  -e 'display dialog "Lefi Crop needs your administrator password to install Homebrew." default answer "" with hidden answer with title "Lefi Crop Helper" with icon caution' \
  -e 'text returned of result'
