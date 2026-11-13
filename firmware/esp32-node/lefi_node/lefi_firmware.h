// The firmware itself. It lives in a header because Arduino IDE writes prototypes for every function of
// a .ino above its types, which breaks functions that take a struct.
//
// Sections: JSON arena · logs · events · channel health · air (SHT31) · water temperature (DS18B20) ·
// TDS · live readings on Serial · MQTT messages · Wi-Fi/MQTT · setup/loop.
#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <MQTT.h>          // "MQTT" by Joel Gaehwiler (256dpi), not PubSubClient
#include <ArduinoJson.h>   // v7
#include <esp_timer.h>
#include <esp_system.h>
#include <esp_mac.h>
#include <esp_task_wdt.h>
#include <esp_arduino_version.h>
#include "lefi_config.h"  // also includes this board's file (LEFI_BOARD_FILE)

// ================================================================ JSON in a fixed arena (no heap churn)
class FixedArena : public ArduinoJson::Allocator {
  alignas(max_align_t) uint8_t data[8192];
  size_t used = 0;
 public:
  void reset() { used = 0; }
  void* allocate(size_t n) override {
    size_t size = (n + 16 + 15) & ~size_t(15);
    if (size > sizeof(data) - used) return nullptr;
    uint8_t* p = data + used;
    used += size;
    *reinterpret_cast<size_t*>(p) = n;
    return p + 16;
  }
  void deallocate(void*) override {}
  void* reallocate(void* p, size_t n) override {
    if (!p) return allocate(n);
    size_t old = *reinterpret_cast<size_t*>(static_cast<uint8_t*>(p) - 16);
    if (n <= old) return p;
    void* q = allocate(n);
    if (q) memcpy(q, p, old);
    return q;
  }
} arena;
JsonDocument doc(&arena);
void clearDoc() { doc.clear(); arena.reset(); }

uint64_t uptimeMs() { return esp_timer_get_time() / 1000ULL; }
void copyText(char* dst, size_t n, const char* src) { snprintf(dst, n, "%s", src ? src : ""); }

// ================================================================ shared state
WiFiClient net;
MQTTClient mqtt(1024);

enum Kind : uint8_t { K_ANNOUNCE, K_STATUS, K_HEARTBEAT, K_TELEMETRY, K_EVENTS, K_LOGS, K_COUNT };
const char* const SUFFIX[K_COUNT] = {"announce", "status", "heartbeat", "telemetry", "events", "logs"};
char topics[K_COUNT][80], willPayload[128], payload[1024];
uint32_t seqs[K_COUNT] = {};

const char* deviceId = LEFI_DEVICE_ID;
char bootId[9], mac[18];
bool identityOk = false, ready = false;
const char* resetReason = "other";

uint32_t sent = 0, failed = 0, skipped = 0, wifiReconnects = 0, mqttReconnects = 0, maxLoop = 0;
volatile uint16_t wifiReason = 0;
int mqttRC = 0;
bool wifiWasUp = false, mqttWasUp = false, everMqtt = false, mdnsStarted = false;
uint32_t wifiDownAt = 0, mqttDownAt = 0, retryAt = 0, retryDelay = 1000;
uint32_t lastCycle = 0, lastHeartbeat = 0, lastDetect = 0, lastLogs = 0, lastIdNag = 0;

// ================================================================ logs (Serial + Board log, ADR-060)
enum LogLevel : uint8_t { L_DEBUG, L_INFO, L_WARN, L_ERROR };
const char* const LEVELS[] = {"debug", "info", "warn", "error"};
struct LogLine { uint64_t t; uint8_t level; char tag[17]; char msg[161]; };
LogLine logRing[20];
unsigned logHead = 0, logCount = 0;
uint32_t logDropped = 0;

// Always on Serial; at or above LEFI_REMOTE_LOG_LEVEL also kept for Lefi Desktop's Board log.
void lefiLog(uint8_t level, const char* tag, const char* fmt, ...) {
  char msg[161];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(msg, sizeof(msg), fmt, ap);
  va_end(ap);
  Serial.printf("[%s] %s: %s\n", LEVELS[level], tag, msg);
  if (level < LEFI_REMOTE_LOG_LEVEL || !msg[0]) return;
  if (logCount == 20) { logHead = (logHead + 1) % 20; --logCount; ++logDropped; }
  LogLine& l = logRing[(logHead + logCount++) % 20];
  l.t = uptimeMs();
  l.level = level;
  copyText(l.tag, sizeof(l.tag), tag);
  copyText(l.msg, sizeof(l.msg), msg);
}

// ================================================================ events (ADR-059)
enum EventType : uint8_t {
  EV_BOOT, EV_SENSOR_LOST, EV_SENSOR_RECOVERED, EV_SENSOR_ERRORS, EV_WIFI_RESTORED,
  EV_MQTT_RESTORED, EV_RSSI_WEAK, EV_RSSI_OK, EV_HEAP_LOW, EV_LOOP_SLOW, EV_TYPES
};
const char* const EVENT_NAMES[EV_TYPES] = {"boot", "sensor_lost", "sensor_recovered", "sensor_errors",
  "wifi_restored", "mqtt_restored", "rssi_weak", "rssi_ok", "heap_low", "loop_slow"};
struct Event { uint8_t type; uint64_t t; uint32_t seq, suppressed; char sensor[33], error[16]; int64_t number; };
Event eventRing[8];
unsigned eventHead = 0, eventCount = 0;
uint32_t eventWindow[EV_TYPES] = {}, eventSuppressed[EV_TYPES] = {};
uint8_t eventsInWindow[EV_TYPES] = {};

// At most 6 per minute per type; the rest are counted in `suppressed` of the next one.
void raise(EventType type, const char* sensor = nullptr, int64_t number = 0, const char* error = nullptr) {
  uint32_t now = millis();
  if (now - eventWindow[type] >= 60000) { eventWindow[type] = now; eventsInWindow[type] = 0; }
  if (eventsInWindow[type] >= 6) { ++eventSuppressed[type]; return; }
  ++eventsInWindow[type];
  if (eventCount == 8) { eventHead = (eventHead + 1) % 8; --eventCount; }
  Event& e = eventRing[(eventHead + eventCount++) % 8];
  e = {};
  e.type = type;
  e.t = uptimeMs();
  e.seq = ++seqs[K_EVENTS];
  e.number = number;
  e.suppressed = eventSuppressed[type];
  eventSuppressed[type] = 0;
  copyText(e.sensor, sizeof(e.sensor), sensor);
  copyText(e.error, sizeof(e.error), error);
}

// ================================================================ channel health
// Per channel: lost after 3 not_detected in a row (only if it ever worked), errors counted per minute.
struct ChannelHealth { bool ever = false, lost = false; uint8_t missing = 0; uint64_t downAt = 0; uint32_t window = 0; uint16_t errors = 0; };

void observe(ChannelHealth& c, const char* key, const char* error) {
  uint32_t now = millis();
  if (now - c.window >= 60000) { c.window = now; c.errors = 0; }
  if (!error) {
    if (c.lost) { raise(EV_SENSOR_RECOVERED, key, uptimeMs() - c.downAt); lefiLog(L_INFO, "sensors", "%s back", key); }
    c.ever = true; c.lost = false; c.missing = 0;
  } else if (!strcmp(error, "not_detected")) {
    if (c.missing < 3) ++c.missing;
    if (c.ever && !c.lost && c.missing >= 3) {
      c.lost = true; c.downAt = uptimeMs();
      raise(EV_SENSOR_LOST, key); lefiLog(L_WARN, "sensors", "%s lost (not detected)", key);
    }
  } else {
    c.missing = 0;
    if (++c.errors == 11) raise(EV_SENSOR_ERRORS, key, c.errors, error);  // >10 in a minute
  }
}

// ================================================================ air-1 / air-2: SHT31 (single shot, CRC checked)
constexpr uint16_t SHT31_HEATER_OFF = 0x3066;
constexpr uint16_t SHT31_MEASURE_HIGH = 0x2400;  // high repeatability, no clock stretching

struct AirChannel {
  const char* key;
  int sda, scl;                 // NO_PIN = not wired
  uint8_t configuredAddress;    // 0 = find 0x44 or 0x45
  TwoWire* wire = nullptr;
  uint8_t address = 0;
  bool present = false, pending = false;
  uint32_t startedAt = 0;
  float temperature = NAN, humidity = NAN;
  const char* error = "not_detected";
  ChannelHealth health;
  AirChannel(const char* k, int sdaPin, int sclPin, uint8_t addr) : key(k), sda(sdaPin), scl(sclPin), configuredAddress(addr) {}
  bool enabled() const { return sda != NO_PIN; }
};
AirChannel air[2] = {AirChannel("air-1", PIN_AIR1_SDA, PIN_AIR1_SCL, AIR1_ADDRESS),
                     AirChannel("air-2", PIN_AIR2_SDA, PIN_AIR2_SCL, AIR2_ADDRESS)};

uint8_t sht31Crc(const uint8_t* b) {
  uint8_t crc = 0xFF;
  for (unsigned i = 0; i < 2; i++) { crc ^= b[i]; for (int j = 0; j < 8; j++) crc = (crc & 0x80) ? (crc << 1) ^ 0x31 : crc << 1; }
  return crc;
}
bool i2cAck(TwoWire& w, uint8_t address) { w.beginTransmission(address); return w.endTransmission() == 0; }
bool sht31Command(AirChannel& a, uint16_t cmd) {
  a.wire->beginTransmission(a.address);
  a.wire->write(uint8_t(cmd >> 8));
  a.wire->write(uint8_t(cmd));
  return a.wire->endTransmission() == 0;
}

void detectAir(AirChannel& a) {
  if (!a.enabled() || a.pending) return;
  if (a.configuredAddress) a.address = a.configuredAddress;
  else { bool at44 = i2cAck(*a.wire, 0x44), at45 = i2cAck(*a.wire, 0x45); a.address = (at44 != at45) ? (at44 ? 0x44 : 0x45) : 0; }
  a.present = a.address && i2cAck(*a.wire, a.address);
  if (a.present) {
    sht31Command(a, SHT31_HEATER_OFF);
    delay(2);  // the SHT31 refuses a command that comes less than 1 ms after the previous one
  }
}
void startAirMeasurement(AirChannel& a) {
  if (!a.enabled()) return;
  if (!a.present || !sht31Command(a, SHT31_MEASURE_HIGH)) {
    a.present = false; a.error = "not_detected"; a.temperature = a.humidity = NAN;
    return;
  }
  a.pending = true;
  a.startedAt = millis();
}
void finishAirMeasurement(AirChannel& a, uint32_t now) {
  if (!a.pending || now - a.startedAt < SHT31_MEASURE_MS) return;
  a.pending = false;
  a.temperature = a.humidity = NAN;
  uint8_t b[6];
  if (a.wire->requestFrom(a.address, uint8_t(6)) != 6) {
    a.present = i2cAck(*a.wire, a.address);
    a.error = a.present ? "read_failed" : "not_detected";
    return;
  }
  for (uint8_t& x : b) x = a.wire->read();
  if (sht31Crc(b) != b[2] || sht31Crc(b + 3) != b[5]) { a.error = "crc"; return; }
  float t = -45.0f + 175.0f * ((b[0] << 8) | b[1]) / 65535.0f;
  float h = 100.0f * ((b[3] << 8) | b[4]) / 65535.0f;
  if (t < -40 || t > 125 || h < 0 || h > 100) { a.error = "out_of_range"; return; }
  a.temperature = t; a.humidity = h; a.error = nullptr;
}

void setupAir() {
  for (unsigned i = 0; i < 2; i++) {
    AirChannel& a = air[i];
    if (!a.enabled()) { lefiLog(L_INFO, "sensors", "%s: SHT31 pin -1, not read", a.key); continue; }
    bool sharesBusWithAir1 = i == 1 && AIR_SHARED_BUS;
    a.wire = (i == 0 || sharesBusWithAir1) ? &Wire : &Wire1;
    if (!sharesBusWithAir1) { a.wire->begin(a.sda, a.scl, 100000); a.wire->setTimeOut(10); }
    detectAir(a);
    lefiLog(L_INFO, "sensors", "%s: SHT31 on SDA %d / SCL %d: %s (0x%02X)", a.key, a.sda, a.scl,
            a.present ? "found" : "NOT FOUND", a.address ? a.address : a.configuredAddress);
    startAirMeasurement(a);
  }
}

// ================================================================ water-temp-1 / water-temp-2: DS18B20 (by ROM, async)
// One 1-Wire bus per pin in use: both channels on one pin share it.
struct OneWireBus { int pin = NO_PIN; OneWire wire; DallasTemperature probes; };
OneWireBus buses[2];
unsigned busCount = 0;
bool waterConversionPending = false;
uint32_t waterConversionAt = 0;

struct WaterChannel {
  const char* key;
  int pin;                      // NO_PIN = not wired
  uint8_t configuredRom[8];     // from the board file; all zeros = not set
  OneWireBus* bus = nullptr;
  uint8_t rom[8] = {};          // the probe in use (all zeros = none)
  bool present = false;
  bool ambiguous = false;       // no ROM set and several unclaimed probes on its pin
  float value = NAN;
  const char* error = "not_detected";
  ChannelHealth health;
  WaterChannel(const char* k, int p, const uint8_t (&r)[8]) : key(k), pin(p) { memcpy(configuredRom, r, 8); }
  bool enabled() const { return pin != NO_PIN; }
};
WaterChannel water[2] = {WaterChannel("water-temp-1", PIN_WATER_TEMP1, DS_ROM[0]),
                         WaterChannel("water-temp-2", PIN_WATER_TEMP2, DS_ROM[1])};

bool romSet(const uint8_t* r) { for (int i = 0; i < 8; i++) if (r[i]) return true; return false; }
bool romValid(const uint8_t* r) { return r[0] == 0x28 && OneWire::crc8(r, 7) == r[7]; }
void romText(const uint8_t* r, char* out) {  // 17 bytes
  for (int i = 0; i < 8; i++) sprintf(out + 2 * i, "%02X", r[i]);
}

OneWireBus* busOnPin(int pin) {
  for (unsigned i = 0; i < busCount; i++) if (buses[i].pin == pin) return &buses[i];
  OneWireBus& b = buses[busCount++];
  b.pin = pin;
  b.wire.begin(pin);
  b.probes.setOneWire(&b.wire);
  b.probes.begin();
  b.probes.setAutoSaveScratchPad(false);  // never write the probes' EEPROM
  b.probes.setWaitForConversion(false);
  return &b;
}

// Finds the probes of one pin and ties each channel of that pin to its probe.
void discoverProbes(OneWireBus& bus, bool print) {
  uint8_t found[8][8], addr[8];
  unsigned foundCount = 0;
  bus.wire.reset_search();
  while (foundCount < 8 && bus.wire.search(addr)) {
    if (!romValid(addr)) continue;
    memcpy(found[foundCount++], addr, 8);
    if (print) Serial.printf("DS18B20 on GPIO%d, ROM: {0x%02X,0x%02X,0x%02X,0x%02X,0x%02X,0x%02X,0x%02X,0x%02X}\n", bus.pin,
                             addr[0], addr[1], addr[2], addr[3], addr[4], addr[5], addr[6], addr[7]);
  }
  // Probes no channel of this pin claims with a ROM from the board file.
  uint8_t unclaimed[8][8];
  unsigned unclaimedCount = 0;
  for (unsigned f = 0; f < foundCount; f++) {
    bool claimed = false;
    for (const WaterChannel& w : water)
      if (w.bus == &bus && romSet(w.configuredRom) && !memcmp(w.configuredRom, found[f], 8)) claimed = true;
    if (!claimed) memcpy(unclaimed[unclaimedCount++], found[f], 8);
  }
  bool firstWithoutRom = true;
  for (WaterChannel& w : water) {
    if (w.bus != &bus) continue;
    if (romSet(w.configuredRom)) {
      memcpy(w.rom, w.configuredRom, 8);
      w.ambiguous = false;
    } else {
      // No ROM: the only unclaimed probe of the pin is this one. With several, which is which cannot be
      // known (ADR-061): the channel waits for its ROM.
      if (firstWithoutRom && unclaimedCount == 1) memcpy(w.rom, unclaimed[0], 8);
      else memset(w.rom, 0, 8);
      w.ambiguous = unclaimedCount > 1;
      firstWithoutRom = false;
    }
    bool was = w.present;
    w.present = romValid(w.rom) && bus.probes.isConnected(w.rom);
    if (w.present && !was) bus.probes.setResolution(w.rom, 12);
  }
}
void discoverAllProbes(bool print) { for (unsigned i = 0; i < busCount; i++) discoverProbes(buses[i], print); }

void startWaterConversion() {
  for (unsigned i = 0; i < busCount; i++) buses[i].probes.requestTemperatures();  // every probe of the pin at once
  waterConversionPending = busCount > 0;
  waterConversionAt = millis();
}

// Reads the conversion started one cycle earlier. Returns the error, or nullptr with w.value set.
const char* readProbe(WaterChannel& w, bool conversionDone) {
  if (!w.present) return "not_detected";
  uint8_t sp[9];
  if (!w.bus->probes.readScratchPad(w.rom, sp)) { w.present = false; return "not_detected"; }
  bool zero = true, ff = true;
  for (uint8_t b : sp) { if (b) zero = false; if (b != 0xFF) ff = false; }
  if (zero || ff) { w.present = false; return "not_detected"; }
  if (OneWire::crc8(sp, 8) != sp[8]) return "crc";
  if (!conversionDone) return "read_failed";
  float v = int16_t((sp[1] << 8) | sp[0]) / 16.0f;
  if (v == 85.0f) return "read_failed";  // power-on value: no conversion happened
  if (v < -55 || v > 125) return "out_of_range";
  w.value = v;
  return nullptr;
}
void readWaterTemps() {
  bool conversionDone = waterConversionPending && millis() - waterConversionAt >= DS18B20_CONVERSION_MS;
  for (WaterChannel& w : water) {
    if (!w.enabled()) continue;
    w.value = NAN;
    w.error = readProbe(w, conversionDone);
  }
  startWaterConversion();
}

void setupWater() {
  for (WaterChannel& w : water) {
    if (w.enabled()) w.bus = busOnPin(w.pin);
    else lefiLog(L_INFO, "sensors", "%s: DS18B20 pin -1, not read", w.key);
  }
  if (water[0].bus && water[0].bus == water[1].bus && romSet(water[0].configuredRom) &&
      !memcmp(water[0].configuredRom, water[1].configuredRom, 8)) {
    lefiLog(L_ERROR, "sensors", "the same ROM is set for both probes: fix LEFI_DS_ROMS");
    memset(water[1].configuredRom, 0, 8);
  }
  discoverAllProbes(true);
  for (const WaterChannel& w : water) {
    if (!w.enabled()) continue;
    char rom[17];
    romText(w.rom, rom);
    lefiLog(L_INFO, "sensors", "%s: DS18B20 on GPIO%d: %s%s", w.key, w.pin, w.present ? "found, ROM " : "NOT FOUND",
            w.present ? rom : "");
    if (w.ambiguous)
      lefiLog(L_WARN, "sensors", "%s: several probes on GPIO%d: copy its ROM line into LEFI_DS_ROMS", w.key, w.pin);
  }
  startWaterConversion();
}

// ================================================================ tds-1: analog TDS meter, median of 25 samples
struct TdsChannel {
  const char* key = "tds-1";
  int pin = PIN_TDS;            // NO_PIN = not wired
  uint16_t samples[TDS_SAMPLES] = {};
  unsigned count = 0, next = 0;
  uint32_t lastSampleAt = 0;
  float millivolts = NAN, ppm = NAN;
  const char* error = "read_failed";
  ChannelHealth health;
  bool enabled() const { return pin != NO_PIN; }
} tds;

void sampleTds(uint32_t now) {
  if (!tds.enabled() || now - tds.lastSampleAt < TDS_SAMPLE_MS) return;
  if (now - tds.lastSampleAt > TDS_STALE_MS) { tds.count = 0; tds.next = 0; }  // a long gap: start a new window
  tds.lastSampleAt = now;
  tds.samples[tds.next] = analogReadMilliVolts(tds.pin);
  tds.next = (tds.next + 1) % TDS_SAMPLES;
  if (tds.count < TDS_SAMPLES) ++tds.count;
}
void readTds() {
  if (!tds.enabled()) return;
  tds.millivolts = tds.ppm = NAN;
  tds.error = "read_failed";
  if (tds.count < TDS_SAMPLES) return;
  uint16_t s[TDS_SAMPLES];
  memcpy(s, tds.samples, sizeof(s));
  for (unsigned i = 1; i < TDS_SAMPLES; i++) { uint16_t v = s[i]; int j = i - 1; while (j >= 0 && s[j] > v) { s[j + 1] = s[j]; --j; } s[j + 1] = v; }
  tds.millivolts = s[TDS_SAMPLES / 2];
  // Needs this second's water temperature: never assumes 25 °C, never repeats an old value.
  const WaterChannel& w1 = water[0];
  if (w1.error) return;
  float volts = tds.millivolts / 1000.0f / (1.0f + 0.02f * (w1.value - 25.0f));
  float ppm = (133.42f * volts * volts * volts - 255.86f * volts * volts + 857.39f * volts) * 0.5f * TDS_CALIBRATION;
  if (!isfinite(ppm) || ppm < 0) { tds.error = "out_of_range"; return; }
  tds.ppm = ppm;
  tds.error = nullptr;
}

void setupTds() {
  if (!tds.enabled()) { lefiLog(L_INFO, "sensors", "tds-1: TDS pin -1, not read"); return; }
  analogReadResolution(12);
  analogSetPinAttenuation(tds.pin, ADC_11db);
  lefiLog(L_INFO, "sensors", "tds-1: analog TDS on GPIO%d (not calibrated, compensated with water-temp-1)", tds.pin);
}

// ================================================================ live readings on Serial (debug: not in the Board log)
// One block per second: each channel with its sensor model, pin and value (or its error).
void logLiveReadings() {
  bool wifiUp = WiFi.status() == WL_CONNECTED;
  lefiLog(L_DEBUG, "live", "---- uptime %.1f s | Wi-Fi %s | MQTT %s | sent %lu, failed %lu, offline %lu",
          uptimeMs() / 1000.0, wifiUp ? "up" : "down", ready ? "up" : (identityOk ? "down" : "no identity"),
          (unsigned long)sent, (unsigned long)failed, (unsigned long)skipped);
  for (const AirChannel& a : air) {
    if (!a.enabled()) continue;
    if (a.error) lefiLog(L_DEBUG, "live", "%-12s SHT31   SDA%d/SCL%d  ERROR %s", a.key, a.sda, a.scl, a.error);
    else lefiLog(L_DEBUG, "live", "%-12s SHT31   SDA%d/SCL%d  air_temperature %.2f C | air_humidity %.2f %%RH",
                 a.key, a.sda, a.scl, a.temperature, a.humidity);
  }
  for (const WaterChannel& w : water) {
    if (!w.enabled()) continue;
    if (w.error) lefiLog(L_DEBUG, "live", "%-12s DS18B20 GPIO%d  ERROR %s%s", w.key, w.pin, w.error,
                         w.ambiguous ? " (several probes: set its ROM)" : "");
    else lefiLog(L_DEBUG, "live", "%-12s DS18B20 GPIO%d  water_temperature %.2f C", w.key, w.pin, w.value);
  }
  if (tds.enabled()) {
    if (tds.error) lefiLog(L_DEBUG, "live", "%-12s TDS     GPIO%d  %.0f mV  ERROR %s%s", tds.key, tds.pin, tds.millivolts,
                           tds.error, water[0].error ? " (no valid water-temp-1)" : "");
    else lefiLog(L_DEBUG, "live", "%-12s TDS     GPIO%d  %.0f mV | water_tds %.2f ppm (not calibrated)",
                 tds.key, tds.pin, tds.millivolts, tds.ppm);
  }
}

// ================================================================ MQTT messages (packages/contracts/mqtt)
void base(Kind kind, bool counted) {
  clearDoc();
  doc["v"] = 1;
  doc["device_id"] = deviceId;
  doc["boot_id"] = bootId;
  if (counted) { doc["seq"] = ++seqs[kind]; doc["uptime_ms"] = uptimeMs(); doc["origin"] = "LIVE"; }
}
bool publishDoc(Kind kind, bool retained, int qos) {
  size_t n = measureJson(doc);
  if (doc.overflowed() || n >= sizeof(payload)) { lefiLog(L_ERROR, "mqtt", "message too big, not sent"); return false; }
  serializeJson(doc, payload, sizeof(payload));
  return mqtt.publish(topics[kind], payload, n, retained, qos);
}
void addReading(JsonArray arr, const char* key, const char* variable, float v, const char* error) {
  JsonObject o = arr.add<JsonObject>();
  o["sensor_key"] = key;
  o["variable"] = variable;
  if (error || !isfinite(v)) { o["value"] = nullptr; o["error"] = error ? error : "read_failed"; }
  else o["value"] = roundf(v * 100.0f) / 100.0f;
}
void addChannel(JsonArray arr, const char* key, bool detected, const char* detail = nullptr) {
  JsonObject c = arr.add<JsonObject>();
  c["sensor_key"] = key;
  c["detected"] = detected;
  if (detail) c["detail"] = detail;
}

// Lists only the channels wired on this board (pin != -1).
bool announce() {
  base(K_ANNOUNCE, false);
  doc["profile"] = PROFILE;
  doc["firmware"] = FIRMWARE;
  doc["mac"] = mac;
  doc["origin"] = "LIVE";
  JsonArray a = doc["channels"].to<JsonArray>();
  for (const AirChannel& c : air) if (c.enabled()) addChannel(a, c.key, c.present);
  for (const WaterChannel& w : water) if (w.enabled()) addChannel(a, w.key, w.present, w.ambiguous ? "ROM not set in firmware" : nullptr);
  if (tds.enabled()) {
    JsonObject c = a.add<JsonObject>();
    c["sensor_key"] = tds.key;
    c["detected"] = nullptr;  // a TDS probe out of the water cannot be told from pure water
    c["detail"] = "analog, not calibrated";
  }
  return publishDoc(K_ANNOUNCE, true, 1);
}

void telemetry() {
  if (!ready || !mqtt.connected()) { ++skipped; return; }
  base(K_TELEMETRY, true);
  doc["ts_synced"] = false;
  JsonArray r = doc["readings"].to<JsonArray>();
  for (const AirChannel& a : air) {
    if (!a.enabled()) continue;
    addReading(r, a.key, "air_temperature", a.temperature, a.error);
    addReading(r, a.key, "air_humidity", a.humidity, a.error);
  }
  for (const WaterChannel& w : water) if (w.enabled()) addReading(r, w.key, "water_temperature", w.value, w.error);
  if (tds.enabled()) addReading(r, tds.key, "water_tds", tds.ppm, tds.error);
  bool ok = publishDoc(K_TELEMETRY, false, 1);
  if (ok) ++sent; else ++failed;
#if LEFI_LOG_TELEMETRY_JSON
  Serial.printf("[debug] mqtt: %s %s %s\n", ok ? "sent" : "FAILED", topics[K_TELEMETRY], payload);
#endif
}

bool heartbeat() {
  base(K_HEARTBEAT, true);
  doc["rssi_dbm"] = constrain(WiFi.RSSI(), -127, 0);
  doc["free_heap"] = ESP.getFreeHeap();
  doc["firmware"] = FIRMWARE;
  doc["min_free_heap"] = ESP.getMinFreeHeap();
  doc["reset_reason"] = resetReason;
  int ch = WiFi.channel();
  if (ch >= 1 && ch <= 14) doc["wifi_channel"] = ch;
  doc["wifi_reconnects"] = wifiReconnects;
  doc["wifi_last_reason"] = wifiReason;
  doc["mqtt_reconnects"] = mqttReconnects;
  doc["mqtt_last_rc"] = mqttRC;
  doc["telemetry_sent"] = sent;
  doc["telemetry_failed"] = failed;
  doc["telemetry_skipped_offline"] = skipped;
  doc["max_loop_ms"] = maxLoop;
  IPAddress ip = WiFi.localIP();
  char text[16];
  snprintf(text, sizeof(text), "%u.%u.%u.%u", ip[0], ip[1], ip[2], ip[3]);
  doc["ip"] = text;
  bool ok = publishDoc(K_HEARTBEAT, false, 0);
  if (ok) maxLoop = 0;  // "slowest loop in this interval"
  return ok;
}

bool isWarning(const Event& e) {
  if (e.type == EV_BOOT) return !strcmp(resetReason, "watchdog") || !strcmp(resetReason, "panic") || !strcmp(resetReason, "brownout");
  return e.type == EV_SENSOR_LOST || e.type == EV_SENSOR_ERRORS || e.type == EV_WIFI_RESTORED ||
         e.type == EV_RSSI_WEAK || e.type == EV_LOOP_SLOW;
}
void flushEvents() {
  if (!ready || !mqtt.connected() || !eventCount) return;
  const Event& e = eventRing[eventHead];
  base(K_EVENTS, false);
  doc["seq"] = e.seq;
  doc["uptime_ms"] = e.t;
  doc["origin"] = "LIVE";
  doc["type"] = EVENT_NAMES[e.type];
  doc["severity"] = e.type == EV_HEAP_LOW ? "crit" : (isWarning(e) ? "warn" : "info");
  if (e.sensor[0]) doc["sensor_key"] = e.sensor;
  if (e.suppressed) doc["suppressed"] = e.suppressed;
  switch (e.type) {
    case EV_BOOT: doc["reset_reason"] = resetReason; break;
    case EV_SENSOR_RECOVERED: doc["down_ms"] = e.number; break;
    case EV_SENSOR_ERRORS: doc["count"] = e.number; doc["error"] = e.error; break;
    case EV_WIFI_RESTORED: doc["down_ms"] = e.number; doc["wifi_last_reason"] = wifiReason; break;
    case EV_MQTT_RESTORED: doc["down_ms"] = e.number; doc["mqtt_last_rc"] = mqttRC; break;
    case EV_RSSI_WEAK: case EV_RSSI_OK: doc["rssi_dbm"] = e.number; break;
    case EV_HEAP_LOW: doc["free_heap"] = e.number; break;
    case EV_LOOP_SLOW: doc["max_loop_ms"] = e.number; break;
    default: break;
  }
  if (publishDoc(K_EVENTS, false, 1)) {
    lefiLog(L_DEBUG, "mqtt", "event %s sent", EVENT_NAMES[e.type]);
    eventHead = (eventHead + 1) % 8; --eventCount;
  }
}

void flushLogs(uint32_t now) {
  if (!ready || !mqtt.connected() || !logCount || (logCount < 20 && now - lastLogs < LOG_FLUSH_MS)) return;
  base(K_LOGS, true);
  if (logDropped) doc["dropped"] = logDropped;
  JsonArray lines = doc["lines"].to<JsonArray>();
  unsigned n = 0;
  while (n < logCount) {  // as many lines as fit in one 1024-byte message
    const LogLine& l = logRing[(logHead + n) % 20];
    JsonObject o = lines.add<JsonObject>();
    o["t"] = l.t;
    o["level"] = LEVELS[l.level];
    o["tag"] = l.tag;
    o["msg"] = l.msg;
    if (measureJson(doc) >= 1000) { lines.remove(n); break; }
    ++n;
  }
  if (n && publishDoc(K_LOGS, false, 0)) { logHead = (logHead + n) % 20; logCount -= n; logDropped = 0; lastLogs = now; }
}

// ================================================================ identity, Wi-Fi, MQTT
// Same rule as the contract (common.v1 device_id); sim- ids belong to the simulator, never to a board.
bool validDeviceId(const char* id) {
  size_t n = strlen(id);
  if (n < 3 || n > 32 || !strncmp(id, "sim-", 4) || id[0] == '-' || id[n - 1] == '-') return false;
  for (size_t i = 0; i < n; i++) if (!islower((unsigned char)id[i]) && !isdigit((unsigned char)id[i]) && id[i] != '-') return false;
  return true;
}

bool resolveBroker(IPAddress& ip) {
  const char* host = LEFI_MQTT_HOST;
  size_t len = strlen(host);
  if (ip.fromString(host)) return true;
  if (len > 6 && !strcmp(host + len - 6, ".local")) {
    char name[64];
    copyText(name, sizeof(name), host);
    name[len - 6] = 0;
    ip = MDNS.queryHost(name, 500);
    return uint32_t(ip) != 0;
  }
  return WiFi.hostByName(host, ip) == 1;
}

void connectWatch(uint32_t now) {
  bool up = WiFi.status() == WL_CONNECTED;
  if (up && !wifiWasUp) {
    if (wifiReconnects) raise(EV_WIFI_RESTORED, nullptr, now - wifiDownAt);
    lefiLog(L_INFO, "wifi", "connected, IP %s, signal %d dBm", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    if (!mdnsStarted) mdnsStarted = MDNS.begin(deviceId);
    retryAt = now;
    retryDelay = 1000;
  }
  if (!up && wifiWasUp) { wifiDownAt = now; ++wifiReconnects; lefiLog(L_WARN, "wifi", "disconnected (reason %u)", wifiReason); }
  wifiWasUp = up;
  if (!up && now - wifiDownAt >= WIFI_RESTART_AFTER_MS) { Serial.println("No Wi-Fi for 10 minutes: restarting"); ESP.restart(); }

  if (mqtt.connected()) return;
  ready = false;
  if (mqttWasUp) { mqttDownAt = now; lefiLog(L_WARN, "mqtt", "disconnected"); }
  mqttWasUp = false;
  if (!up || int32_t(now - retryAt) < 0) return;

  IPAddress ip;
  bool resolved = resolveBroker(ip);
  bool connected = false;
  if (resolved) {
    mqtt.setHost(ip, LEFI_MQTT_PORT);
    // Explicit TCP connect with a 1 s timeout, then MQTT on that socket (skip = true).
    if (net.connect(ip, LEFI_MQTT_PORT, 1000)) connected = mqtt.connect(deviceId, deviceId, LEFI_MQTT_PASSWORD, true);
    if (!connected) net.stop();
    mqttRC = mqtt.returnCode();
  } else {
    lefiLog(L_WARN, "mqtt", "cannot find %s: is the main PC on?", LEFI_MQTT_HOST);
  }
  retryAt = millis() + retryDelay;
  retryDelay = min(retryDelay * 2, uint32_t(30000));
  if (!connected) {
    if (resolved) {
      if (mqttRC == 4 || mqttRC == 5) lefiLog(L_ERROR, "mqtt", "refused: wrong device id or password (rc %d)", mqttRC);
      else lefiLog(L_WARN, "mqtt", "connect failed (rc %d, error %d)", mqttRC, int(mqtt.lastError()));
    }
    return;
  }
  mqttWasUp = true;
  retryDelay = 1000;
  if (everMqtt) { ++mqttReconnects; raise(EV_MQTT_RESTORED, nullptr, millis() - mqttDownAt); }
  everMqtt = true;
  lefiLog(L_INFO, "mqtt", "connected to %s as %s", LEFI_MQTT_HOST, deviceId);
  // announce → online → heartbeat, then telemetry.
  if (!announce()) { mqtt.disconnect(); return; }
  base(K_STATUS, false);
  doc["state"] = "online";
  if (!publishDoc(K_STATUS, true, 1) || !heartbeat()) { mqtt.disconnect(); return; }
  ready = true;
  lastHeartbeat = millis();
}

void health(uint32_t now) {
  static bool weak = false, timing = false, low = false;
  static uint32_t weakSince = 0;
  if (WiFi.status() == WL_CONNECTED) {
    int rssi = constrain(WiFi.RSSI(), -127, 0);
    if (!weak && rssi < -75) {
      if (!timing) { timing = true; weakSince = now; }
      if (now - weakSince >= 30000) { weak = true; raise(EV_RSSI_WEAK, nullptr, rssi); }
    } else if (!weak) {
      timing = false;
    }
    if (weak && rssi >= -70) { weak = false; timing = false; raise(EV_RSSI_OK, nullptr, rssi); }
  } else {
    timing = false;
  }
  uint32_t heap = ESP.getFreeHeap();
  if (heap < 30000 && !low) { low = true; raise(EV_HEAP_LOW, nullptr, heap); }
  if (heap >= 40000) low = false;
}

// ================================================================ setup / loop
const char* readResetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "power_on";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_DEEPSLEEP: return "deep_sleep";
    case ESP_RST_INT_WDT: case ESP_RST_TASK_WDT: case ESP_RST_WDT: return "watchdog";
    default: return "other";
  }
}

void setupNetwork() {
  identityOk = validDeviceId(deviceId) && strlen(LEFI_MQTT_PASSWORD) > 0;
  WiFi.mode(WIFI_STA);  // the radio also makes esp_random() truly random
  snprintf(bootId, sizeof(bootId), "%08lx", static_cast<unsigned long>(esp_random()));
  if (!identityOk) {
    lefiLog(L_ERROR, "setup", "no identity: set LEFI_DEVICE_ID and LEFI_MQTT_PASSWORD in this board's file (only printing readings)");
    return;
  }
  WiFi.setHostname(deviceId);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.onEvent([](WiFiEvent_t, WiFiEventInfo_t info) { wifiReason = info.wifi_sta_disconnected.reason; },
               ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
  WiFi.begin(LEFI_WIFI_SSID, LEFI_WIFI_PASSWORD);
  for (unsigned k = 0; k < K_COUNT; k++) snprintf(topics[k], sizeof(topics[k]), "lefi/v1/devices/%s/%s", deviceId, SUFFIX[k]);
  snprintf(willPayload, sizeof(willPayload), "{\"v\":1,\"device_id\":\"%s\",\"state\":\"offline\",\"boot_id\":\"%s\"}", deviceId, bootId);
  mqtt.begin(net);
  mqtt.setOptions(15, true, 1000);  // keepalive 15 s, clean session, 1 s timeout
  mqtt.setWill(topics[K_STATUS], willPayload, true, 1);
}

void setupWatchdog() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t cfg = {};
  cfg.timeout_ms = WATCHDOG_MS;
  cfg.idle_core_mask = 0;
  cfg.trigger_panic = true;
  if (esp_task_wdt_init(&cfg) == ESP_ERR_INVALID_STATE) esp_task_wdt_reconfigure(&cfg);
#else
  esp_task_wdt_init(WATCHDOG_MS / 1000, true);
#endif
  esp_task_wdt_add(nullptr);
}

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  resetReason = readResetReason();
  uint8_t m[6];
  esp_read_mac(m, ESP_MAC_WIFI_STA);
  snprintf(mac, sizeof(mac), "%02X:%02X:%02X:%02X:%02X:%02X", m[0], m[1], m[2], m[3], m[4], m[5]);
  Serial.printf("\nLefi Crop node, firmware %s, layout %s, board file %s%s, Wi-Fi MAC %s (type it in Lefi Desktop), reset %s\n",
                FIRMWARE, LAYOUT_NAME, LEFI_BOARD_FILE,
#ifdef LEFI_BOARD_FILE_MISSING
                " (NOT FOUND: using board.example.h)",
#else
                "",
#endif
                mac, resetReason);

  // Sensors first: they are read and printed even without Wi-Fi or identity.
  setupWater();
  setupAir();
  setupTds();
  setupNetwork();
  setupWatchdog();
  raise(EV_BOOT);
  lastCycle = wifiDownAt = millis();
}

// Once per second: read everything, publish, print, start the next measurements.
void readCycle(uint32_t now) {
  readWaterTemps();
  readTds();  // after the water temperature of this same second
  for (AirChannel& a : air) if (a.enabled()) observe(a.health, a.key, a.error);
  for (WaterChannel& w : water) if (w.enabled()) observe(w.health, w.key, w.error);
  if (tds.enabled()) observe(tds.health, tds.key, tds.error);
  telemetry();
  logLiveReadings();
  for (AirChannel& a : air) startAirMeasurement(a);
  health(now);
}

void loop() {
  uint32_t start = millis();
  esp_task_wdt_reset();
  sampleTds(start);
  for (AirChannel& a : air) finishAirMeasurement(a, start);
  if (identityOk) {
    connectWatch(start);
    if (mqtt.connected()) mqtt.loop();
  } else if (start - lastIdNag >= 10000) {
    lastIdNag = start;
    lefiLog(L_ERROR, "setup", "no identity in this board's file: not connecting");
  }
  uint32_t now = millis();
  sampleTds(now);

  // Unplugged/replugged sensors, outside the DS18B20 conversion window.
  if (now - lastDetect >= DETECT_INTERVAL_MS && now - waterConversionAt >= DS18B20_CONVERSION_MS) {
    lastDetect = now;
    discoverAllProbes(false);
    for (AirChannel& a : air) if (!a.present) detectAir(a);
  }
  if (now - lastCycle >= READ_INTERVAL_MS) { lastCycle = now; readCycle(now); }
  if (ready && now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) { lastHeartbeat = now; heartbeat(); }
  flushEvents();
  flushLogs(now);

  uint32_t elapsed = millis() - start;
  if (elapsed > maxLoop) maxLoop = elapsed;
  if (elapsed > 2000) raise(EV_LOOP_SLOW, nullptr, elapsed);
  delay(1);
}
