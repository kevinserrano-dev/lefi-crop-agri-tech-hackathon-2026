// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'demo_handover_repository.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(handoverRepository)
final handoverRepositoryProvider = HandoverRepositoryProvider._();

final class HandoverRepositoryProvider
    extends
        $FunctionalProvider<
          HandoverRepository,
          HandoverRepository,
          HandoverRepository
        >
    with $Provider<HandoverRepository> {
  HandoverRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'handoverRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$handoverRepositoryHash();

  @$internal
  @override
  $ProviderElement<HandoverRepository> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  HandoverRepository create(Ref ref) {
    return handoverRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(HandoverRepository value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<HandoverRepository>(value),
    );
  }
}

String _$handoverRepositoryHash() =>
    r'cdfa1b42d0d170e4d238acbfc2537464d3e005b1';
