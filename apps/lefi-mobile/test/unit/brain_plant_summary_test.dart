// A plant's summary (ADR-109). The JSON is a test fixture shaped like Lefi Brain's
// `PlantSummaryOut` / `PlantAiSummaryOut`; it is not a real plant.
import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/greenhouse/domain/brain_plant_summary.dart';

void main() {
  test('a tag carries the app address with the plant id; anything else is not a plant tag', () {
    const id = '3f2a8c1e-0000-4000-8000-000000000001';
    expect(plantTagUrl(id), 'leficrop://lefi/plant/$id');
    expect(plantRefFromTag(Uri.parse(plantTagUrl(id))), id);
    expect(plantRefFromTag(Uri.parse('leficrop://lefi/plant/P-001')), 'P-001');
    expect(plantRefFromTag(Uri.parse('leficrop://lefi/zone/P-001')), isNull);
    expect(plantRefFromTag(Uri.parse('leficrop://lefi/plant/a%20b')), isNull);
  });

  test('a part the role does not see is null, never an empty list', () {
    final s = PlantSummary.fromJson({
      'at': '2026-11-13T12:00:00+00:00',
      'plant': {'id': 'p1', 'code': 'TEST-1', 'zone': 'TEST zone'},
      'sensors': [
        {
          'sensor_id': 'd1:soil',
          'sensor': 'TEST soil',
          'device': 'esp32-01',
          'origin': 'SIMULATED',
          'state': 'receiving',
          'relation': 'plant',
          'values': [
            {'variable': 'soil_moisture', 'label': 'Soil moisture', 'value': 41.2, 'unit': '%'},
          ],
        },
      ],
      'zone_readings': null,
      'alerts': {
        'active': [
          {
            'id': 'a1',
            'title': 'TEST leaf spots',
            'severity': 'warning',
            'status': 'open',
            'source': 'person',
            'scope': 'plant',
          },
        ],
        'resolved': [],
      },
      'tasks': null,
      'health': {'latest': 'watch', 'observations': [], 'inspection_requested': []},
      'history': [
        {'at': '2026-11-13T11:00:00+00:00', 'kind': 'observation', 'text': 'Recorded watch', 'by': 'TEST'},
      ],
      'can_ask_ai': true,
    });
    expect(s.code, 'TEST-1');
    expect(s.sensors.single.simulated, isTrue);
    expect(s.sensors.single.values.single.value, 41.2);
    expect(s.zoneReadings, isNull);
    expect(s.openTasks, isNull);
    expect(s.activeAlerts!.single.scope, 'plant');
    expect(s.latestHealth, 'watch');
    expect(s.history.single.kind, 'observation');
  });

  test('only a done AI summary carries text', () {
    final done = PlantAiSummary.fromJson({
      'status': 'done',
      'model': 'TEST-model',
      'summary': 'TEST fine.',
      'attention': ['TEST water'],
    });
    expect((done.done, done.summary), (true, 'TEST fine.'));
    expect(done.attention, ['TEST water']);
    final off = PlantAiSummary.fromJson({'status': 'unavailable', 'error': 'TEST stopped', 'attention': []});
    expect(off.done, isFalse);
    expect(plantAiStatusLabel(off), contains('TEST stopped'));
  });
}
