import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../data/brain_notification_repository.dart';
import '../data/demo_notification_repository.dart';
import '../domain/app_notification.dart';

part 'notifications_controller.g.dart';

class NotificationsState {
  const NotificationsState(this.items, {this.read = const {}, this.acked = const {}});

  /// Notifications addressed to the signed-in role.
  final List<AppNotification> items;
  final Set<String> read;

  /// Acknowledgements made from this device: id → "who · time".
  final Map<String, String> acked;

  int get unread => items.where((n) => !read.contains(n.id)).length;

  String? ackLine(AppNotification n) => acked[n.id] ?? n.acknowledgedBy;

  NotificationsState copyWith({Set<String>? read, Map<String, String>? acked}) =>
      NotificationsState(items, read: read ?? this.read, acked: acked ?? this.acked);
}

@Riverpod(keepAlive: true)
class NotificationsController extends _$NotificationsController {
  /// How often a phone connected to Lefi Brain asks for new notifications (no cloud push).
  static const brainPoll = Duration(seconds: 15);

  @override
  Future<NotificationsState> build() async {
    final role = ref.watch(currentUserProvider).role;
    final repo = ref.watch(notificationRepositoryProvider);
    final all = await repo.notifications();
    if (repo is BrainNotificationRepository) {
      // Lefi Brain already chose who receives each one; ask again in a while.
      final timer = Timer(brainPoll, ref.invalidateSelf);
      ref.onDispose(timer.cancel);
      return NotificationsState(all, read: {...repo.readIds});
    }
    return NotificationsState(all.where((n) => n.audience.contains(role)).toList());
  }

  void markRead(String id) {
    final s = state.requireValue;
    state = AsyncData(s.copyWith(read: {...s.read, id}));
    final repo = ref.read(notificationRepositoryProvider);
    if (repo is BrainNotificationRepository) unawaited(repo.markRead([id]).catchError((Object _) {}));
  }

  void markAllRead() {
    final s = state.requireValue;
    state = AsyncData(s.copyWith(read: {...s.read, ...s.items.map((n) => n.id)}));
    final repo = ref.read(notificationRepositoryProvider);
    if (repo is BrainNotificationRepository) unawaited(repo.markRead(null).catchError((Object _) {}));
  }

  Future<void> acknowledge(String id) async {
    final who = ref.read(currentUserProvider).name;
    await ref.read(notificationRepositoryProvider).acknowledge(id, who);
    final now = DateTime.now();
    String two(int v) => v.toString().padLeft(2, '0');
    final s = state.requireValue;
    state = AsyncData(s.copyWith(acked: {...s.acked, id: '$who · ${two(now.hour)}:${two(now.minute)}'}));
  }
}
