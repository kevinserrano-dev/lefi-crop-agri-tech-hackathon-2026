import 'app_notification.dart';

abstract interface class NotificationRepository {
  Future<List<AppNotification>> notifications();
  Future<void> acknowledge(String notificationId, String by);
}
