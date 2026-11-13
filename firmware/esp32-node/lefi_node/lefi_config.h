// Lefi Crop sensor node — profile lefi-node-esp32.v1 (packages/contracts/hardware). The default pins are
// the wiring verified in docs/hardware/SENSOR_INVENTORY.md. A board file can move any channel to another
// pin, or set its pin to -1 to leave it out (ADR-065). Lefi Brain accepts only the channels of the profile.
#pragma once
#include <stdint.h>

// ---- Layouts: a preset of which channels are wired (ADR-063) --------------------------------------
// A layout only gives the default pins; the firmware never knows plants (Lefi Brain assigns sensors).
//
//                      air-1      air-2      water-temp-1   water-temp-2   tds-1
// LEFI_LAYOUT_SINGLE      ✓                       ✓
// LEFI_LAYOUT_SINGLE_TDS  ✓                       ✓                            ✓
// LEFI_LAYOUT_DUAL        ✓          ✓            ✓              ✓
// LEFI_LAYOUT_DUAL_TDS    ✓          ✓            ✓              ✓             ✓
// LEFI_LAYOUT_CUSTOM      only the LEFI_PIN_* the board file sets
#define LEFI_LAYOUT_CUSTOM 0
#define LEFI_LAYOUT_SINGLE 1
#define LEFI_LAYOUT_SINGLE_TDS 2
#define LEFI_LAYOUT_DUAL 3
#define LEFI_LAYOUT_DUAL_TDS 4

// ---- Which board this build is for: ITS FILE, the only line to change between boards ---------------
// One file per board in this folder (copy board.example.h to board_<its id>.h; git-ignored): its
// layout, pins, probe ROMs, Wi-Fi, broker, id and password.
#ifndef LEFI_BOARD_FILE
#define LEFI_BOARD_FILE "board_esp32-01.h"
#endif
#if __has_include(LEFI_BOARD_FILE)
#include LEFI_BOARD_FILE
#else
#define LEFI_BOARD_FILE_MISSING 1
#include "board.example.h"  // compiles without a board file; the board then only prints its readings
#endif

#ifndef LEFI_LAYOUT
#define LEFI_LAYOUT LEFI_LAYOUT_CUSTOM
#endif
#if LEFI_LAYOUT < LEFI_LAYOUT_CUSTOM || LEFI_LAYOUT > LEFI_LAYOUT_DUAL_TDS
#error "Unknown LEFI_LAYOUT"
#endif
#ifndef LEFI_DS_ROMS
#define LEFI_DS_ROMS {{0, 0, 0, 0, 0, 0, 0, 0}, {0, 0, 0, 0, 0, 0, 0, 0}}
#endif

constexpr char FIRMWARE[] = "0.5.0";
constexpr char PROFILE[] = "lefi-node-esp32.v1";
constexpr const char* LAYOUT_NAMES[] = {"custom", "single", "single-tds", "dual", "dual-tds"};
constexpr const char* LAYOUT_NAME = LAYOUT_NAMES[LEFI_LAYOUT];

// ---- Pins, one per channel. -1 = not wired: that channel is not read, announced or sent --------------
// Defaults (verified wiring, docs/hardware/SENSOR_INVENTORY.md) for the channels of the layout:
//   air-1         SHT31   SDA 21 / SCL 22
//   air-2         SHT31   SDA 25 / SCL 26
//   water-temp-1  DS18B20 GPIO4
//   water-temp-2  DS18B20 GPIO4 (same 1-Wire bus: each probe by its ROM)
//   tds-1         KEYESTUDIO TDS, GPIO34 (ADC1), 3.3 V
#define LEFI_LAYOUT_ANY_ (LEFI_LAYOUT != LEFI_LAYOUT_CUSTOM)
#define LEFI_LAYOUT_DUAL_ (LEFI_LAYOUT == LEFI_LAYOUT_DUAL || LEFI_LAYOUT == LEFI_LAYOUT_DUAL_TDS)
#define LEFI_LAYOUT_TDS_ (LEFI_LAYOUT == LEFI_LAYOUT_SINGLE_TDS || LEFI_LAYOUT == LEFI_LAYOUT_DUAL_TDS)
#ifndef LEFI_PIN_AIR1_SDA
#define LEFI_PIN_AIR1_SDA (LEFI_LAYOUT_ANY_ ? 21 : -1)
#endif
#ifndef LEFI_PIN_AIR1_SCL
#define LEFI_PIN_AIR1_SCL (LEFI_LAYOUT_ANY_ ? 22 : -1)
#endif
#ifndef LEFI_PIN_AIR2_SDA
#define LEFI_PIN_AIR2_SDA (LEFI_LAYOUT_DUAL_ ? 25 : -1)
#endif
#ifndef LEFI_PIN_AIR2_SCL
#define LEFI_PIN_AIR2_SCL (LEFI_LAYOUT_DUAL_ ? 26 : -1)
#endif
#ifndef LEFI_PIN_WATER_TEMP1
#define LEFI_PIN_WATER_TEMP1 (LEFI_LAYOUT_ANY_ ? 4 : -1)
#endif
#ifndef LEFI_PIN_WATER_TEMP2
#define LEFI_PIN_WATER_TEMP2 (LEFI_LAYOUT_DUAL_ ? 4 : -1)
#endif
#ifndef LEFI_PIN_TDS
#define LEFI_PIN_TDS (LEFI_LAYOUT_TDS_ ? 34 : -1)
#endif
// SHT31 address: 0x44 (ADDR pin low, the usual board), 0x45 (ADDR high), 0 = find 0x44 or 0x45 by itself.
#ifndef LEFI_AIR1_ADDRESS
#define LEFI_AIR1_ADDRESS 0x44
#endif
#ifndef LEFI_AIR2_ADDRESS
#define LEFI_AIR2_ADDRESS 0x44
#endif

constexpr int NO_PIN = -1;
constexpr int PIN_AIR1_SDA = LEFI_PIN_AIR1_SDA, PIN_AIR1_SCL = LEFI_PIN_AIR1_SCL;
constexpr int PIN_AIR2_SDA = LEFI_PIN_AIR2_SDA, PIN_AIR2_SCL = LEFI_PIN_AIR2_SCL;
constexpr int PIN_WATER_TEMP1 = LEFI_PIN_WATER_TEMP1, PIN_WATER_TEMP2 = LEFI_PIN_WATER_TEMP2;
constexpr int PIN_TDS = LEFI_PIN_TDS;
constexpr int PIN_BOOT = 0;
constexpr uint8_t AIR1_ADDRESS = LEFI_AIR1_ADDRESS, AIR2_ADDRESS = LEFI_AIR2_ADDRESS;

// ---- Pin checks: a wrong pin stops the build instead of failing silently on the board --------------
// ESP32-WROOM: 6–11 hold the flash, 20/24/28–31 do not exist, 34–39 are input only. Wi-Fi blocks ADC2,
// so an analog sensor needs an ADC1 pin (32–39).
constexpr bool isGpio(int p) { return p >= 0 && p <= 39 && !(p >= 6 && p <= 11) && p != 20 && p != 24 && !(p >= 28 && p <= 31); }
constexpr bool isOutputGpio(int p) { return isGpio(p) && p < 34; }
constexpr bool isAdc1Gpio(int p) { return p >= 32 && p <= 39; }
constexpr bool i2cPinsOk(int sda, int scl) { return (sda == NO_PIN && scl == NO_PIN) || (isOutputGpio(sda) && isOutputGpio(scl) && sda != scl); }
constexpr bool AIR1_ON = PIN_AIR1_SDA != NO_PIN, AIR2_ON = PIN_AIR2_SDA != NO_PIN;
// Both SHT31 on the same two pins: one I2C bus, so they need different addresses.
constexpr bool AIR_SHARED_BUS = AIR1_ON && AIR2_ON && PIN_AIR1_SDA == PIN_AIR2_SDA && PIN_AIR1_SCL == PIN_AIR2_SCL;
constexpr bool usedByAir(int p) {
  return p != NO_PIN && ((AIR1_ON && (p == PIN_AIR1_SDA || p == PIN_AIR1_SCL)) || (AIR2_ON && (p == PIN_AIR2_SDA || p == PIN_AIR2_SCL)));
}

static_assert(i2cPinsOk(PIN_AIR1_SDA, PIN_AIR1_SCL), "air-1: SDA and SCL must be two different output GPIOs, or both -1");
static_assert(i2cPinsOk(PIN_AIR2_SDA, PIN_AIR2_SCL), "air-2: SDA and SCL must be two different output GPIOs, or both -1");
static_assert(!AIR1_ON || !AIR2_ON || AIR_SHARED_BUS ||
              (PIN_AIR1_SDA != PIN_AIR2_SDA && PIN_AIR1_SDA != PIN_AIR2_SCL && PIN_AIR1_SCL != PIN_AIR2_SDA && PIN_AIR1_SCL != PIN_AIR2_SCL),
              "air-1 and air-2: use the same two pins (one bus) or four different pins");
static_assert(!AIR_SHARED_BUS || (AIR1_ADDRESS && AIR2_ADDRESS && AIR1_ADDRESS != AIR2_ADDRESS),
              "air-1 and air-2 share a bus: set LEFI_AIR1_ADDRESS 0x44 and LEFI_AIR2_ADDRESS 0x45");
static_assert(PIN_WATER_TEMP1 == NO_PIN || isOutputGpio(PIN_WATER_TEMP1), "water-temp-1: 1-Wire needs an output GPIO (not 34-39), or -1");
static_assert(PIN_WATER_TEMP2 == NO_PIN || isOutputGpio(PIN_WATER_TEMP2), "water-temp-2: 1-Wire needs an output GPIO (not 34-39), or -1");
static_assert(!usedByAir(PIN_WATER_TEMP1) && !usedByAir(PIN_WATER_TEMP2), "a water-temp pin is already used by an SHT31");
static_assert(PIN_TDS == NO_PIN || isAdc1Gpio(PIN_TDS), "tds-1: needs an ADC1 pin (32-39), or -1");
static_assert(PIN_TDS == NO_PIN || (!usedByAir(PIN_TDS) && PIN_TDS != PIN_WATER_TEMP1 && PIN_TDS != PIN_WATER_TEMP2),
              "tds-1: its pin is already used by another sensor");
static_assert(PIN_TDS == NO_PIN || PIN_WATER_TEMP1 != NO_PIN, "tds-1 needs water-temp-1 (temperature compensation)");

// DS18B20 ROMs, from the board file (ADR-061). With two probes on one pin each channel is tied to a probe
// by its 64-bit ROM, never by search order. A channel without a ROM uses the only probe of its pin that
// no other channel claims (one probe per pin, or two on one pin with the other ROM set).
constexpr uint8_t DS_ROM[2][8] = LEFI_DS_ROMS;

// tds-1: vendor's formula with temperature compensation from water-temp-1 (owner test sketch,
// 2026-11-08). Not calibrated (profile calibrated=false): change only after a reference solution.
constexpr float TDS_CALIBRATION = 1.0f;

// Timing (ADR-059): telemetry every second, heartbeat every 10 s, Lefi Brain says "no data" after 60 s.
constexpr uint32_t READ_INTERVAL_MS = 1000;
constexpr uint32_t HEARTBEAT_INTERVAL_MS = 10000;
constexpr uint32_t DETECT_INTERVAL_MS = 5000;     // look for unplugged/replugged sensors
constexpr uint32_t SHT31_MEASURE_MS = 20;         // high repeatability: 15.5 ms max
constexpr uint32_t DS18B20_CONVERSION_MS = 750;   // 12 bits
constexpr uint32_t TDS_SAMPLE_MS = 40;            // 25 samples per second, median
constexpr unsigned TDS_SAMPLES = 25;
constexpr uint32_t TDS_STALE_MS = 2500;           // a longer gap (e.g. a slow MQTT connect) starts a new window
constexpr uint32_t LOG_FLUSH_MS = 2000;
constexpr uint32_t WIFI_RESTART_AFTER_MS = 10UL * 60UL * 1000UL;  // a stuck radio is the usual cause
constexpr uint32_t WATCHDOG_MS = 30000;

// Lines at or above this level also go to Lefi Desktop's Board log (0 debug, 1 info, 2 warn, 3 error).
// The Serial Monitor always shows everything, including the live readings (debug).
#ifndef LEFI_REMOTE_LOG_LEVEL
#define LEFI_REMOTE_LOG_LEVEL 1
#endif
// 1 = the Serial Monitor also prints every telemetry message exactly as it is published.
#ifndef LEFI_LOG_TELEMETRY_JSON
#define LEFI_LOG_TELEMETRY_JSON 1
#endif
