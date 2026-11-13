// Lefi Crop sensor node — reads its sensors once per second and publishes the MQTT v1 contract
// (packages/contracts/mqtt) to Lefi Brain. No actuators, no simulated values.
// Before uploading: in lefi_config.h, point LEFI_BOARD_FILE at this board's file (board_<id>.h, made
// from board.example.h): its layout, probe ROMs, Wi-Fi, broker, id and password.
#include "lefi_firmware.h"
