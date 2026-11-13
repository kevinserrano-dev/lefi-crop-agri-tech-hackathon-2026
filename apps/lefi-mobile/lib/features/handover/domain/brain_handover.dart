import '../../brain/data/brain_json.dart';

/// The shift handover as Lefi Brain keeps it (ADR-095): facts of the outgoing shift from stored
/// data (frozen when signed), Lefi AI's summary (schema-checked; review before signing), signed by
/// the outgoing lead and acknowledged by the incoming team.
class ShiftPerson {
  const ShiftPerson({required this.id, required this.name, required this.role, required this.lead});
  factory ShiftPerson.fromJson(Map<String, dynamic> j) =>
      ShiftPerson(id: js(j['id']), name: js(j['name']), role: js(j['role']), lead: jb(j['lead']));
  final String id;
  final String name;
  final String role;

  /// May sign or acknowledge handovers.
  final bool lead;
}

class ShiftSlot {
  const ShiftSlot({required this.name, required this.day, required this.people, this.start, this.end});
  factory ShiftSlot.fromJson(Map<String, dynamic> j) => ShiftSlot(
    name: js(j['name'], 'Shift'),
    day: js(j['day']),
    start: jt(j['start']),
    end: jt(j['end']),
    people: [for (final p in jl(j['people'])) ShiftPerson.fromJson(p)],
  );
  final String name;
  final String day;
  final DateTime? start;
  final DateTime? end;
  final List<ShiftPerson> people;
}

class HandoverEnvRow {
  const HandoverEnvRow({
    required this.zone,
    required this.measurement,
    required this.last,
    required this.min,
    required this.max,
    required this.avg,
    required this.readings,
    required this.state,
    required this.origin,
    this.unit,
    this.range,
    this.crop,
  });
  factory HandoverEnvRow.fromJson(Map<String, dynamic> j) {
    final r = j['range'];
    return HandoverEnvRow(
      zone: js(j['zone']),
      measurement: js(j['measurement']),
      unit: jsn(j['unit']),
      last: jd(j['last']) ?? 0,
      min: jd(j['min']) ?? 0,
      max: jd(j['max']) ?? 0,
      avg: jd(j['avg']) ?? 0,
      readings: ji(j['readings']),
      state: js(j['state']),
      range: r is List && r.length == 2 ? (jd(r[0]), jd(r[1])) : null,
      crop: jsn(j['crop']),
      origin: js(j['origin'], 'LIVE'),
    );
  }
  final String zone;
  final String measurement;
  final String? unit;
  final double last;
  final double min;
  final double max;
  final double avg;
  final int readings;

  /// in_range · out_of_range · no_range … as Lefi Brain judged it.
  final String state;
  final (double?, double?)? range;
  final String? crop;
  final String origin;
}

class HandoverIncident {
  const HandoverIncident({
    required this.title,
    required this.severity,
    required this.status,
    required this.source,
    this.number,
    this.resolution,
  });
  factory HandoverIncident.fromJson(Map<String, dynamic> j) => HandoverIncident(
    number: jsn(j['number']),
    title: js(j['title']),
    severity: js(j['severity'], 'info'),
    status: js(j['status']),
    source: js(j['source']),
    resolution: jsn(j['resolution']),
  );
  final String? number;
  final String title;
  final String severity;
  final String status;
  final String source;
  final String? resolution;
}

class HandoverTask {
  const HandoverTask({
    required this.title,
    required this.status,
    this.number,
    this.notes,
    this.priority,
    this.waitingForAPerson = false,
  });
  factory HandoverTask.fromJson(Map<String, dynamic> j) => HandoverTask(
    number: jsn(j['number']),
    title: js(j['title']),
    status: js(j['status']),
    notes: jsn(j['notes']),
    priority: jsn(j['priority']),
    waitingForAPerson: jb(j['waiting_for_a_person']),
  );
  final String? number;
  final String title;
  final String status;
  final String? notes;
  final String? priority;
  final bool waitingForAPerson;
}

/// Lefi AI's words about the shift; only when [status] is `done` do they exist.
class HandoverSummary {
  const HandoverSummary({
    required this.status,
    this.happened,
    this.why,
    this.done = const [],
    this.attention = const [],
    this.model,
    this.error,
    this.at,
  });
  factory HandoverSummary.fromJson(Map<String, dynamic> j) => HandoverSummary(
    status: js(j['status'], 'unavailable'),
    happened: jsn(j['happened']),
    why: jsn(j['why']),
    done: jstrs(j['done']),
    attention: jstrs(j['attention']),
    model: jsn(j['model']),
    error: jsn(j['error']),
    at: jt(j['at']),
  );

  /// pending · done · invalid · unavailable · failed
  final String status;
  final String? happened;
  final String? why;
  final List<String> done;
  final List<String> attention;
  final String? model;
  final String? error;
  final DateTime? at;
}

class BrainHandover {
  const BrainHandover({
    required this.id,
    required this.shift,
    required this.day,
    required this.status,
    required this.environment,
    required this.healthRecords,
    required this.healthByState,
    required this.healthIssues,
    required this.incidentsOpened,
    required this.incidentsResolved,
    required this.incidentsActive,
    required this.tasksDone,
    required this.outstandingCount,
    required this.outstanding,
    required this.robotMissions,
    required this.summary,
    required this.origins,
    this.start,
    this.end,
    this.refreshedAt,
    this.signedBy,
    this.signedAt,
    this.signNote,
    this.acknowledgedBy,
    this.acknowledgedAt,
    this.ackNote,
  });

  factory BrainHandover.fromJson(Map<String, dynamic> j) {
    final health = jm(j['plant_health']);
    final out = jm(j['tasks_outstanding']);
    return BrainHandover(
      id: js(j['id']),
      shift: js(j['shift'], 'Shift'),
      day: js(j['day']),
      start: jt(j['start']),
      end: jt(j['end']),
      status: js(j['status'], 'open'),
      refreshedAt: jt(j['refreshed_at']),
      environment: [for (final r in jl(j['environment'])) HandoverEnvRow.fromJson(r)],
      healthRecords: ji(health['records']),
      healthByState: {for (final e in jm(health['by_state']).entries) e.key: ji(e.value)},
      healthIssues: {for (final e in jm(health['issues']).entries) e.key: ji(e.value)},
      incidentsOpened: [for (final x in jl(j['incidents_opened'])) HandoverIncident.fromJson(x)],
      incidentsResolved: [for (final x in jl(j['incidents_resolved'])) HandoverIncident.fromJson(x)],
      incidentsActive: [for (final x in jl(j['incidents_active'])) HandoverIncident.fromJson(x)],
      tasksDone: [for (final x in jl(j['tasks_done'])) HandoverTask.fromJson(x)],
      outstandingCount: ji(out['count']),
      outstanding: [for (final x in jl(out['items'])) HandoverTask.fromJson(x)],
      robotMissions: js(j['robot_missions']),
      summary: HandoverSummary.fromJson(jm(j['summary'])),
      signedBy: jsn(j['signed_by']),
      signedAt: jt(j['signed_at']),
      signNote: jsn(j['sign_note']),
      acknowledgedBy: jsn(j['acknowledged_by']),
      acknowledgedAt: jt(j['acknowledged_at']),
      ackNote: jsn(j['ack_note']),
      origins: jstrs(j['origins']),
    );
  }

  final String id;
  final String shift;
  final String day;
  final DateTime? start;
  final DateTime? end;

  /// open · signed · acknowledged
  final String status;
  final DateTime? refreshedAt;
  final List<HandoverEnvRow> environment;
  final int healthRecords;
  final Map<String, int> healthByState;
  final Map<String, int> healthIssues;
  final List<HandoverIncident> incidentsOpened;
  final List<HandoverIncident> incidentsResolved;
  final List<HandoverIncident> incidentsActive;
  final List<HandoverTask> tasksDone;
  final int outstandingCount;
  final List<HandoverTask> outstanding;
  final String robotMissions;
  final HandoverSummary summary;
  final String? signedBy;
  final DateTime? signedAt;
  final String? signNote;
  final String? acknowledgedBy;
  final DateTime? acknowledgedAt;
  final String? ackNote;
  final List<String> origins;

  bool get simulated => origins.contains('SIMULATED');
}

/// `/handover/current`: the outgoing shift's handover and who hands over to whom.
class HandoverView {
  const HandoverView({
    required this.state,
    required this.canSign,
    required this.canAcknowledge,
    this.reason,
    this.outgoing,
    this.incoming,
    this.handover,
    this.brainTime,
  });
  factory HandoverView.fromJson(Map<String, dynamic> j) => HandoverView(
    state: js(j['state'], 'no_shifts'),
    reason: jsn(j['reason']),
    outgoing: j['outgoing'] is Map<String, dynamic> ? ShiftSlot.fromJson(j['outgoing'] as Map<String, dynamic>) : null,
    incoming: j['incoming'] is Map<String, dynamic> ? ShiftSlot.fromJson(j['incoming'] as Map<String, dynamic>) : null,
    handover: j['handover'] is Map<String, dynamic>
        ? BrainHandover.fromJson(j['handover'] as Map<String, dynamic>)
        : null,
    canSign: jb(j['can_sign']),
    canAcknowledge: jb(j['can_acknowledge']),
    brainTime: jt(j['brain_time']),
  );

  /// ready · no_shifts
  final String state;
  final String? reason;
  final ShiftSlot? outgoing;
  final ShiftSlot? incoming;
  final BrainHandover? handover;
  final bool canSign;
  final bool canAcknowledge;
  final DateTime? brainTime;
}

String handoverStatusLabel(String s) => switch (s) {
  'open' => 'Not signed yet',
  'signed' => 'Signed · waiting for the incoming team',
  'acknowledged' => 'Acknowledged',
  _ => humanize(s),
};
