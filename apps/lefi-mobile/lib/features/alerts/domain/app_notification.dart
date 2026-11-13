import '../../../shared/domain/role.dart';

enum NotificationCategory {
  critical('Critical incidents', 'Critical', 'Push, SMS and voice escalation'),
  task('Assigned tasks', 'Tasks', 'New or changed work assigned to you'),
  health('Plant health warnings', 'Health', 'AI flags and confirmed diagnoses'),
  maintenance('Maintenance requests', 'Maintenance', 'Work orders and device faults'),
  robot('Robot mission results', 'Robot', 'Mission photos and findings'),
  shift('Shift changes', 'Shift', 'Schedule changes and handovers');

  const NotificationCategory(this.label, this.short, this.description);

  final String label;
  final String short;
  final String description;

  Set<Role> get audience => switch (this) {
    critical => {Role.manager, Role.grower, Role.supervisor, Role.maint},
    task || shift => Role.values.toSet(),
    health => {Role.manager, Role.grower, Role.supervisor, Role.scout},
    maintenance => {Role.manager, Role.supervisor, Role.maint},
    robot => {Role.manager, Role.grower, Role.supervisor, Role.scout},
  };
}

enum NotificationActionKind { handover, task, plant, zone, robot }

class NotificationAction {
  const NotificationAction(this.kind, this.label, [this.targetId]);

  final NotificationActionKind kind;
  final String label;
  final String? targetId;
}

class EscalationStep {
  const EscalationStep(this.time, this.what, this.status);

  final String time;
  final String what;
  final String status;
}

class AppNotification {
  const AppNotification({
    required this.id,
    required this.category,
    required this.title,
    required this.body,
    required this.time,
    required this.today,
    required this.audience,
    this.zoneId,
    this.incident,
    this.acknowledgedBy,
    this.simulated = false,
    this.action,
    this.escalation = const [],
  });

  final String id;
  final NotificationCategory category;
  final String title;
  final String body;
  final String time;
  final bool today;
  final Set<Role> audience;
  final String? zoneId;
  final String? incident;
  final String? acknowledgedBy;
  final bool simulated;
  final NotificationAction? action;
  final List<EscalationStep> escalation;
}
