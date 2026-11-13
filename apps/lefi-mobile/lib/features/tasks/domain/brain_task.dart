import '../../brain/data/brain_json.dart';

/// A task as Lefi Brain keeps it (ADR-089, 093). Made from an alert by Lefi Brain, from a Lefi AI
/// photo finding to confirm, or by a person; done by a person, verified by someone else.
class BrainTask {
  const BrainTask({
    required this.id,
    required this.number,
    required this.title,
    required this.detail,
    required this.kind,
    required this.assignee,
    required this.status,
    required this.priority,
    required this.source,
    required this.origin,
    required this.createdAt,
    required this.createdBy,
    this.forRole,
    this.assignedTo,
    this.assignedToName,
    this.zoneId,
    this.zone,
    this.plantId,
    this.alertId,
    this.alertNumber,
    this.dueAt,
    this.startedBy,
    this.startedAt,
    this.completedBy,
    this.completedAt,
    this.verifiedBy,
    this.verifiedAt,
    this.reviewNote,
    this.closedBy,
    this.closedAt,
    this.outcome,
    this.robotNote,
  });

  factory BrainTask.fromJson(Map<String, dynamic> j) => BrainTask(
    id: js(j['id']),
    number: jsn(j['number']),
    title: js(j['title'], 'Task'),
    detail: js(j['detail']),
    kind: js(j['kind'], 'other'),
    assignee: js(j['assignee'], 'person'),
    status: js(j['status'], 'open'),
    priority: js(j['priority'], 'normal'),
    source: js(j['source'], 'person'),
    origin: js(j['origin'], 'LIVE'),
    createdAt: jt(j['created_at']),
    createdBy: js(j['created_by'], 'Lefi Brain'),
    forRole: jsn(j['for_role']),
    assignedTo: jsn(j['assigned_to']),
    assignedToName: jsn(j['assigned_to_name']),
    zoneId: jsn(j['zone_id']),
    zone: jsn(j['zone']),
    plantId: jsn(j['plant_id']),
    alertId: jsn(j['alert_id']),
    alertNumber: jsn(j['alert_number']),
    dueAt: jt(j['due_at']),
    startedBy: jsn(j['started_by']),
    startedAt: jt(j['started_at']),
    completedBy: jsn(j['completed_by']),
    completedAt: jt(j['completed_at']),
    verifiedBy: jsn(j['verified_by']),
    verifiedAt: jt(j['verified_at']),
    reviewNote: jsn(j['review_note']),
    closedBy: jsn(j['closed_by']),
    closedAt: jt(j['closed_at']),
    outcome: jsn(j['outcome']),
    robotNote: jsn(j['robot_note']),
  );

  final String id;
  final String? number;
  final String title;
  final String detail;

  /// inspect_plants · check_environment · check_sensor · check_device · check_system ·
  /// robot_inspection · other
  final String kind;

  /// person · robot
  final String assignee;

  /// open · in_progress · awaiting · verified · done · cancelled
  final String status;

  /// low · normal · high · urgent
  final String priority;

  /// rule (from a Lefi Brain alert) · ai (Lefi AI photo finding to confirm) · person
  final String source;
  final String origin;
  final DateTime? createdAt;
  final String createdBy;
  final String? forRole;
  final String? assignedTo;
  final String? assignedToName;
  final String? zoneId;
  final String? zone;
  final String? plantId;
  final String? alertId;
  final String? alertNumber;
  final DateTime? dueAt;
  final String? startedBy;
  final DateTime? startedAt;
  final String? completedBy;
  final DateTime? completedAt;
  final String? verifiedBy;
  final DateTime? verifiedAt;
  final String? reviewNote;
  final String? closedBy;
  final DateTime? closedAt;
  final String? outcome;
  final String? robotNote;

  String get label => number ?? 'Task';
  bool get active => status == 'open' || status == 'in_progress' || status == 'awaiting';
  bool get working => status == 'open' || status == 'in_progress';
  bool get robot => assignee == 'robot';
  bool get simulated => origin == 'SIMULATED';

  /// Due time passed while the task is still to do.
  bool overdue(DateTime now) => working && dueAt != null && dueAt!.isBefore(now);

  /// The tasks a person calls "mine": assigned to them, or unassigned and meant for their role.
  bool isMine(String userId, String roleId) =>
      assignedTo == userId || (assignedTo == null && !robot && forRole == roleId);
}

class TaskPerson {
  const TaskPerson(this.id, this.name, this.role);
  final String id;
  final String name;
  final String role;
}

class TaskCounts {
  const TaskCounts({
    this.open = 0,
    this.inProgress = 0,
    this.awaiting = 0,
    this.verified = 0,
    this.all = 0,
    this.urgent = 0,
    this.robot = 0,
  });

  factory TaskCounts.fromJson(Map<String, dynamic> j) => TaskCounts(
    open: ji(j['open']),
    inProgress: ji(j['in_progress']),
    awaiting: ji(j['awaiting']),
    verified: ji(j['verified']),
    all: ji(j['all']),
    urgent: ji(j['urgent']),
    robot: ji(j['robot']),
  );

  final int open;
  final int inProgress;
  final int awaiting;
  final int verified;
  final int all;
  final int urgent;
  final int robot;
}

class BrainTaskList {
  const BrainTaskList({
    required this.tasks,
    this.people = const [],
    this.counts = const TaskCounts(),
    this.robotReason = '',
    this.canCreate = false,
    this.canSeeAll = false,
    this.canVerify = false,
  });

  factory BrainTaskList.fromJson(Map<String, dynamic> j) => BrainTaskList(
    tasks: [for (final t in jl(j['tasks'])) BrainTask.fromJson(t)],
    people: [for (final p in jl(j['people'])) TaskPerson(js(p['id']), js(p['name']), js(p['role']))],
    counts: TaskCounts.fromJson(jm(j['counts'])),
    robotReason: js(jm(j['robot'])['reason']),
    canCreate: jb(j['can_create']),
    canSeeAll: jb(j['can_see_all']),
    canVerify: jb(j['can_verify']),
  );

  final List<BrainTask> tasks;
  final List<TaskPerson> people;
  final TaskCounts counts;
  final String robotReason;
  final bool canCreate;
  final bool canSeeAll;
  final bool canVerify;
}

class TaskPhoto {
  const TaskPhoto({
    required this.id,
    required this.taskId,
    required this.contentType,
    required this.size,
    required this.uploadedBy,
    required this.uploadedAt,
    this.note,
  });

  factory TaskPhoto.fromJson(Map<String, dynamic> j) => TaskPhoto(
    id: js(j['id']),
    taskId: js(j['task_id']),
    contentType: js(j['content_type']),
    size: ji(j['size']),
    uploadedBy: js(j['uploaded_by']),
    uploadedAt: jt(j['uploaded_at']),
    note: jsn(j['note']),
  );

  final String id;
  final String taskId;
  final String contentType;
  final int size;
  final String uploadedBy;
  final DateTime? uploadedAt;
  final String? note;
}

/// What a new task needs (only with `task.assign`).
class NewTask {
  const NewTask({
    required this.title,
    this.detail,
    this.kind = 'other',
    this.priority = 'normal',
    this.zoneId,
    this.plantId,
    this.assignedTo,
    this.forRole,
    this.dueAt,
  });

  final String title;
  final String? detail;
  final String kind;
  final String priority;
  final String? zoneId;
  final String? plantId;
  final String? assignedTo;
  final String? forRole;
  final DateTime? dueAt;

  Map<String, dynamic> toJson() => {
    'title': title.trim(),
    if (detail != null && detail!.trim().isNotEmpty) 'detail': detail!.trim(),
    'kind': kind,
    'priority': priority,
    'zone_id': ?zoneId,
    'plant_id': ?plantId,
    'assigned_to': ?assignedTo,
    'for_role': ?forRole,
    if (dueAt != null) 'due_at': dueAt!.toUtc().toIso8601String(),
  };
}

const taskKinds = ['inspect_plants', 'check_environment', 'check_sensor', 'check_device', 'check_system', 'other'];

const taskPriorities = ['urgent', 'high', 'normal', 'low'];

String taskKindLabel(String k) => switch (k) {
  'inspect_plants' => 'Inspect plants',
  'check_environment' => 'Check environment',
  'check_sensor' => 'Check a sensor',
  'check_device' => 'Check a device',
  'check_system' => 'Check the system',
  'robot_inspection' => 'Robot inspection',
  _ => 'Other',
};

String taskStatusLabel(String s) => switch (s) {
  'open' => 'Open',
  'in_progress' => 'In progress',
  'awaiting' => 'Awaiting verification',
  'verified' => 'Verified',
  'done' => 'Done',
  'cancelled' => 'Cancelled',
  _ => humanize(s),
};

String roleLabel(String r) => switch (r) {
  'admin' => 'System Administrator',
  'manager' => 'Manager',
  'grower' => 'Grower',
  'supervisor' => 'Supervisor',
  'scout' => 'Crop Scout',
  'maint' => 'Maintenance',
  'worker' => 'Worker',
  _ => humanize(r),
};
