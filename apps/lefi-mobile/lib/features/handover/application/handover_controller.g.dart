// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'handover_controller.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(currentHandover)
final currentHandoverProvider = CurrentHandoverProvider._();

final class CurrentHandoverProvider
    extends
        $FunctionalProvider<
          AsyncValue<ShiftHandover>,
          ShiftHandover,
          FutureOr<ShiftHandover>
        >
    with $FutureModifier<ShiftHandover>, $FutureProvider<ShiftHandover> {
  CurrentHandoverProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'currentHandoverProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$currentHandoverHash();

  @$internal
  @override
  $FutureProviderElement<ShiftHandover> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<ShiftHandover> create(Ref ref) {
    return currentHandover(ref);
  }
}

String _$currentHandoverHash() => r'bde9b39bdec638ee2dad3453f49d85fb8eaf929e';

/// Acknowledgement line once the current user acknowledged the handover.

@ProviderFor(HandoverAck)
final handoverAckProvider = HandoverAckProvider._();

/// Acknowledgement line once the current user acknowledged the handover.
final class HandoverAckProvider
    extends $NotifierProvider<HandoverAck, String?> {
  /// Acknowledgement line once the current user acknowledged the handover.
  HandoverAckProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'handoverAckProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$handoverAckHash();

  @$internal
  @override
  HandoverAck create() => HandoverAck();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(String? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<String?>(value),
    );
  }
}

String _$handoverAckHash() => r'd5ea06426259f3d3cdb1c8767e793cc0df1ad9c2';

/// Acknowledgement line once the current user acknowledged the handover.

abstract class _$HandoverAck extends $Notifier<String?> {
  String? build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<String?, String?>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<String?, String?>,
              String?,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
