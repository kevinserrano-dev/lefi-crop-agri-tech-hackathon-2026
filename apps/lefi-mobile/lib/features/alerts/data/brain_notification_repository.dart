import '../../../shared/domain/role.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../domain/app_notification.dart';
import '../domain/notification_repository.dart';

/// One notification as Lefi Brain sends it (ADR-072) → what the Alerts tab shows. Lefi Brain has
/// already chosen who receives it, so every role on this phone sees it.
AppNotification notificationFromBrain(Map<String, dynamic> j, {DateTime? now}) {
  final created = DateTime.tryParse(j['created_at'] as String? ?? '')?.toLocal() ?? DateTime.now();
  final today = now ?? DateTime.now();
  final severity = j['severity'] as String? ?? 'info';
  final kind = j['kind'] as String? ?? '';
  final category = severity == 'critical' || kind == 'escalation'
      ? NotificationCategory.critical
      : kind == 'assigned' || kind == 'task_waiting'
      ? NotificationCategory.task
      : NotificationCategory.maintenance;
  String two(int v) => v.toString().padLeft(2, '0');
  final status = j['alert_status'] as String?;
  return AppNotification(
    id: j['id'] as String,
    category: category,
    title: j['title'] as String? ?? '',
    body: j['body'] as String? ?? '',
    time: '${two(created.hour)}:${two(created.minute)}',
    today: created.year == today.year && created.month == today.month && created.day == today.day,
    audience: Role.values.toSet(),
    incident: j['alert_id'] == null ? null : 'Alert',
    acknowledgedBy: switch (status) {
      'acknowledged' => 'in Lefi Brain',
      'resolved' => 'resolved in Lefi Brain',
      _ => null,
    },
    simulated: j['origin'] == 'SIMULATED',
  );
}

/// The signed-in person's notifications from Lefi Brain, through Lefi Gateway (ADR-068, 072).
/// There is no cloud push: they arrive while the app is open and connected.
class BrainNotificationRepository implements NotificationRepository {
  BrainNotificationRepository(this.brain);

  final BrainAuthRepository brain;

  /// Filled by [notifications]: what Lefi Brain says is already read, and each one's alert.
  final Set<String> readIds = {};
  final Map<String, String> _alertOf = {};

  @override
  Future<List<AppNotification>> notifications() async {
    final a = await brain.api('GET', '/notifications?limit=50');
    final items = (a.json['items'] as List? ?? const []).whereType<Map<String, dynamic>>();
    readIds.clear();
    _alertOf.clear();
    final out = <AppNotification>[];
    for (final j in items) {
      final id = j['id'] as String;
      if (j['read'] == true) readIds.add(id);
      final alert = j['alert_id'];
      if (alert is String) _alertOf[id] = alert;
      out.add(notificationFromBrain(j));
    }
    return out;
  }

  Future<void> markRead(List<String>? ids) async {
    await brain.api('POST', '/notifications/read', body: ids == null ? const <String, Object>{} : {'ids': ids});
  }

  /// Acknowledges the alert behind the notification (Lefi Brain checks `incident.ack`).
  @override
  Future<void> acknowledge(String notificationId, String by) async {
    final alert = _alertOf[notificationId];
    if (alert == null) return;
    await brain.api('POST', '/alerts/$alert/acknowledge');
    await markRead([notificationId]);
  }
}
