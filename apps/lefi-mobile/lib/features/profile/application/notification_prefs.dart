import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../shared/domain/role.dart';
import '../../alerts/domain/app_notification.dart';

part 'notification_prefs.g.dart';

class NotificationPrefsState {
  const NotificationPrefsState({
    this.disabled = const {},
    this.sms = true,
    this.voice = true,
    this.quietHours = true,
    this.onCall = const {Role.manager, Role.supervisor, Role.maint},
  });

  final Set<(Role, NotificationCategory)> disabled;
  final bool sms;
  final bool voice;
  final bool quietHours;
  final Set<Role> onCall;

  bool isOn(Role r, NotificationCategory c) => c.audience.contains(r) && !disabled.contains((r, c));

  NotificationPrefsState copyWith({
    Set<(Role, NotificationCategory)>? disabled,
    bool? sms,
    bool? voice,
    bool? quietHours,
    Set<Role>? onCall,
  }) => NotificationPrefsState(
    disabled: disabled ?? this.disabled,
    sms: sms ?? this.sms,
    voice: voice ?? this.voice,
    quietHours: quietHours ?? this.quietHours,
    onCall: onCall ?? this.onCall,
  );
}

/// Local preference state. Delivery channels (push, SMS, voice) are server-side
/// features behind a `NotificationChannel` interface and disabled by default in
/// an offline LAN deployment — the UI only records the preference.
@Riverpod(keepAlive: true)
class NotificationPrefs extends _$NotificationPrefs {
  @override
  NotificationPrefsState build() => const NotificationPrefsState();

  void toggle(Role r, NotificationCategory c) {
    final d = {...state.disabled};
    d.contains((r, c)) ? d.remove((r, c)) : d.add((r, c));
    state = state.copyWith(disabled: d);
  }

  void toggleSms() => state = state.copyWith(sms: !state.sms);
  void toggleVoice() => state = state.copyWith(voice: !state.voice);
  void toggleQuiet() => state = state.copyWith(quietHours: !state.quietHours);

  void toggleOnCall(Role r) {
    final s = {...state.onCall};
    s.contains(r) ? s.remove(r) : s.add(r);
    state = state.copyWith(onCall: s);
  }
}
