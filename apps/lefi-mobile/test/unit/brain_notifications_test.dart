import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/alerts/data/brain_notification_repository.dart';
import 'package:lefi_mobile/features/alerts/domain/app_notification.dart';
import 'package:lefi_mobile/shared/domain/role.dart';

Map<String, dynamic> fake({String severity = 'warning', String kind = 'alert_raised', String? status}) => {
  'id': 'n1',
  'kind': kind,
  'severity': severity,
  'title': 'Fake ESP32 is not in contact',
  'body': 'Fake body (test)',
  'alert_id': 'a1',
  'alert_status': status,
  'origin': 'SIMULATED',
  'created_at': '2026-11-11T10:05:00Z',
  'read': false,
};

void main() {
  group('notifications from Lefi Brain (ADR-072)', () {
    test('keep their provenance and reach every role on this phone', () {
      final n = notificationFromBrain(fake(), now: DateTime.parse('2026-11-11T12:00:00Z').toLocal());
      expect(n.title, 'Fake ESP32 is not in contact');
      expect(n.simulated, isTrue);
      expect(n.audience, Role.values.toSet());
      expect(n.category, NotificationCategory.maintenance);
      expect(n.acknowledgedBy, isNull);
    });

    test('critical, assigned and acknowledged are shown as such', () {
      expect(notificationFromBrain(fake(severity: 'critical')).category, NotificationCategory.critical);
      expect(notificationFromBrain(fake(kind: 'assigned')).category, NotificationCategory.task);
      expect(notificationFromBrain(fake(status: 'acknowledged')).acknowledgedBy, 'in Lefi Brain');
    });
  });
}
