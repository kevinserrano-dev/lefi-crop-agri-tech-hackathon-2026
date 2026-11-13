import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/core/theme/tone.dart';
import 'package:lefi_mobile/features/alerts/domain/brain_alert.dart';
import 'package:lefi_mobile/features/alerts/presentation/brain_alerts_view.dart';
import 'package:lefi_mobile/features/devices/domain/field_device.dart';
import 'package:lefi_mobile/features/devices/presentation/devices_screen.dart';

// Fake answers (test only), shaped like AlertListOut / AlertDetailOut / DeviceDetailOut.
Map<String, dynamic> _alert({String status = 'open', String origin = 'LIVE', String source = 'rule'}) => {
  'id': 'a1',
  'rule': 'device_contact',
  'source': source,
  'title': 'Fake ESP32 is not in contact',
  'detail': 'No heartbeat for 2 min (test).',
  'severity': 'critical',
  'status': status,
  'subject': {'kind': 'device', 'id': 'esp-fake', 'label': 'Fake ESP32', 'zone_id': null, 'plant_id': null},
  'origin': origin,
  'condition_active': true,
  'opened_at': '2026-11-11T10:00:00Z',
  'updated_at': '2026-11-11T10:05:00Z',
  'occurrences': 3,
  'facts': {},
  'acknowledged_by': null,
  'acknowledged_at': null,
  'assigned_to': null,
  'assigned_to_id': null,
  'resolved_by': null,
  'resolved_at': null,
  'resolution': null,
  'reported_by': null,
};

void main() {
  group('alerts from Lefi Brain (ADR-071)', () {
    test('a list keeps counts, the monitor and what this person may do', () {
      final l = BrainAlertList.fromJson({
        'alerts': [_alert()],
        'counts': {'active': 1, 'critical': 1, 'warning': 0, 'info': 0, 'unacknowledged': 1},
        'monitor': {'state': 'watching', 'reason': 'Watching every device.', 'last_check': null, 'value_rules': 0},
        'people': [],
        'can': {'report': true, 'acknowledge': true, 'assign': false, 'resolve': false, 'configure': false},
      });
      expect(l.alerts.single.subject, 'Fake ESP32');
      expect(l.alerts.single.occurrences, 3);
      expect(l.critical, 1);
      expect(l.canAcknowledge, isTrue);
      expect(l.canResolve, isFalse);
      expect(l.monitorReason, 'Watching every device.');
    });

    test('tags say rule, person or Lefi AI to confirm, and simulation', () {
      final rule = BrainAlert.fromJson(_alert());
      expect(alertTags(rule).map((t) => t.$1), ['Open', 'Rule', '×3']);
      final sim = BrainAlert.fromJson(_alert(origin: 'SIMULATED', source: 'person', status: 'acknowledged'));
      expect(alertTags(sim).map((t) => t.$1), ['Acknowledged', 'Reported by a person', 'Simulation', '×3']);
      final ai = BrainAlert.fromJson(_alert(source: 'ai'));
      expect(alertTags(ai).map((t) => t.$1), ['Open', 'Lefi AI · to confirm', '×3']);
    });

    test('the detail carries its history', () {
      final a = BrainAlert.fromJson({
        ..._alert(),
        'events': [
          {'at': '2026-11-11T10:00:00Z', 'kind': 'opened', 'by': 'Lefi Brain', 'note': null, 'facts': {}},
        ],
      });
      expect(a.events.single.by, 'Lefi Brain');
    });
  });

  group('devices from Lefi Brain (ADR-058, 059)', () {
    Map<String, dynamic> sensor(String state, {double? value, String? error}) => {
      'id': 'esp-fake:air',
      'device_id': 'esp-fake',
      'sensor_key': 'air',
      'channel': {'sensor_key': 'air', 'label': 'Air', 'model': 'FAKE-1'},
      'enabled': state != 'disabled',
      'scope': 'device',
      'target_id': null,
      'target_label': 'air around Fake ESP32',
      'data_state': state,
      'detected': true,
      'last_value_at': '2026-11-11T10:05:00Z',
      'last_error': error,
      'last_error_at': null,
      'latest': [
        {'variable': 'air_temperature', 'label': 'Temperature', 'unit': '°C', 'decimals': 1, 'value': value},
      ],
      'enabled_at': null,
    };

    test('a device keeps connection, health and sensors with their values', () {
      final d = FieldDevice.fromJson({
        'id': 'esp-fake',
        'profile_id': 'lefi-node-esp32.v1',
        'name': 'Fake ESP32',
        'zone_id': null,
        'mac': null,
        'status': 'ACTIVE',
        'origin': 'LIVE',
        'firmware': '0.5.0',
        'created_at': '2026-11-01T00:00:00Z',
        'last_seen_at': '2026-11-11T10:05:00Z',
        'connection': 'online',
        'rssi_dbm': -61,
        'network': 'wifi',
        'health': {'free_heap': 120000, 'ip': '192.0.2.10', 'reset_reason': null},
        'mqtt_account': true,
        'supports_logs': true,
        'sensors_enabled': 1,
        'sensors_total': 2,
        'sensors': [sensor('receiving', value: 23.44)],
        'available_sensors': [],
      });
      expect(connectionOf(d), ('Online', Tone.ok));
      expect(d.health.containsKey('reset_reason'), isFalse);
      expect(d.health['ip'], '192.0.2.10');
      final s = d.sensors.single;
      expect(s.values.single.shown, '23.4 °C');
      expect(dataStateOf(s, simulated: false).$1, 'LIVE');
      expect(dataStateOf(s, simulated: true).$1, 'SIMULATED');
    });

    test('stale, error and waiting sensors are never shown as live', () {
      expect(dataStateOf(FieldSensor.fromJson(sensor('not_receiving', value: 20)), simulated: false).$1, 'STALE');
      expect(dataStateOf(FieldSensor.fromJson(sensor('error', error: 'CRC')), simulated: false).$1, 'ERROR');
      expect(dataStateOf(FieldSensor.fromJson(sensor('waiting')), simulated: false).$1, 'NO DATA');
      expect(FieldSensor.fromJson(sensor('waiting')).values.single.shown, '—');
    });

    test('a device that never connected says so', () {
      final d = FieldDevice.fromJson({'id': 'x', 'connection': 'unknown', 'origin': 'LIVE'});
      expect(connectionOf(d).$1, 'Never connected');
      expect(seenAgo(d.lastSeenAt), 'never');
    });
  });
}
