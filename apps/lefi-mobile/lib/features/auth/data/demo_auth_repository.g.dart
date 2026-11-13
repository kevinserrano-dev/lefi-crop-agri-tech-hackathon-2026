// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'demo_auth_repository.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Current time of day in hours. Demo builds freeze it at the design's 10:24 so
/// shift progress matches the fixtures.

@ProviderFor(clockHours)
final clockHoursProvider = ClockHoursProvider._();

/// Current time of day in hours. Demo builds freeze it at the design's 10:24 so
/// shift progress matches the fixtures.

final class ClockHoursProvider
    extends $FunctionalProvider<double, double, double>
    with $Provider<double> {
  /// Current time of day in hours. Demo builds freeze it at the design's 10:24 so
  /// shift progress matches the fixtures.
  ClockHoursProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'clockHoursProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$clockHoursHash();

  @$internal
  @override
  $ProviderElement<double> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  double create(Ref ref) {
    return clockHours(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(double value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<double>(value),
    );
  }
}

String _$clockHoursHash() => r'53889f72b344a02ebe06deed08702088c5806660';

@ProviderFor(authRepository)
final authRepositoryProvider = AuthRepositoryProvider._();

final class AuthRepositoryProvider
    extends $FunctionalProvider<AuthRepository, AuthRepository, AuthRepository>
    with $Provider<AuthRepository> {
  AuthRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'authRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$authRepositoryHash();

  @$internal
  @override
  $ProviderElement<AuthRepository> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  AuthRepository create(Ref ref) {
    return authRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(AuthRepository value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<AuthRepository>(value),
    );
  }
}

String _$authRepositoryHash() => r'1f5a788cfaad066faa32b6c521eded3e6fb80f1c';
