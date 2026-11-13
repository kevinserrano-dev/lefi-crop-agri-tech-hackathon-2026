// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'brain_handover.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Lefi Brain's handover when signed in with `nav.handover` (not workers); null otherwise.

@ProviderFor(brainHandoverRepository)
final brainHandoverRepositoryProvider = BrainHandoverRepositoryProvider._();

/// Lefi Brain's handover when signed in with `nav.handover` (not workers); null otherwise.

final class BrainHandoverRepositoryProvider
    extends
        $FunctionalProvider<
          BrainHandoverRepository?,
          BrainHandoverRepository?,
          BrainHandoverRepository?
        >
    with $Provider<BrainHandoverRepository?> {
  /// Lefi Brain's handover when signed in with `nav.handover` (not workers); null otherwise.
  BrainHandoverRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainHandoverRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainHandoverRepositoryHash();

  @$internal
  @override
  $ProviderElement<BrainHandoverRepository?> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  BrainHandoverRepository? create(Ref ref) {
    return brainHandoverRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(BrainHandoverRepository? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<BrainHandoverRepository?>(value),
    );
  }
}

String _$brainHandoverRepositoryHash() =>
    r'a67137f8f58a719e20728b7bdf52afd0bdaa8401';

@ProviderFor(brainHandoverCurrent)
final brainHandoverCurrentProvider = BrainHandoverCurrentProvider._();

final class BrainHandoverCurrentProvider
    extends
        $FunctionalProvider<
          AsyncValue<HandoverView>,
          HandoverView,
          FutureOr<HandoverView>
        >
    with $FutureModifier<HandoverView>, $FutureProvider<HandoverView> {
  BrainHandoverCurrentProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainHandoverCurrentProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainHandoverCurrentHash();

  @$internal
  @override
  $FutureProviderElement<HandoverView> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<HandoverView> create(Ref ref) {
    return brainHandoverCurrent(ref);
  }
}

String _$brainHandoverCurrentHash() =>
    r'92f155a3b21f22b8271674e3cc518ceaf8622085';

@ProviderFor(brainHandoverHistory)
final brainHandoverHistoryProvider = BrainHandoverHistoryProvider._();

final class BrainHandoverHistoryProvider
    extends
        $FunctionalProvider<
          AsyncValue<List<BrainHandover>>,
          List<BrainHandover>,
          FutureOr<List<BrainHandover>>
        >
    with
        $FutureModifier<List<BrainHandover>>,
        $FutureProvider<List<BrainHandover>> {
  BrainHandoverHistoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainHandoverHistoryProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainHandoverHistoryHash();

  @$internal
  @override
  $FutureProviderElement<List<BrainHandover>> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<List<BrainHandover>> create(Ref ref) {
    return brainHandoverHistory(ref);
  }
}

String _$brainHandoverHistoryHash() =>
    r'0dc45a640b1b7aa68d9ca49c9dc3f849f2edaecd';
