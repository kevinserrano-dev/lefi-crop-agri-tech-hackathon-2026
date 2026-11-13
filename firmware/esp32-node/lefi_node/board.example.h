// One board of the installation. Copy this file to board_<its id>.h (e.g. board_esp32-01.h; git-ignored:
// it holds a password), fill it in, and point LEFI_BOARD_FILE in lefi_config.h at it before uploading.
#pragma once

// ---- Pins: one line per sensor wire -------------------------------------------------------------------
// -1 = not wired: that sensor is not read, not announced and not sent.
// The build stops on a pin the ESP32 cannot use (flash pins, input-only pins for I2C/1-Wire, TDS outside
// ADC1 32-39, or one pin used by two sensors).
// (The PlatformIO check builds set LEFI_LAYOUT instead, which skips this block.)
#ifndef LEFI_LAYOUT

// air-1 — SHT31: air temperature (°C) + air humidity (%RH), I2C
#define LEFI_PIN_AIR1_SDA 21        // air temperature/humidity sensor 1: SDA (data)
#define LEFI_PIN_AIR1_SCL 22        // air temperature/humidity sensor 1: SCL (clock)
#define LEFI_AIR1_ADDRESS 0x44      // 0x44 (ADDR low, usual) · 0x45 (ADDR high) · 0 = find it

// air-2 — second SHT31: air temperature + air humidity. Same pins as air-1 = same bus (then 0x45 here).
#define LEFI_PIN_AIR2_SDA -1        // air temperature/humidity sensor 2: SDA (data)
#define LEFI_PIN_AIR2_SCL -1        // air temperature/humidity sensor 2: SCL (clock)
#define LEFI_AIR2_ADDRESS 0x44

// water-temp-1 / water-temp-2 — DS18B20: water temperature (°C), 1-Wire (4.7 kΩ pull-up to 3.3 V)
#define LEFI_PIN_WATER_TEMP1 4      // water temperature probe 1: data
#define LEFI_PIN_WATER_TEMP2 -1     // water temperature probe 2: data (own pin, or the same pin + ROMs below)

// tds-1 — KEYESTUDIO TDS meter: dissolved solids in water (ppm, not calibrated), analog
#define LEFI_PIN_TDS 34             // TDS meter: analog out (ADC1 only: 32-39); needs water-temp-1

#endif

// DS18B20 ROMs: only needed when two probes share one pin. At boot the board prints
// "DS18B20 on GPIOn, ROM: {0x28,...}" for each probe: plug one probe at a time and copy its line
// (first = water-temp-1, second = water-temp-2). With one probe per pin this can stay all zeros.
#define LEFI_DS_ROMS {                                                        \
  {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}, /* water-temp-1 */        \
  {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}, /* water-temp-2 */        \
}

// ---- Network: fill in YOUR local network before uploading ----------------------------------------------
// Wi-Fi of the greenhouse: the same local network as the main PC (Lefi Brain). 2.4 GHz only: the ESP32 has
// no 5 GHz radio. Never commit real values (board_*.h files are git-ignored).
#define LEFI_WIFI_SSID "YOUR_WIFI_SSID"
#define LEFI_WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// MQTT broker on the main PC. "lefi-main.local" is the name Lefi Crop Helper announces on the LAN (mDNS);
// if your network blocks mDNS, write the main PC's LAN IP address instead (e.g. "192.168.x.y").
#define LEFI_MQTT_HOST "lefi-main.local"
#define LEFI_MQTT_PORT 1883

// From Lefi Desktop → Devices & Health → Add device → Manually (network Wi-Fi, the MAC this board prints
// at boot): the id Lefi Brain gave (also the MQTT username) and "Create connection password" (shown once).
#define LEFI_DEVICE_ID ""
#define LEFI_MQTT_PASSWORD ""
