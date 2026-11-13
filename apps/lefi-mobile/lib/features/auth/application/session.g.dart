// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'session.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Lefi Brain when this phone is paired with one (ADR-068), otherwise the demo accounts.

@ProviderFor(activeAuthRepository)
final activeAuthRepositoryProvider = ActiveAuthRepositoryProvider._();

/// Lefi Brain when this phone is paired with one (ADR-068), otherwise the demo accounts.

final class ActiveAuthRepositoryProvider
    extends $FunctionalProvider<AuthRepository, AuthRepository, AuthRepository>
    with $Provider<AuthRepository> {
  /// Lefi Brain when this phone is paired with one (ADR-068), otherwise the demo accounts.
  ActiveAuthRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'activeAuthRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$activeAuthRepositoryHash();

  @$internal
  @override
  $ProviderElement<AuthRepository> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  AuthRepository create(Ref ref) {
    return activeAuthRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(AuthRepository value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<AuthRepository>(value),
    );
  }
}

String _$activeAuthRepositoryHash() =>
    r'e0b335d2411a4161c6cca0cfe371fb13c00afc00';

/// Current signed-in user, or `null` when signed out.

@ProviderFor(Session)
final sessionProvider = SessionProvider._();

/// Current signed-in user, or `null` when signed out.
final class SessionProvider extends $NotifierProvider<Session, UserProfile?> {
  /// Current signed-in user, or `null` when signed out.
  SessionProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'sessionProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$sessionHash();

  @$internal
  @override
  Session create() => Session();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(UserProfile? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<UserProfile?>(value),
    );
  }
}

String _$sessionHash() => r'7507073f2c011f3d8d347ac65c185ccc116960c7';

/// Current signed-in user, or `null` when signed out.

abstract class _$Session extends $Notifier<UserProfile?> {
  UserProfile? build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<UserProfile?, UserProfile?>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<UserProfile?, UserProfile?>,
              UserProfile?,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

/// The signed-in user. Only read below the auth guard.

@ProviderFor(currentUser)
final currentUserProvider = CurrentUserProvider._();

/// The signed-in user. Only read below the auth guard.

final class CurrentUserProvider
    extends $FunctionalProvider<UserProfile, UserProfile, UserProfile>
    with $Provider<UserProfile> {
  /// The signed-in user. Only read below the auth guard.
  CurrentUserProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'currentUserProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$currentUserHash();

  @$internal
  @override
  $ProviderElement<UserProfile> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  UserProfile create(Ref ref) {
    return currentUser(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(UserProfile value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<UserProfile>(value),
    );
  }
}

String _$currentUserHash() => r'd335b8c05570a7baac6bc483ebd4d33364b49cff';
