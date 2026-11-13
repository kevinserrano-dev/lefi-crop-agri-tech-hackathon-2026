// Lefi Brain's shift handover (ADR-095) → what the phone shows (ADR-101). Fixture names are TEST.
import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/handover/domain/brain_handover.dart';

Map<String, dynamic> slot(String name, List<Map<String, dynamic>> people) => {
  'shift_type_id': 's-$name',
  'name': name,
  'day': '2026-11-13',
  'start': '2026-11-13T06:00:00Z',
  'end': '2026-11-13T14:30:00Z',
  'people': people,
};

Map<String, dynamic> handover({String status = 'open', Map<String, dynamic>? summary}) => {
  'id': 'h1',
  'shift': 'TEST Day',
  'day': '2026-11-13',
  'start': '2026-11-13T06:00:00Z',
  'end': '2026-11-13T14:30:00Z',
  'status': status,
  'refreshed_at': '2026-11-13T12:00:00Z',
  'environment': [
    {
      'zone': 'TEST Zone A',
      'measurement': 'Air temperature',
      'unit': '°C',
      'first': 20.1,
      'last': 27.4,
      'avg': 23.0,
      'min': 20.1,
      'max': 27.4,
      'readings': 120,
      'state': "above the species' range",
      'range': [18.0, 26.0],
      'crop': 'TEST Lettuce',
      'origin': 'SIMULATED',
    },
  ],
  'plant_health': {
    'records': 3,
    'by_state': {'healthy': 2, 'watch': 1},
    'issues': {'water': 1},
  },
  'incidents_opened': [
    {'number': 'INC-0003', 'title': 'TEST too warm', 'severity': 'warning', 'status': 'open', 'source': 'rule'},
  ],
  'incidents_resolved': <Object>[],
  'incidents_active': <Object>[],
  'tasks_done': [
    {'number': 'T-0002', 'title': 'TEST vents opened', 'status': 'verified', 'notes': 'TEST done'},
  ],
  'tasks_outstanding': {
    'count': 3,
    'items': [
      {
        'number': 'T-0004',
        'title': 'TEST check pump',
        'priority': 'urgent',
        'status': 'open',
        'waiting_for_a_person': true,
      },
    ],
  },
  'robot_missions': 'TEST no missions in this shift.',
  'summary':
      summary ??
      {
        'status': 'done',
        'happened': 'TEST it got warm in the afternoon.',
        'why': 'TEST vents were closed.',
        'done': ['TEST vents opened'],
        'attention': ['TEST pump check'],
        'model': 'test-model:1b',
        'error': null,
        'at': '2026-11-13T12:00:00Z',
      },
  'signed_by': null,
  'signed_at': null,
  'sign_note': null,
  'acknowledged_by': null,
  'acknowledged_at': null,
  'ack_note': null,
  'origins': ['SIMULATED'],
};

void main() {
  test('the current handover keeps both shifts, the facts and Lefi AI\'s summary apart', () {
    final v = HandoverView.fromJson({
      'brain_time': '2026-11-13T12:00:00Z',
      'state': 'ready',
      'reason': null,
      'outgoing': slot('TEST Day', [
        {'id': 'u1', 'name': 'TEST Sue', 'role': 'supervisor', 'lead': true},
        {'id': 'u2', 'name': 'TEST Wil', 'role': 'worker', 'lead': false},
      ]),
      'incoming': slot('TEST Night', <Map<String, dynamic>>[]),
      'handover': handover(),
      'can_sign': true,
      'can_acknowledge': true,
    });
    expect(v.outgoing!.people.where((p) => p.lead).single.name, 'TEST Sue');
    expect(v.incoming!.people, isEmpty);
    final h = v.handover!;
    expect(h.simulated, isTrue);
    expect(h.environment.single.range, (18.0, 26.0));
    expect(h.environment.single.state, startsWith('above'));
    expect(h.healthByState, {'healthy': 2, 'watch': 1});
    expect(h.incidentsOpened.single.number, 'INC-0003');
    expect(h.outstandingCount, 3);
    expect(h.outstanding.single.waitingForAPerson, isTrue);
    expect(h.summary.status, 'done');
    expect(h.summary.attention, ['TEST pump check']);
    expect(h.summary.model, 'test-model:1b');
    expect(handoverStatusLabel(h.status), 'Not signed yet');
  });

  test('no summary words unless Lefi AI produced a valid one', () {
    final h = BrainHandover.fromJson(
      handover(summary: {'status': 'invalid', 'done': <String>[], 'attention': <String>[], 'model': 'test-model:1b'}),
    );
    expect(h.summary.happened, isNull);
    expect(h.summary.done, isEmpty);
  });

  test('without shifts there is no handover, and Lefi Brain says why', () {
    final v = HandoverView.fromJson({
      'state': 'no_shifts',
      'reason': 'No shift has been worked yet.',
      'outgoing': null,
      'incoming': null,
      'handover': null,
      'can_sign': false,
      'can_acknowledge': false,
    });
    expect(v.handover, isNull);
    expect(v.reason, contains('No shift'));
  });
}
