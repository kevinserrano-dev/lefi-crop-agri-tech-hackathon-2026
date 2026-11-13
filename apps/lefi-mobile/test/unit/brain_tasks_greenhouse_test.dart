// Lefi Brain's tasks, greenhouses, own shifts and the home's tasks → what the phone shows
// (ADR-100). The JSON follows Lefi Brain's OpenAPI (packages/api/openapi/brain.openapi.json); every
// name here is clearly a test fixture.
import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/greenhouse/domain/brain_greenhouse.dart';
import 'package:lefi_mobile/features/greenhouse/presentation/brain_greenhouse_style.dart';
import 'package:lefi_mobile/features/home/data/brain_dashboard_repository.dart';
import 'package:lefi_mobile/features/home/domain/dashboard.dart';
import 'package:lefi_mobile/features/profile/data/brain_profile_repository.dart';
import 'package:lefi_mobile/features/tasks/domain/brain_task.dart';
import 'package:lefi_mobile/shared/domain/role.dart';

const me = '11111111-1111-1111-1111-111111111111';
const other = '22222222-2222-2222-2222-222222222222';

Map<String, dynamic> task(
  String id, {
  String status = 'open',
  String priority = 'normal',
  String? assignedTo,
  String? forRole,
  String assignee = 'person',
  String? dueAt,
  String source = 'rule',
}) => {
  'id': id,
  'number': 'T-$id',
  'title': 'TEST task $id',
  'detail': 'Check the TEST drip line',
  'kind': 'check_environment',
  'assignee': assignee,
  'status': status,
  'priority': priority,
  'source': source,
  'origin': 'LIVE',
  'created_at': '2026-11-13T08:00:00Z',
  'updated_at': '2026-11-13T08:00:00Z',
  'created_by': 'Lefi Brain',
  'for_role': forRole,
  'assigned_to': assignedTo,
  'assigned_to_name': assignedTo == null ? null : 'TEST Person',
  'zone_id': 'z1',
  'zone': 'TEST Zone A',
  'plant_id': null,
  'alert_id': 'a1',
  'alert_number': 'INC-0007',
  'due_at': dueAt,
  'started_by': null,
  'started_at': null,
  'completed_by': null,
  'completed_at': null,
  'verified_by': null,
  'verified_at': null,
  'review_note': null,
  'closed_by': null,
  'closed_at': null,
  'outcome': null,
  'robot_note': null,
};

Map<String, dynamic> taskList(List<Map<String, dynamic>> tasks, {bool all = false, bool verify = false}) => {
  'tasks': tasks,
  'people': [
    {'id': me, 'name': 'TEST Me', 'role': 'grower'},
  ],
  'counts': {'open': 2, 'in_progress': 1, 'awaiting': 1, 'verified': 0, 'all': 4, 'urgent': 1, 'robot': 0},
  'robot': {'available': false, 'reason': 'Robotics is not built yet.'},
  'can_create': all,
  'can_see_all': all,
  'can_verify': verify,
};

UserProfile user(Role role) => UserProfile(
  role: role,
  roleName: 'TEST',
  short: 'TEST',
  name: 'TEST Me',
  email: 'test@example.invalid',
  colorValue: 0,
  greenhouseScope: 'Lefi Brain',
  shiftLabel: '',
  shiftStartHour: 0,
  shiftEndHour: 24,
  reportsTo: '',
  zones: const [],
  nextShift: '',
  fromBrain: true,
);

void main() {
  group('tasks from Lefi Brain (ADR-089, 093)', () {
    test('a task keeps its number, source, alert and who does it', () {
      final t = BrainTask.fromJson(task('0001', status: 'in_progress', assignedTo: me, priority: 'urgent'));
      expect(t.label, 'T-0001');
      expect(t.alertNumber, 'INC-0007');
      expect(t.active && t.working, isTrue);
      expect(t.isMine(me, 'grower'), isTrue);
      expect(t.isMine(other, 'grower'), isFalse);
      expect(taskStatusLabel(t.status), 'In progress');
    });

    test('mine = assigned to me, or unassigned for my role; never a robot task', () {
      expect(BrainTask.fromJson(task('1', forRole: 'grower')).isMine(me, 'grower'), isTrue);
      expect(BrainTask.fromJson(task('2', forRole: 'scout')).isMine(me, 'grower'), isFalse);
      expect(BrainTask.fromJson(task('3', assignedTo: other, forRole: 'grower')).isMine(me, 'grower'), isFalse);
      expect(BrainTask.fromJson(task('4', assignee: 'robot', forRole: 'grower')).isMine(me, 'grower'), isFalse);
    });

    test('overdue only while still to do, and only with a due time a person set', () {
      final now = DateTime.utc(2026, 11, 13, 12);
      expect(BrainTask.fromJson(task('1', dueAt: '2026-11-13T10:00:00Z')).overdue(now), isTrue);
      expect(BrainTask.fromJson(task('2', dueAt: '2026-11-13T10:00:00Z', status: 'awaiting')).overdue(now), isFalse);
      expect(BrainTask.fromJson(task('3')).overdue(now), isFalse);
    });

    test('the list keeps counts, people and what this person may do', () {
      final l = BrainTaskList.fromJson(taskList([task('1')], all: true, verify: true));
      expect(l.tasks.single.title, 'TEST task 1');
      expect(l.counts.awaiting, 1);
      expect(l.counts.urgent, 1);
      expect(l.people.single.name, 'TEST Me');
      expect(l.canCreate && l.canSeeAll && l.canVerify, isTrue);
      expect(l.robotReason, isNotEmpty);
    });

    test('a new task sends only what the person chose', () {
      final j = NewTask(title: '  Fix TEST valve ', priority: 'high', zoneId: 'z1').toJson();
      expect(j, {'title': 'Fix TEST valve', 'kind': 'other', 'priority': 'high', 'zone_id': 'z1'});
    });
  });

  group('greenhouses, zones and plants from Lefi Brain (ADR-080, 082, 084, 097)', () {
    test('a zone keeps its summary counted by Lefi Brain', () {
      final z = BrainZone.fromJson({
        'id': 'z1',
        'greenhouse_id': 'g1',
        'name': 'TEST Zone A',
        'code': 'ZA',
        'purpose': 'production',
        'purpose_other': null,
        'growing_systems': ['nft'],
        'notes': null,
        'area_m2': 12.5,
        'physical_ref': null,
        'climate_control': 'shared',
        'status': 'active',
        'created_at': '2026-11-01T00:00:00Z',
        'summary': {
          'locations_by_kind': {'bench': 2, 'bucket': 6},
          'plants': 8,
          'batch_plants': 6,
          'active_crops': 1,
        },
      });
      expect(z.title, 'TEST Zone A · ZA');
      expect(z.plants, 8);
      expect(z.batchPlants, 6);
      expect(z.locations, 8);
      expect(purposeLabel(z), 'Production');
    });

    test('readings show provenance first and never invent a range', () {
      EnvValue v(String state, {double? value, Map<String, dynamic>? range, bool? inRange, String origin = 'LIVE'}) =>
          EnvValue.fromJson({
            'sensor_id': 'esp32-01:air-1',
            'sensor': 'TEST air',
            'device': 'TEST board',
            'place': null,
            'origin': origin,
            'state': state,
            'variable': 'air_temperature',
            'label': 'Air temperature',
            'unit': '°C',
            'value': value,
            'received_at': null,
            'range': range,
            'in_range': inRange,
          });
      final live = v(
        'receiving',
        value: 31.2,
        range: {'min': 18, 'max': 26, 'rule': 'TEST · v1', 'source': 'species'},
        inRange: false,
      );
      expect(readingBadge(live).$1, 'LIVE');
      expect(rangeVerdict(live).$1, 'Out of range');
      expect(rangeText(live.range!), '18–26 · species profile');
      expect(readingBadge(v('receiving', value: 20, origin: 'SIMULATED')).$1, 'SIMULATED');
      expect(rangeVerdict(v('receiving', value: 20)).$1, 'No range set');
      expect(readingBadge(v('not_receiving')).$1, 'STALE');
      expect(readingBadge(v('error')).$1, 'ERROR');
      expect(rangeVerdict(v('no_data')).$1, 'No value');
    });

    test('plant health is only what people recorded; no record = not checked', () {
      final board = PlantHealthBoard.fromJson({
        'vision': {'available': false, 'reason': 'No AI vision per plant yet.'},
        'counts': {'plants': 2, 'healthy': 1, 'watch': 0, 'problem': 0, 'not_checked': 1, 'open_requests': 1},
        'plants': [
          {
            'plant_id': 'p1',
            'latest': {
              'id': 'o1',
              'plant_id': 'p1',
              'health': 'healthy',
              'issues': <String>[],
              'note': null,
              'observed_by': 'TEST Scout',
              'observed_at': '2026-11-13T09:00:00Z',
              'source': 'person',
            },
            'open_request': null,
          },
          {
            'plant_id': 'p2',
            'latest': null,
            'open_request': {
              'id': 'r1',
              'plant_id': 'p2',
              'reason': 'TEST yellow leaves',
              'requested_by': 'TEST Grower',
              'requested_at': '2026-11-13T09:00:00Z',
              'status': 'open',
              'closed_by': null,
              'closed_at': null,
            },
          },
        ],
        'issues': ['pest', 'water'],
        'can_observe': true,
        'can_request': false,
      });
      expect(plantHealthTag(board.rows['p1']!.latest!.health).$1, 'Healthy');
      expect(plantHealthTag(board.rows['p2']!.latest?.health).$1, 'Not checked');
      expect(board.rows['p2']!.openRequest!.reason, 'TEST yellow leaves');
      expect(board.issues, ['pest', 'water']);
      expect(board.canObserve, isTrue);
      expect(board.canRequest, isFalse);
      expect(board.visionReason, isNotEmpty);
    });

    test('a crop batch counts its registered plants and its days from the start Lefi Brain keeps', () {
      final b = CropBatch.fromJson({
        'id': 'b1',
        'location_id': 'l1',
        'zone_id': 'z1',
        'crop_type_id': 'c1',
        'variety': null,
        'batch_code': 'TEST-01',
        'plant_quantity': 6,
        'occupied_positions': null,
        'started_on': '2026-11-03',
        'start_event': 'transplanting',
        'growth_stage': 'vegetative',
        'expected_harvest_on': null,
        'notes': null,
        'status': 'active',
        'ended_on': null,
        'end_reason': null,
        'created_at': '2026-11-03T00:00:00Z',
      });
      expect(b.plantQuantity, 6);
      expect(b.daysSinceStart(DateTime(2026, 11, 13, 15)), 10);
    });
  });

  group('own shifts (/shifts/mine, ADR-100)', () {
    test('the current shift, leave and the next shift are read as Lefi Brain gives them', () {
      final s = MyShifts.fromJson({
        'brain_time': '2026-11-13T09:00:00Z',
        'timezone': 'UTC',
        'now': {
          'user_id': me,
          'name': 'TEST Me',
          'role': 'worker',
          'shift': {
            'id': 's',
            'name': 'Day',
            'start': '06:00',
            'end': '14:30',
            'hours': 8.5,
            'overnight': false,
            'tone': 'info',
            'retired': false,
          },
          'day': '2026-11-13',
          'start': '2026-11-13T06:00:00Z',
          'end': '2026-11-13T14:30:00Z',
        },
        'days': [
          {
            'day': '2026-11-13',
            'label': 'Fri 13',
            'today': true,
            'leave': false,
            'shift': {
              'id': 's',
              'name': 'Day',
              'start': '06:00',
              'end': '14:30',
              'hours': 8.5,
              'overnight': false,
              'tone': 'info',
              'retired': false,
            },
            'start': '2026-11-13T06:00:00Z',
            'end': '2026-11-13T14:30:00Z',
          },
          {
            'day': '2026-11-14',
            'label': 'Sat 14',
            'today': false,
            'leave': true,
            'shift': null,
            'start': null,
            'end': null,
          },
          {
            'day': '2026-11-15',
            'label': 'Sun 15',
            'today': false,
            'leave': false,
            'shift': {
              'id': 's',
              'name': 'Day',
              'start': '06:00',
              'end': '14:30',
              'hours': 8.5,
              'overnight': false,
              'tone': 'info',
              'retired': false,
            },
            'start': '2026-11-15T06:00:00Z',
            'end': '2026-11-15T14:30:00Z',
          },
        ],
        'on_call': true,
        'on_call_primary_today': false,
      });
      expect(s.now!.name, 'Day');
      expect(s.days[1].leave, isTrue);
      expect(s.nextShift(DateTime.utc(2026, 11, 13, 9))!.label, 'Sun 15');
      expect(s.onCall, isTrue);
    });

    test('nothing set = no shift, never invented', () {
      final s = MyShifts.fromJson({'timezone': 'UTC', 'now': null, 'days': <Object>[], 'on_call': false});
      expect(s.now, isNull);
      expect(s.nextShift(DateTime.now()), isNull);
    });
  });

  group('the home lists the person\'s tasks (ADR-100)', () {
    final now = DateTime.utc(2026, 11, 13, 12);
    final list = taskList(
      [
        task('1', assignedTo: me, priority: 'urgent'),
        task('2', forRole: 'grower', dueAt: '2026-11-13T10:00:00Z'),
        task('3', assignedTo: other),
        task('4', status: 'awaiting', assignedTo: other),
      ],
      all: true,
      verify: true,
    );

    test('mine first, then work to verify for who verifies; tasks open the task', () {
      expect([for (final t in myTasks(list, me, 'grower')) t['id']], ['1', '2']);
      final overview = {
        'brain_time': '2026-11-13T12:00:00Z',
        'alerts': {'latest': <Object>[]},
      };
      final d = dashboardFromOverview(
        overview,
        user(Role.supervisor),
        now: now,
        tasks: list,
        userId: me,
        roleId: 'grower',
      );
      expect(d.sections.map((s) => s.title).take(3), ['Active alerts', 'My tasks', 'Work to verify']);
      final mine = d.sections[1].rows;
      expect(mine.first.target, isA<TaskTarget>().having((t) => t.id, 'id', '1'));
      expect(mine[1].sub, contains('overdue'));
      expect(d.unavailable, isNot(contains(tasksUnavailable)));
      expect(d.quickActions.first.label, 'Tasks · 2');
    });

    test('a worker (no overview) sees their tasks and nothing invented', () {
      final d = dashboardWithoutOverview(now, user: user(Role.worker), tasks: list, userId: me, roleId: 'grower');
      expect(d.hero.label, 'My tasks');
      expect(d.hero.value, '2');
      expect(d.sections.first.title, 'My tasks');
      expect(d.unavailable, isEmpty);
      // Without tasks it says so instead of showing sample data.
      expect(dashboardWithoutOverview(now).unavailable, [tasksUnavailable]);
    });
  });
}
