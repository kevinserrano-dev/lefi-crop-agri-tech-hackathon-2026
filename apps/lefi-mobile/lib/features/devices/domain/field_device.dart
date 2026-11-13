/// A field device (ESP32 board) and its sensors as Lefi Brain reports them (ADR-052, 058, 059).
/// Field names follow `DeviceOut` / `DeviceDetailOut` / `SensorOut` in the committed OpenAPI.
library;

int? _int(Object? v) => v is num ? v.toInt() : null;
DateTime? _time(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

class FieldDevice {
  const FieldDevice({
    required this.id,
    required this.name,
    required this.profileId,
    required this.status,
    required this.connection,
    required this.simulated,
    required this.sensorsEnabled,
    required this.sensorsTotal,
    this.firmware,
    this.mac,
    this.network,
    this.rssiDbm,
    this.lastSeenAt,
    this.health = const {},
    this.sensors = const [],
  });

  final String id;
  final String name;
  final String profileId;

  /// PENDING · ACTIVE · RETIRED
  final String status;

  /// online · offline · unknown (never connected)
  final String connection;
  final bool simulated;
  final int sensorsEnabled;
  final int sensorsTotal;
  final String? firmware;
  final String? mac;
  final String? network;
  final int? rssiDbm;
  final DateTime? lastSeenAt;

  /// Last heartbeat's board health (free heap, reconnects, IP…), as sent.
  final Map<String, Object?> health;

  /// Only in the detail answer.
  final List<FieldSensor> sensors;

  factory FieldDevice.fromJson(Map<String, dynamic> j) => FieldDevice(
    id: j['id'] as String,
    name: j['name'] as String? ?? j['id'] as String,
    profileId: j['profile_id'] as String? ?? '',
    status: j['status'] as String? ?? '',
    connection: j['connection'] as String? ?? 'unknown',
    simulated: j['origin'] == 'SIMULATED',
    sensorsEnabled: _int(j['sensors_enabled']) ?? 0,
    sensorsTotal: _int(j['sensors_total']) ?? 0,
    firmware: j['firmware'] as String?,
    mac: j['mac'] as String?,
    network: j['network'] as String?,
    rssiDbm: _int(j['rssi_dbm']),
    lastSeenAt: _time(j['last_seen_at']),
    health: {
      for (final e in (j['health'] is Map ? j['health'] as Map : const {}).entries)
        if (e.value != null) e.key.toString(): e.value,
    },
    sensors: [
      for (final s in j['sensors'] is List ? j['sensors'] as List : const [])
        if (s is Map<String, dynamic>) FieldSensor.fromJson(s),
    ],
  );
}

class SensorValue {
  const SensorValue({required this.label, required this.decimals, this.value, this.unit, this.receivedAt});
  final String label;
  final double? value;
  final String? unit;
  final int decimals;
  final DateTime? receivedAt;

  String get shown => value == null ? '—' : '${value!.toStringAsFixed(decimals)}${unit == null ? '' : ' $unit'}';
}

class FieldSensor {
  const FieldSensor({
    required this.id,
    required this.label,
    required this.enabled,
    required this.dataState,
    this.model,
    this.place,
    this.lastValueAt,
    this.lastError,
    this.values = const [],
  });

  final String id;
  final String label;
  final bool enabled;

  /// disabled · waiting · receiving · error · not_receiving
  final String dataState;
  final String? model;
  final String? place;
  final DateTime? lastValueAt;
  final String? lastError;
  final List<SensorValue> values;

  factory FieldSensor.fromJson(Map<String, dynamic> j) {
    final channel = j['channel'] is Map ? j['channel'] as Map : const {};
    return FieldSensor(
      id: j['id'] as String,
      label: channel['label'] as String? ?? j['sensor_key'] as String? ?? '',
      model: channel['model'] as String?,
      enabled: j['enabled'] == true,
      dataState: j['data_state'] as String? ?? 'waiting',
      place: j['target_label'] as String?,
      lastValueAt: _time(j['last_value_at']),
      lastError: j['last_error'] as String?,
      values: [
        for (final v in j['latest'] is List ? j['latest'] as List : const [])
          if (v is Map)
            SensorValue(
              label: v['label'] as String? ?? v['variable'] as String? ?? '',
              value: (v['value'] as num?)?.toDouble(),
              unit: v['unit'] as String?,
              decimals: _int(v['decimals']) ?? 1,
              receivedAt: _time(v['received_at']),
            ),
      ],
    );
  }
}
