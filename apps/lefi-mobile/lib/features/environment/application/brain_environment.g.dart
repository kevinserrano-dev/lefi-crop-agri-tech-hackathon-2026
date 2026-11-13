// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'brain_environment.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Environmental Monitoring on Lefi Brain (`nav.environment`, every role); null otherwise.

@ProviderFor(brainEnvironmentAuth)
final brainEnvironmentAuthProvider = BrainEnvironmentAuthProvider._();

/// Environmental Monitoring on Lefi Brain (`nav.environment`, every role); null otherwise.

final class BrainEnvironmentAuthProvider
    extends $FunctionalProvider<BrainAuthRepository?, BrainAuthRepository?, BrainAuthRepository?>
    with $Provider<BrainAuthRepository?> {
  /// Environmental Monitoring on Lefi Brain (`nav.environment`, every role); null otherwise.
  BrainEnvironmentAuthProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainEnvironmentAuthProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainEnvironmentAuthHash();

  @$internal
  @override
  $ProviderElement<BrainAuthRepository?> $createElement($ProviderPointer pointer) => $ProviderElement(pointer);

  @override
  BrainAuthRepository? create(Ref ref) {
    return brainEnvironmentAuth(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(BrainAuthRepository? value) {
    return $ProviderOverride(origin: this, providerOverride: $SyncValueProvider<BrainAuthRepository?>(value));
  }
}

String _$brainEnvironmentAuthHash() => r'c7db5078d46513c81ee74877c1102046f1205d47';

/// One zone (null = Lefi Brain's first) over a window: `GET /environment?zone_id=&range=` (ADR-084, 097, 108).

@ProviderFor(brainEnvironment)
final brainEnvironmentProvider = BrainEnvironmentFamily._();

/// One zone (null = Lefi Brain's first) over a window: `GET /environment?zone_id=&range=` (ADR-084, 097, 108).

final class BrainEnvironmentProvider
    extends $FunctionalProvider<AsyncValue<BrainEnvironment>, BrainEnvironment, FutureOr<BrainEnvironment>>
    with $FutureModifier<BrainEnvironment>, $FutureProvider<BrainEnvironment> {
  /// One zone (null = Lefi Brain's first) over a window: `GET /environment?zone_id=&range=` (ADR-084, 097, 108).
  BrainEnvironmentProvider._({required BrainEnvironmentFamily super.from, required (String?, String) super.argument})
    : super(
        retry: null,
        name: r'brainEnvironmentProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainEnvironmentHash();

  @override
  String toString() {
    return r'brainEnvironmentProvider'
        ''
        '$argument';
  }

  @$internal
  @override
  $FutureProviderElement<BrainEnvironment> $createElement($ProviderPointer pointer) => $FutureProviderElement(pointer);

  @override
  FutureOr<BrainEnvironment> create(Ref ref) {
    final argument = this.argument as (String?, String);
    return brainEnvironment(ref, argument.$1, argument.$2);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainEnvironmentProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainEnvironmentHash() => r'31a3628ef0c20f031254af52f97b2c475f614ed5';

/// One zone (null = Lefi Brain's first) over a window: `GET /environment?zone_id=&range=` (ADR-084, 097, 108).

final class BrainEnvironmentFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<BrainEnvironment>, (String?, String)> {
  BrainEnvironmentFamily._()
    : super(
        retry: null,
        name: r'brainEnvironmentProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// One zone (null = Lefi Brain's first) over a window: `GET /environment?zone_id=&range=` (ADR-084, 097, 108).

  BrainEnvironmentProvider call(String? zoneId, String range) =>
      BrainEnvironmentProvider._(argument: (zoneId, range), from: this);

  @override
  String toString() => r'brainEnvironmentProvider';
}
