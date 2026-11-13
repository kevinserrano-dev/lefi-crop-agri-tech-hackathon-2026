// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'brain_connection.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(pairingStore)
final pairingStoreProvider = PairingStoreProvider._();

final class PairingStoreProvider
    extends $FunctionalProvider<PairingStore, PairingStore, PairingStore>
    with $Provider<PairingStore> {
  PairingStoreProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'pairingStoreProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$pairingStoreHash();

  @$internal
  @override
  $ProviderElement<PairingStore> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  PairingStore create(Ref ref) {
    return pairingStore(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(PairingStore value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<PairingStore>(value),
    );
  }
}

String _$pairingStoreHash() => r'f47cbbd1922970ba4bf9389abf1e57697073dfcf';

/// The signed-in session kept between launches (ADR-075).

@ProviderFor(sessionStore)
final sessionStoreProvider = SessionStoreProvider._();

/// The signed-in session kept between launches (ADR-075).

final class SessionStoreProvider
    extends $FunctionalProvider<SessionStore, SessionStore, SessionStore>
    with $Provider<SessionStore> {
  /// The signed-in session kept between launches (ADR-075).
  SessionStoreProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'sessionStoreProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$sessionStoreHash();

  @$internal
  @override
  $ProviderElement<SessionStore> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  SessionStore create(Ref ref) {
    return sessionStore(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(SessionStore value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<SessionStore>(value),
    );
  }
}

String _$sessionStoreHash() => r'5a49f5228fb9878d3419b834a927a4c33c4d8016';

@ProviderFor(brainPairingService)
final brainPairingServiceProvider = BrainPairingServiceProvider._();

final class BrainPairingServiceProvider
    extends
        $FunctionalProvider<
          BrainPairingService,
          BrainPairingService,
          BrainPairingService
        >
    with $Provider<BrainPairingService> {
  BrainPairingServiceProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainPairingServiceProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainPairingServiceHash();

  @$internal
  @override
  $ProviderElement<BrainPairingService> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  BrainPairingService create(Ref ref) {
    return brainPairingService(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(BrainPairingService value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<BrainPairingService>(value),
    );
  }
}

String _$brainPairingServiceHash() =>
    r'b68f4b7d39d1345af6c4f1d3cbd909db1739da59';

/// This phone's pairing with Lefi Brain, or null (the app then runs on demo data only).

@ProviderFor(BrainConnection)
final brainConnectionProvider = BrainConnectionProvider._();

/// This phone's pairing with Lefi Brain, or null (the app then runs on demo data only).
final class BrainConnectionProvider
    extends $AsyncNotifierProvider<BrainConnection, BrainPairing?> {
  /// This phone's pairing with Lefi Brain, or null (the app then runs on demo data only).
  BrainConnectionProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainConnectionProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainConnectionHash();

  @$internal
  @override
  BrainConnection create() => BrainConnection();
}

String _$brainConnectionHash() => r'197ee2dccba60fd2ebfe02f659684fbdf2ba7435';

/// This phone's pairing with Lefi Brain, or null (the app then runs on demo data only).

abstract class _$BrainConnection extends $AsyncNotifier<BrainPairing?> {
  FutureOr<BrainPairing?> build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<AsyncValue<BrainPairing?>, BrainPairing?>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<AsyncValue<BrainPairing?>, BrainPairing?>,
              AsyncValue<BrainPairing?>,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
