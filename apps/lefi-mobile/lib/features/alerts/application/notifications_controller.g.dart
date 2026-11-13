// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'notifications_controller.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(NotificationsController)
final notificationsControllerProvider = NotificationsControllerProvider._();

final class NotificationsControllerProvider
    extends
        $AsyncNotifierProvider<NotificationsController, NotificationsState> {
  NotificationsControllerProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'notificationsControllerProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$notificationsControllerHash();

  @$internal
  @override
  NotificationsController create() => NotificationsController();
}

String _$notificationsControllerHash() =>
    r'33b9e6af9a671aac799f91f3f1e695d2c85d9f2d';

abstract class _$NotificationsController
    extends $AsyncNotifier<NotificationsState> {
  FutureOr<NotificationsState> build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref =
        this.ref as $Ref<AsyncValue<NotificationsState>, NotificationsState>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<AsyncValue<NotificationsState>, NotificationsState>,
              AsyncValue<NotificationsState>,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
