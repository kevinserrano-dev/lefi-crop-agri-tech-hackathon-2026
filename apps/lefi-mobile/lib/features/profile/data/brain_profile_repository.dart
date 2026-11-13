import '../../auth/domain/auth_repository.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../../brain/data/brain_json.dart';

/// A shift type as Lefi Brain keeps it (ADR-094), in the greenhouse's time.
class ShiftKind {
  const ShiftKind({
    required this.name,
    required this.start,
    required this.end,
    required this.hours,
    required this.tone,
  });
  factory ShiftKind.fromJson(Map<String, dynamic> j) => ShiftKind(
    name: js(j['name'], 'Shift'),
    start: js(j['start']),
    end: js(j['end']),
    hours: jd(j['hours']) ?? 0,
    tone: js(j['tone'], 'info'),
  );
  final String name;
  final String start;
  final String end;
  final double hours;
  final String tone;
}

class MyDay {
  const MyDay({
    required this.day,
    required this.label,
    required this.today,
    required this.leave,
    this.shift,
    this.start,
    this.end,
  });
  factory MyDay.fromJson(Map<String, dynamic> j) => MyDay(
    day: js(j['day']),
    label: js(j['label']),
    today: jb(j['today']),
    leave: jb(j['leave']),
    shift: j['shift'] is Map<String, dynamic> ? ShiftKind.fromJson(j['shift'] as Map<String, dynamic>) : null,
    start: jt(j['start']),
    end: jt(j['end']),
  );
  final String day;
  final String label;
  final bool today;
  final bool leave;
  final ShiftKind? shift;
  final DateTime? start;
  final DateTime? end;
}

/// The signed-in person's own shifts (`/shifts/mine`, ADR-100).
class MyShifts {
  const MyShifts({
    required this.days,
    required this.timezone,
    this.now,
    this.nowStart,
    this.nowEnd,
    this.onCall = false,
    this.onCallPrimaryToday = false,
    this.brainTime,
  });

  factory MyShifts.fromJson(Map<String, dynamic> j) {
    final now = jm(j['now']);
    return MyShifts(
      days: [for (final d in jl(j['days'])) MyDay.fromJson(d)],
      timezone: js(j['timezone']),
      now: now.isEmpty ? null : ShiftKind.fromJson(jm(now['shift'])),
      nowStart: jt(now['start']),
      nowEnd: jt(now['end']),
      onCall: jb(j['on_call']),
      onCallPrimaryToday: jb(j['on_call_primary_today']),
      brainTime: jt(j['brain_time']),
    );
  }

  final List<MyDay> days;
  final String timezone;
  final ShiftKind? now;
  final DateTime? nowStart;
  final DateTime? nowEnd;
  final bool onCall;
  final bool onCallPrimaryToday;
  final DateTime? brainTime;

  /// The next shift that has not started yet.
  MyDay? nextShift(DateTime at) =>
      days.where((d) => d.shift != null && d.start != null && d.start!.isAfter(at)).firstOrNull;
}

/// What a person wants to hear about (ADR-072): info · warning · critical · off.
const notificationLevels = ['info', 'warning', 'critical', 'off'];

String notificationLevelLabel(String l) => switch (l) {
  'info' => 'Everything',
  'warning' => 'Warnings and critical',
  'critical' => 'Critical only',
  'off' => 'Off',
  _ => humanize(l),
};

/// Profile data from Lefi Brain: one's own shifts and notification preference.
class BrainProfileRepository {
  BrainProfileRepository(this.brain);
  final BrainAuthRepository brain;

  /// Null when this Lefi Brain is older than `/shifts/mine` (it answers 404): updating it adds it.
  Future<MyShifts?> myShifts() async {
    try {
      return MyShifts.fromJson((await brain.api('GET', '/shifts/mine')).json);
    } on AuthException catch (e) {
      if (e.message.contains('(404)') || e.message.toLowerCase().contains('not found')) return null;
      rethrow;
    }
  }

  Future<String> notificationLevel() async =>
      js((await brain.api('GET', '/notifications/preferences')).json['min_severity'], 'warning');

  Future<String> setNotificationLevel(String level) async => js(
    (await brain.api('PUT', '/notifications/preferences', body: {'min_severity': level})).json['min_severity'],
    level,
  );
}
