/// An alert or incident as Lefi Brain's rules engine keeps it (ADR-071). Field names follow
/// `AlertOut` / `AlertListOut` in `packages/api/openapi/brain.openapi.json`.
class BrainAlert {
  const BrainAlert({
    required this.id,
    required this.title,
    required this.detail,
    required this.severity,
    required this.status,
    required this.source,
    required this.subject,
    required this.simulated,
    required this.conditionActive,
    required this.openedAt,
    required this.updatedAt,
    required this.occurrences,
    this.acknowledgedBy,
    this.acknowledgedAt,
    this.assignedTo,
    this.resolvedBy,
    this.resolvedAt,
    this.resolution,
    this.reportedBy,
    this.events = const [],
  });

  final String id;
  final String title;
  final String detail;

  /// critical · warning · info
  final String severity;

  /// open · acknowledged · resolved
  final String status;

  /// rule (Lefi Brain's rules engine) · person (reported by someone)
  final String source;
  final String subject;
  final bool simulated;
  final bool conditionActive;
  final DateTime? openedAt;
  final DateTime? updatedAt;
  final int occurrences;
  final String? acknowledgedBy;
  final DateTime? acknowledgedAt;
  final String? assignedTo;
  final String? resolvedBy;
  final DateTime? resolvedAt;
  final String? resolution;
  final String? reportedBy;
  final List<BrainAlertEvent> events;

  bool get isOpen => status == 'open';
  bool get isResolved => status == 'resolved';

  static DateTime? _t(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

  factory BrainAlert.fromJson(Map<String, dynamic> j) {
    final subject = j['subject'];
    return BrainAlert(
      id: j['id'] as String,
      title: j['title'] as String? ?? '',
      detail: j['detail'] as String? ?? '',
      severity: j['severity'] as String? ?? 'info',
      status: j['status'] as String? ?? 'open',
      source: j['source'] as String? ?? 'rule',
      subject: subject is Map ? subject['label'] as String? ?? '' : '',
      simulated: j['origin'] == 'SIMULATED',
      conditionActive: j['condition_active'] == true,
      openedAt: _t(j['opened_at']),
      updatedAt: _t(j['updated_at']),
      occurrences: (j['occurrences'] as num?)?.toInt() ?? 1,
      acknowledgedBy: j['acknowledged_by'] as String?,
      acknowledgedAt: _t(j['acknowledged_at']),
      assignedTo: j['assigned_to'] as String?,
      resolvedBy: j['resolved_by'] as String?,
      resolvedAt: _t(j['resolved_at']),
      resolution: j['resolution'] as String?,
      reportedBy: j['reported_by'] as String?,
      events: [
        for (final e in j['events'] is List ? j['events'] as List : const [])
          if (e is Map<String, dynamic>) BrainAlertEvent.fromJson(e),
      ],
    );
  }
}

class BrainAlertEvent {
  const BrainAlertEvent({required this.at, required this.kind, required this.by, this.note});
  final DateTime? at;
  final String kind;
  final String by;
  final String? note;

  factory BrainAlertEvent.fromJson(Map<String, dynamic> j) => BrainAlertEvent(
    at: BrainAlert._t(j['at']),
    kind: j['kind'] as String? ?? '',
    by: j['by'] as String? ?? '',
    note: j['note'] as String?,
  );
}

class BrainAlertList {
  const BrainAlertList({
    required this.alerts,
    required this.active,
    required this.critical,
    required this.warning,
    required this.unacknowledged,
    required this.monitorState,
    required this.monitorReason,
    required this.canAcknowledge,
    required this.canResolve,
  });

  final List<BrainAlert> alerts;
  final int active;
  final int critical;
  final int warning;
  final int unacknowledged;
  final String monitorState;
  final String monitorReason;

  /// What Lefi Brain says this person may do; it checks again on every request.
  final bool canAcknowledge;
  final bool canResolve;

  factory BrainAlertList.fromJson(Map<String, dynamic> j) {
    final counts = j['counts'] is Map ? j['counts'] as Map : const {};
    final monitor = j['monitor'] is Map ? j['monitor'] as Map : const {};
    final can = j['can'] is Map ? j['can'] as Map : const {};
    int n(Object? v) => v is num ? v.toInt() : 0;
    return BrainAlertList(
      alerts: [
        for (final a in j['alerts'] is List ? j['alerts'] as List : const [])
          if (a is Map<String, dynamic>) BrainAlert.fromJson(a),
      ],
      active: n(counts['active']),
      critical: n(counts['critical']),
      warning: n(counts['warning']),
      unacknowledged: n(counts['unacknowledged']),
      monitorState: monitor['state'] as String? ?? '',
      monitorReason: monitor['reason'] as String? ?? '',
      canAcknowledge: can['acknowledge'] == true,
      canResolve: can['resolve'] == true,
    );
  }
}
