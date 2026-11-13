import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/home/data/brain_dashboard_repository.dart';
import 'package:lefi_mobile/features/home/domain/dashboard.dart';
import 'package:lefi_mobile/shared/domain/role.dart';

/// A fake `/overview` answer (test only), shaped like Lefi Brain's OverviewOut (ADR-070).
Map<String, dynamic> fakeOverview() => {
  'brain_time': '2026-11-11T12:00:00Z',
  'places': {'greenhouses': 1, 'zones': 2, 'locations': 4, 'plants': 3, 'active_crops': 1, 'crop_plants': 3},
  'zones': [
    {'id': 'z1', 'name': 'Fake zone A', 'greenhouse': 'Fake GH', 'status': 'active', 'plants': 3, 'active_crops': 1},
  ],
  'crops': [
    {'crop': 'Fake lettuce', 'assignments': 1, 'plants': 3},
  ],
  'plant_health': {
    'plants': 3,
    'healthy': 1,
    'watch': 1,
    'problem': 0,
    'not_checked': 1,
    'open_requests': 2,
    'recent': [
      {
        'plant_id': 'p1',
        'plant': 'FAKE-01',
        'health': 'watch',
        'issues': ['wilting'],
        'by': 'Fake Person',
        'at': '2026-11-11T11:00:00Z',
      },
    ],
    'vision': {'available': false, 'reason': 'No AI vision model is installed.'},
  },
  'devices': {
    'total': 2,
    'online': 1,
    'offline': 1,
    'never_connected': 0,
    'pending': 0,
    'simulated': 0,
    'sensors': {'receiving': 1, 'error': 1},
  },
  'readings': [
    {
      'sensor_id': 'esp-fake:air',
      'sensor': 'Air',
      'device': 'Fake ESP32',
      'place': 'air around Fake ESP32',
      'origin': 'LIVE',
      'state': 'receiving',
      'values': [
        {'variable': 'air_temperature', 'label': 'Temperature', 'value': 23.4, 'unit': '°C'},
      ],
    },
    {
      'sensor_id': 'esp-fake:tds',
      'sensor': 'TDS',
      'device': 'Fake ESP32',
      'place': null,
      'origin': 'LIVE',
      'state': 'error',
      'values': [
        {'variable': 'tds', 'label': 'TDS', 'value': null, 'unit': 'ppm'},
      ],
    },
  ],
  'ai': {'state': 'unreachable', 'reason': 'The AI node does not answer.', 'model': 'fake-model', 'kill_switch': false},
  'people': {'active_users': 4, 'signed_in_now': 2},
  'alerts': {
    'active': 1,
    'critical': 1,
    'warning': 0,
    'unacknowledged': 1,
    'latest': [
      {
        'id': 'a1',
        'title': 'Fake ESP32 is not in contact',
        'severity': 'critical',
        'status': 'open',
        'subject': 'Fake ESP32',
        'origin': 'LIVE',
        'updated_at': '2026-11-11T11:50:00Z',
      },
    ],
    'monitor_state': 'watching',
    'monitor_reason': 'Watching every device.',
  },
};

UserProfile fakeUser(Role role) => UserProfile(
  role: role,
  roleName: role.name,
  short: role.name,
  name: 'Fake Person',
  email: 'fake@example.invalid',
  colorValue: 0xFF000000,
  greenhouseScope: '',
  shiftLabel: '',
  shiftStartHour: 6,
  shiftEndHour: 14.5,
  reportsTo: '',
  zones: const [],
  nextShift: '',
  fromBrain: true,
);

void main() {
  group('home from Lefi Brain /overview (ADR-070)', () {
    test('manager sees real counts, alerts, zones and crops — no sample data', () {
      final d = dashboardFromOverview(fakeOverview(), fakeUser(Role.manager));
      expect(d.source?.label, 'Lefi Brain');
      expect(d.hero.value, '1');
      expect(d.hero.unit, 'of 3 plants healthy');
      expect(d.hero.chips.map((c) => c.label), contains('1 critical'));
      final titles = {for (final s in d.sections) s.title: s.rows.map((r) => r.title).toList()};
      expect(titles['Active alerts'], ['Fake ESP32 is not in contact']);
      expect(titles['Zones'], ['Fake zone A']);
      expect(titles['Crops'], ['Fake lettuce']);
      expect(d.kpis.map((k) => k.value), contains('1 / 2'));
      expect(d.showRobotCard, isFalse);
      expect(d.unavailable, contains('AI vision: No AI vision model is installed.'));
      expect(d.unavailable, contains(tasksUnavailable));
    });

    test('AI state comes from Lefi Brain, never assumed online', () {
      final d = dashboardFromOverview(fakeOverview(), fakeUser(Role.grower));
      expect(d.ai?.available, isFalse);
      expect(d.ai?.state, 'unreachable');
      expect(d.ai?.model, 'fake-model');
    });

    test('readings carry provenance: LIVE value, ERROR without a value', () {
      final d = dashboardFromOverview(fakeOverview(), fakeUser(Role.maint));
      final readings = d.sections.firstWhere((s) => s.title == 'Current readings').rows;
      expect(readings.first.title, 'Air · 23.4 °C');
      expect(readings.first.chip, 'LIVE');
      expect(readings.last.chip, 'ERROR');
      expect(readings.last.chipSeverity, Severity.crit);
      final anomalies = d.sections.firstWhere((s) => s.title == 'Sensor anomalies').rows;
      expect(anomalies.map((r) => r.title), ['TDS']);
      expect(d.hero.unit, 'of 2 devices online');
    });

    test('a simulated sensor is labelled SIMULATED, a stale one STALE', () {
      final sim = readingRow({
        'sensor': 'Air',
        'device': 'Sim',
        'origin': 'SIMULATED',
        'state': 'receiving',
        'values': [
          {'variable': 'air_temperature', 'value': 20, 'unit': '°C'},
        ],
      });
      expect(sim.chip, 'SIMULATED');
      final stale = readingRow({
        'sensor': 'Air',
        'device': 'X',
        'origin': 'LIVE',
        'state': 'not_receiving',
        'values': [],
      });
      expect(stale.chip, 'STALE');
    });

    test('scout sees inspection requests and people\'s observations', () {
      final d = dashboardFromOverview(fakeOverview(), fakeUser(Role.scout));
      expect(d.hero.value, '2');
      final obs = d.sections.firstWhere((s) => s.title == 'Latest observations').rows.single;
      expect(obs.title, 'FAKE-01 · watch');
      expect(obs.chip, 'Human');
    });

    test('a role without the overview gets no sample data', () {
      final d = dashboardWithoutOverview(DateTime(2026, 11, 11, 9, 5));
      expect(d.sections, isEmpty);
      expect(d.kpis, isEmpty);
      expect(d.hero.sub, dashboardNotAllowed);
      expect(d.source?.at, '09:05');
    });
  });
}
