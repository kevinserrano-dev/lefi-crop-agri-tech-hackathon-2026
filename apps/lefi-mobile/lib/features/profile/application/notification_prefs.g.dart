// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'notification_prefs.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Local preference state. Delivery channels (push, SMS, voice) are server-side
/// features behind a `NotificationChannel` interface and disabled by default in
/// an offline LAN deployment — the UI only records the preference.

@ProviderFor(NotificationPrefs)
final notificationPrefsProvider = NotificationPrefsProvider._();

/// Local preference state. Delivery channels (push, SMS, voice) are server-side
/// features behind a `NotificationChannel` interface and disabled by default in
/// an offline LAN deployment — the UI only records the preference.
final class NotificationPrefsProvider
    extends $NotifierProvider<NotificationPrefs, NotificationPrefsState> {
  /// Local preference state. Delivery channels (push, SMS, voice) are server-side
  /// features behind a `NotificationChannel` interface and disabled by default in
  /// an offline LAN deployment — the UI only records the preference.
  NotificationPrefsProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'notificationPrefsProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$notificationPrefsHash();

  @$internal
  @override
  NotificationPrefs create() => NotificationPrefs();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(NotificationPrefsState value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<NotificationPrefsState>(value),
    );
  }
}

String _$notificationPrefsHash() => r'1f13fefbaa81dae994f597953ff93183130ebbbe';

/// Local preference state. Delivery channels (push, SMS, voice) are server-side
/// features behind a `NotificationChannel` interface and disabled by default in
/// an offline LAN deployment — the UI only records the preference.

abstract class _$NotificationPrefs extends $Notifier<NotificationPrefsState> {
  NotificationPrefsState build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref =
        this.ref as $Ref<NotificationPrefsState, NotificationPrefsState>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<NotificationPrefsState, NotificationPrefsState>,
              NotificationPrefsState,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
