// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'brain_ai_control.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// AI Control & Safety on Lefi Brain for roles with `nav.aiControl`; null otherwise.

@ProviderFor(brainAiControlRepository)
final brainAiControlRepositoryProvider = BrainAiControlRepositoryProvider._();

/// AI Control & Safety on Lefi Brain for roles with `nav.aiControl`; null otherwise.

final class BrainAiControlRepositoryProvider
    extends
        $FunctionalProvider<
          BrainAiControlRepository?,
          BrainAiControlRepository?,
          BrainAiControlRepository?
        >
    with $Provider<BrainAiControlRepository?> {
  /// AI Control & Safety on Lefi Brain for roles with `nav.aiControl`; null otherwise.
  BrainAiControlRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainAiControlRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainAiControlRepositoryHash();

  @$internal
  @override
  $ProviderElement<BrainAiControlRepository?> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  BrainAiControlRepository? create(Ref ref) {
    return brainAiControlRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(BrainAiControlRepository? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<BrainAiControlRepository?>(value),
    );
  }
}

String _$brainAiControlRepositoryHash() =>
    r'ec0b655b6a7fb4211295466748c85ac52c6bf543';

/// True when signed in to Lefi Brain (any role): the demo AI controls must never show then.

@ProviderFor(onBrain)
final onBrainProvider = OnBrainProvider._();

/// True when signed in to Lefi Brain (any role): the demo AI controls must never show then.

final class OnBrainProvider extends $FunctionalProvider<bool, bool, bool>
    with $Provider<bool> {
  /// True when signed in to Lefi Brain (any role): the demo AI controls must never show then.
  OnBrainProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'onBrainProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$onBrainHash();

  @$internal
  @override
  $ProviderElement<bool> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  bool create(Ref ref) {
    return onBrain(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(bool value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<bool>(value),
    );
  }
}

String _$onBrainHash() => r'e5c11238bac9ff90918129671efea328d7639d79';

/// Lefi AI's state for any signed-in role (`GET /ai/assistant`, `ai.chat`, every role): the bar
/// on the other tabs. Null when not on Lefi Brain or when it could not be read.

@ProviderFor(brainAiState)
final brainAiStateProvider = BrainAiStateProvider._();

/// Lefi AI's state for any signed-in role (`GET /ai/assistant`, `ai.chat`, every role): the bar
/// on the other tabs. Null when not on Lefi Brain or when it could not be read.

final class BrainAiStateProvider
    extends
        $FunctionalProvider<
          AsyncValue<BrainAiState?>,
          BrainAiState?,
          FutureOr<BrainAiState?>
        >
    with $FutureModifier<BrainAiState?>, $FutureProvider<BrainAiState?> {
  /// Lefi AI's state for any signed-in role (`GET /ai/assistant`, `ai.chat`, every role): the bar
  /// on the other tabs. Null when not on Lefi Brain or when it could not be read.
  BrainAiStateProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainAiStateProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainAiStateHash();

  @$internal
  @override
  $FutureProviderElement<BrainAiState?> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<BrainAiState?> create(Ref ref) {
    return brainAiState(ref);
  }
}

String _$brainAiStateHash() => r'049398fd5fb6dcb6bb5da9fa50bc4c2559799216';

@ProviderFor(brainAiControl)
final brainAiControlProvider = BrainAiControlProvider._();

final class BrainAiControlProvider
    extends
        $FunctionalProvider<
          AsyncValue<BrainAiControl>,
          BrainAiControl,
          FutureOr<BrainAiControl>
        >
    with $FutureModifier<BrainAiControl>, $FutureProvider<BrainAiControl> {
  BrainAiControlProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainAiControlProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainAiControlHash();

  @$internal
  @override
  $FutureProviderElement<BrainAiControl> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<BrainAiControl> create(Ref ref) {
    return brainAiControl(ref);
  }
}

String _$brainAiControlHash() => r'6916c1332e90f602090b01cbc7c3e282f71aabec';
