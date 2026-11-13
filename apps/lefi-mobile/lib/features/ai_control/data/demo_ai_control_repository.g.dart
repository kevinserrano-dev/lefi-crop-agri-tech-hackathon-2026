// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'demo_ai_control_repository.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(aiControlRepository)
final aiControlRepositoryProvider = AiControlRepositoryProvider._();

final class AiControlRepositoryProvider
    extends
        $FunctionalProvider<
          AiControlRepository,
          AiControlRepository,
          AiControlRepository
        >
    with $Provider<AiControlRepository> {
  AiControlRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'aiControlRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$aiControlRepositoryHash();

  @$internal
  @override
  $ProviderElement<AiControlRepository> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  AiControlRepository create(Ref ref) {
    return aiControlRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(AiControlRepository value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<AiControlRepository>(value),
    );
  }
}

String _$aiControlRepositoryHash() =>
    r'3ad595743910f25afb4db4f327474aff96ce60f5';
