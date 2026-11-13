import '../../brain/data/brain_json.dart';

/// What a plant's NFC tag carries (ADR-109): an address only this app opens, with the plant's id.
/// Local: no domain and no internet; the phone then asks Lefi Brain through Lefi Gateway.
const plantTagScheme = 'leficrop';
const plantTagHost = 'lefi';

String plantTagUrl(String plantId) => '$plantTagScheme://$plantTagHost/plant/$plantId';

/// The plant id (or code) in a tag's address, or null when it is not a plant tag.
String? plantRefFromTag(Uri uri) {
  final s = uri.pathSegments;
  if (s.length != 2 || s.first != 'plant') return null;
  return RegExp(r'^[A-Za-z0-9._-]{1,64}$').hasMatch(s.last) ? s.last : null;
}

/// One value of a sensor (`plant_details` / `current_readings`).
class SummaryValue {
  const SummaryValue({required this.label, this.value, this.unit, this.receivedAt});
  factory SummaryValue.fromJson(Map<String, dynamic> j) => SummaryValue(
    label: js(j['label'], humanize(js(j['variable']))),
    value: jd(j['value']),
    unit: jsn(j['unit']),
    receivedAt: jt(j['received_at']),
  );
  final String label;
  final double? value;
  final String? unit;
  final DateTime? receivedAt;
}

class SummarySensor {
  const SummarySensor({
    required this.id,
    required this.sensor,
    required this.device,
    required this.origin,
    required this.state,
    required this.values,
    this.place,
    this.relation,
    this.error,
  });
  factory SummarySensor.fromJson(Map<String, dynamic> j) => SummarySensor(
    id: js(j['sensor_id']),
    sensor: js(j['sensor'], 'Sensor'),
    device: js(j['device']),
    origin: js(j['origin'], 'LIVE'),
    state: js(j['state'], 'no_data'),
    place: jsn(j['place']),
    relation: jsn(j['relation']),
    error: jsn(j['last_error']),
    values: [for (final v in jl(j['values'])) SummaryValue.fromJson(v)],
  );
  final String id;
  final String sensor;
  final String device;
  final String origin;

  /// receiving · no_data · error · …
  final String state;
  final String? place;

  /// How the sensor relates to the plant (its own, its container's, …); null for zone readings.
  final String? relation;
  final String? error;
  final List<SummaryValue> values;

  bool get simulated => origin == 'SIMULATED';
}

class SummaryAlert {
  const SummaryAlert({
    required this.id,
    required this.title,
    required this.severity,
    required this.status,
    required this.source,
    required this.origin,
    required this.scope,
    this.number,
    this.detail = '',
    this.openedAt,
  });
  factory SummaryAlert.fromJson(Map<String, dynamic> j) => SummaryAlert(
    id: js(j['id']),
    number: jsn(j['number']),
    title: js(j['title']),
    detail: js(j['detail']),
    severity: js(j['severity'], 'warning'),
    status: js(j['status'], 'open'),
    source: js(j['source'], 'rule'),
    origin: js(j['origin'], 'LIVE'),
    scope: js(j['scope'], 'zone'),
    openedAt: jt(j['opened_at']),
  );
  final String id;
  final String? number;
  final String title;
  final String detail;
  final String severity;
  final String status;

  /// rule · person · ai
  final String source;
  final String origin;

  /// plant · sensor (one of its own) · zone (where it grows)
  final String scope;
  final DateTime? openedAt;
}

class SummaryTask {
  const SummaryTask({
    required this.id,
    required this.title,
    required this.status,
    required this.priority,
    required this.assignee,
    this.number,
    this.assignedTo,
    this.forRole,
    this.dueAt,
  });
  factory SummaryTask.fromJson(Map<String, dynamic> j) => SummaryTask(
    id: js(j['id']),
    number: jsn(j['number']),
    title: js(j['title']),
    status: js(j['status'], 'open'),
    priority: js(j['priority'], 'normal'),
    assignee: js(j['assignee'], 'person'),
    assignedTo: jsn(j['assigned_to']),
    forRole: jsn(j['for_role']),
    dueAt: jt(j['due_at']),
  );
  final String id;
  final String? number;
  final String title;
  final String status;
  final String priority;
  final String assignee;
  final String? assignedTo;
  final String? forRole;
  final DateTime? dueAt;
}

class SummaryEvent {
  const SummaryEvent({required this.kind, required this.text, this.at, this.by});
  factory SummaryEvent.fromJson(Map<String, dynamic> j) =>
      SummaryEvent(kind: js(j['kind']), text: js(j['text']), at: jt(j['at']), by: jsn(j['by']));

  /// observation · task · alert
  final String kind;
  final String text;
  final DateTime? at;
  final String? by;
}

/// Everything Lefi Brain holds about one plant for this person (`GET /plants/{ref}/summary`).
/// A null list = the person's role does not see that part (never "nothing there").
class PlantSummary {
  const PlantSummary({
    required this.id,
    required this.code,
    required this.sensors,
    required this.history,
    required this.canAskAi,
    this.zoneReadings,
    this.activeAlerts,
    this.openTasks,
    this.latestHealth,
    this.zone,
    this.greenhouse,
    this.at,
  });
  factory PlantSummary.fromJson(Map<String, dynamic> j) {
    final p = jm(j['plant']);
    final alerts = j['alerts'] is Map<String, dynamic> ? j['alerts'] as Map<String, dynamic> : null;
    final tasks = j['tasks'] is Map<String, dynamic> ? j['tasks'] as Map<String, dynamic> : null;
    final health = j['health'] is Map<String, dynamic> ? j['health'] as Map<String, dynamic> : null;
    return PlantSummary(
      id: js(p['id']),
      code: js(p['code']),
      zone: jsn(p['zone']),
      greenhouse: jsn(p['greenhouse']),
      at: jt(j['at']),
      sensors: [for (final s in jl(j['sensors'])) SummarySensor.fromJson(s)],
      zoneReadings: j['zone_readings'] is List
          ? [for (final s in jl(j['zone_readings'])) SummarySensor.fromJson(s)]
          : null,
      activeAlerts: alerts == null ? null : [for (final a in jl(alerts['active'])) SummaryAlert.fromJson(a)],
      openTasks: tasks == null ? null : [for (final t in jl(tasks['open'])) SummaryTask.fromJson(t)],
      latestHealth: health == null ? null : jsn(health['latest']),
      history: [for (final e in jl(j['history'])) SummaryEvent.fromJson(e)],
      canAskAi: jb(j['can_ask_ai']),
    );
  }
  final String id;
  final String code;
  final String? zone;
  final String? greenhouse;
  final DateTime? at;
  final List<SummarySensor> sensors;
  final List<SummarySensor>? zoneReadings;
  final List<SummaryAlert>? activeAlerts;
  final List<SummaryTask>? openTasks;
  final String? latestHealth;
  final List<SummaryEvent> history;
  final bool canAskAi;
}

/// Lefi AI's short summary of the plant for this person (`/plants/{ref}/ai-summary`, ADR-109).
class PlantAiSummary {
  const PlantAiSummary({required this.status, required this.attention, this.model, this.summary, this.error, this.at});
  factory PlantAiSummary.fromJson(Map<String, dynamic> j) => PlantAiSummary(
    status: js(j['status'], 'none'),
    model: jsn(j['model']),
    summary: jsn(j['summary']),
    attention: jstrs(j['attention']),
    error: jsn(j['error']),
    at: jt(j['finished_at']) ?? jt(j['requested_at']),
  );

  /// none · pending · done · invalid · unavailable · failed
  final String status;
  final String? model;

  /// Only when done.
  final String? summary;
  final List<String> attention;
  final String? error;
  final DateTime? at;

  bool get pending => status == 'pending';
  bool get done => status == 'done';
}

String plantAiStatusLabel(PlantAiSummary s) => switch (s.status) {
  'pending' => 'Lefi AI is reading the plant’s facts…',
  'invalid' => 'Lefi AI’s answer did not fit the expected form; nothing is shown.',
  'unavailable' => 'Lefi AI cannot answer now${s.error == null ? '' : ': ${s.error}'}.',
  'failed' => 'Lefi AI could not finish${s.error == null ? '' : ': ${s.error}'}.',
  _ => '',
};
