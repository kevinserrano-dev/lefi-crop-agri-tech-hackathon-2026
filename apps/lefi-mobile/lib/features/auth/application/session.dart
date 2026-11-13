import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/data_source.dart';
import '../../../core/review_flags.dart';
import '../../../shared/domain/provenance.dart';
import '../../../shared/domain/role.dart';
import '../../brain/application/brain_connection.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../data/demo_auth_repository.dart';
import '../domain/auth_repository.dart';

part 'session.g.dart';

/// Lefi Brain when this phone is paired with one (ADR-068), otherwise the demo accounts.
@Riverpod(keepAlive: true)
AuthRepository activeAuthRepository(Ref ref) {
  final pairing = ref.watch(brainConnectionProvider).value;
  if (pairing == null) return ref.watch(authRepositoryProvider);
  final repo = BrainAuthRepository(pairing, sessions: ref.watch(sessionStoreProvider));
  repo.onSessionEnded = () => ref.read(sessionProvider.notifier).ended();
  ref.onDispose(repo.close);
  return repo;
}

/// Current signed-in user, or `null` when signed out.
@Riverpod(keepAlive: true)
class Session extends _$Session {
  UserProfile? _lastUser;

  @override
  UserProfile? build() {
    // Optional auto sign-in for design reviews (demo data only, see ReviewFlags).
    final role = ReviewFlags.role;
    if (role == null || ref.read(dataSourceProvider) != DataSourceKind.demo) return null;
    final r = Role.values.where((x) => x.name == role);
    if (r.isEmpty) return null;
    return _lastUser = ref.read(authRepositoryProvider).demoAccounts().firstWhere((u) => u.role == r.first);
  }

  UserProfile? get lastUser => _lastUser;

  AuthRepository get _repo => ref.read(activeAuthRepositoryProvider);

  /// Validates input, then signs in. Throws [AuthException] ([PasswordChangeRequired] when
  /// Lefi Brain asks for a new password first).
  Future<void> signIn(String login, String password) async {
    if (_repo is BrainAuthRepository) {
      if (login.trim().isEmpty) throw const AuthException('Enter your username.');
      if (password.isEmpty) throw const AuthException('Enter your password.');
    } else {
      // Demo accounts, as in the design.
      if (!RegExp(r'^\S+@\S+\.\S+$').hasMatch(login)) {
        throw const AuthException('Enter your work email address.');
      }
      if (password.length < 8) throw const AuthException('Password must be at least 8 characters.');
    }
    state = _lastUser = await _repo.signIn(login, password);
  }

  /// At launch: resumes the Lefi Brain session kept on this phone (ADR-075), if it is still valid.
  Future<void> restore({Duration timeout = const Duration(seconds: 6)}) async {
    final repo = _repo;
    if (repo is! BrainAuthRepository || state != null) return;
    try {
      final user = await repo.resume().timeout(timeout);
      if (user != null && state == null) state = _lastUser = user;
    } on Object {
      // Not resumed (slow or unreachable Lefi Brain): the person signs in.
    }
  }

  /// Lefi Brain ended the session: back to the sign-in screen.
  void ended() => state = null;

  /// Only after [PasswordChangeRequired], on Lefi Brain.
  Future<void> changePassword(String current, String next) async {
    final repo = _repo;
    if (repo is! BrainAuthRepository) throw const AuthException('Not connected to Lefi Brain.');
    if (next.isEmpty) throw const AuthException('Enter a new password.');
    state = _lastUser = await repo.changePassword(current, next);
  }

  Future<void> unlockWithBiometrics(UserProfile fallback) async {
    state = _lastUser = await _repo.unlockWithBiometrics(_lastUser ?? fallback);
  }

  Future<void> signOut() async {
    await _repo.signOut();
    state = null;
  }
}

/// The signed-in user. Only read below the auth guard.
@Riverpod(keepAlive: true)
UserProfile currentUser(Ref ref) => ref.watch(sessionProvider)!;
