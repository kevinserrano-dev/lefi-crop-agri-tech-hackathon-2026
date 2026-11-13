import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/demo_latency.dart';
import '../../../demo/demo_notifications.dart';
import '../../auth/application/session.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../domain/app_notification.dart';
import '../domain/notification_repository.dart';
import 'brain_notification_repository.dart';

part 'demo_notification_repository.g.dart';

class DemoNotificationRepository implements NotificationRepository {
  @override
  Future<List<AppNotification>> notifications() => demoDelay(() => demoNotifications);

  @override
  Future<void> acknowledge(String notificationId, String by) => demoDelay(() {}, ms: 600);
}

/// Lefi Brain's notifications when this phone is connected to one (ADR-072), else the demo's.
@Riverpod(keepAlive: true)
NotificationRepository notificationRepository(Ref ref) {
  final auth = ref.watch(activeAuthRepositoryProvider);
  if (auth is BrainAuthRepository) return BrainNotificationRepository(auth);
  return DemoNotificationRepository();
}
