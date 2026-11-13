// Environmental Monitoring (ADR-084, 097) → the phone (ADR-108). The JSON is a test fixture shaped like
// Lefi Brain's `EnvironmentOut`; no real readings.
import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/environment/domain/brain_environment.dart';

Map<String, dynamic> fixture() => {
  'brain_time': '2026-11-13T12:00:00+00:00',
  'zones': [
    {
      'id': 'z1',
      'name': 'TEST zone',
      'code': 'T1',
      'greenhouse': 'TEST gh',
      'status': 'active',
      'sensors': 2,
      'alerts_critical': 1,
      'alerts_warning': 0,
    },
  ],
  'zone_id': 'z1',
  'window': {'range': '7d', 'since': '2026-11-06T12:00:00+00:00', 'step_s': 10800, 'count': 56},
  'values': [
    {
      'sensor_id': 'd1:air',
      'sensor': 'TEST air',
      'device': 'd1',
      'place': null,
      'origin': 'SIMULATED',
      'state': 'receiving',
      'variable': 'air_temperature',
      'label': 'Air temperature',
      'unit': '°C',
      'value': 22.5,
      'received_at': '2026-11-13T11:59:59+00:00',
      'range': {'min': 18, 'max': 26, 'rule': 'TEST lettuce · v1', 'source': 'species'},
      'in_range': true,
    },
  ],
  'series': [
    {
      'variable': 'air_temperature',
      'label': 'Air temperature',
      'unit': '°C',
      'sensors': 1,
      'origins': ['SIMULATED'],
      'values': [null, 21.0, 22.0, null],
      'range': {'min': 18, 'max': 26, 'rule': 'TEST lettuce · v1', 'source': 'species'},
      'stats': {'current': 22.5, 'average': 21.5, 'min': 21.0, 'max': 22.0, 'time_in_range': 1.0, 'readings': 120},
    },
  ],
  'rules': [],
  'crop_ranges': [
    {
      'crop': 'TEST lettuce',
      'profile': 'v1',
      'profile_id': 'p1',
      'measurement': 'air_temperature',
      'label': 'Air temperature',
      'unit': '°C',
      'optimal': [18, 26],
      'warning': [15, 29],
      'critical': [null, 32],
      'verification': 'illustrative',
      'stage': null,
      'max_change': null,
      'change_window_min': null,
    },
  ],
  'crops': [
    {
      'crop': 'TEST basil',
      'crop_type_id': 'c2',
      'plants': 3,
      'batch': false,
      'knowledge': 'no_profile',
      'profile': null,
      'profile_id': null,
      'parameters': 0,
      'draft_id': null,
    },
  ],
  'can_configure': false,
  'irrigation': {'available': false, 'reason': 'TEST disabled by design'},
};

void main() {
  test('a zone, its window, values, history with gaps, species ranges and why a crop gives none', () {
    final e = BrainEnvironment.fromJson(fixture());
    expect(e.zone!.title, 'TEST zone · T1');
    expect(e.range, '7d');
    expect(e.stepS, 10800);
    expect(e.values.single.simulated, isTrue);
    final s = e.series.single;
    expect(s.values, [null, 21.0, 22.0, null]);
    expect(s.empty, isFalse);
    expect(s.simulated, isTrue);
    expect(s.range!.source, 'species');
    expect(s.stats.timeInRange, 1.0);
    final c = e.cropRanges.single;
    expect(c.optimal, [18, 26]);
    expect(c.critical, [null, 32]);
    expect(verificationLabel(c.verification), contains('Illustrative'));
    expect(cropKnowledgeLabel(e.crops.single.knowledge), contains('No profile'));
    expect(e.irrigation, 'TEST disabled by design');
  });

  test('ranges and values are written without inventing a bound', () {
    expect(fmtEnvRange(18, 26, '°C'), '18 – 26 °C');
    expect(fmtEnvRange(null, 32), '≤ 32');
    expect(fmtEnvRange(5.5, null, 'pH'), '≥ 5.50 pH');
    expect(fmtEnvRange(null, null), '—');
    expect(fmtEnvValue(null, '°C'), '—');
    expect(fmtEnvValue(21.04, '°C'), '21.0 °C');
    expect(fmtEnvValue(1250, 'µS/cm'), '1250 µS/cm');
  });
}
