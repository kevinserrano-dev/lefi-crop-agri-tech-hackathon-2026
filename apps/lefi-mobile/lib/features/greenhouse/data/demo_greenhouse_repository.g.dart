// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'demo_greenhouse_repository.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(greenhouseRepository)
final greenhouseRepositoryProvider = GreenhouseRepositoryProvider._();

final class GreenhouseRepositoryProvider
    extends $FunctionalProvider<GreenhouseRepository, GreenhouseRepository, GreenhouseRepository>
    with $Provider<GreenhouseRepository> {
  GreenhouseRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'greenhouseRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$greenhouseRepositoryHash();

  @$internal
  @override
  $ProviderElement<GreenhouseRepository> $createElement($ProviderPointer pointer) => $ProviderElement(pointer);

  @override
  GreenhouseRepository create(Ref ref) {
    return greenhouseRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(GreenhouseRepository value) {
    return $ProviderOverride(origin: this, providerOverride: $SyncValueProvider<GreenhouseRepository>(value));
  }
}

String _$greenhouseRepositoryHash() => r'f1e0ae162f86fe05c5d41f283b1ae019326198cb';
