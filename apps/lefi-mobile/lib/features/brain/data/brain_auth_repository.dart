import 'dart:io';

import '../../../shared/domain/role.dart';
import '../../auth/domain/auth_repository.dart';
import '../domain/brain_pairing.dart';
import 'brain_http.dart';
import 'brain_pairing_service.dart';
import 'session_store.dart';

/// The person must change their password before anything else (bootstrap admin, reset).
class PasswordChangeRequired extends AuthException {
  const PasswordChangeRequired() : super('Change your password before continuing.');
}

/// Lefi Brain role id → the mobile screens to show. The mobile app has no administrator
/// screens: an administrator sees the manager's. Only the UI adapts; Lefi Brain enforces the
/// real role on every request.
Role mobileRoleFor(String brainRole) => switch (brainRole) {
  'admin' || 'manager' => Role.manager,
  'grower' => Role.grower,
  'supervisor' => Role.supervisor,
  'scout' => Role.scout,
  'maint' => Role.maint,
  _ => Role.worker,
};

/// Sign-in against the real Lefi Brain through Lefi Gateway (ADR-068). The session token is
/// kept in the phone's secure storage so reopening the app resumes it (ADR-075); Lefi Brain
/// still decides how long it lives (idle and absolute limits).
class BrainAuthRepository implements AuthRepository {
  BrainAuthRepository(this.pairing, {BrainHttp Function(BrainPairing)? http, SessionStore? sessions})
    : _make = http ?? BrainHttp.paired,
      _sessions = sessions ?? MemorySessionStore();

  final BrainPairing pairing;
  final SessionStore _sessions;

  /// Called when Lefi Brain says the session is no longer valid (expired, revoked).
  void Function()? onSessionEnded;
  final BrainHttp Function(BrainPairing) _make;
  BrainHttp? _client;

  /// Made on first use: a stored pairing whose certificate or key cannot be loaded is reported
  /// when the person signs in, and never stops the app from starting.
  BrainHttp get _http {
    try {
      return _client ??= _make(pairing);
    } on TlsException {
      throw const AuthException(
        'The pairing stored on this phone cannot be used. Forget this Lefi Brain and pair again.',
      );
    }
  }

  String? _token;
  List<String> permissions = const [];

  /// The signed-in person's id and Lefi Brain role id ("grower"…), from the session.
  String userId = '';
  String roleId = '';

  bool can(String permission) => permissions.contains(permission);

  Uri _u(String path) => Uri.parse('${pairing.url}/api/v1$path');

  Never _fail(BrainAnswer a, String fallback) {
    final e = a.error(fallback);
    if (e.reason != null) throw AuthException(deviceRefusal(e.reason));
    throw AuthException(switch (e.code) {
      'INVALID_CREDENTIALS' => 'Wrong username or password.',
      'LOGIN_LOCKED' => 'Too many failed attempts. Wait a few minutes, then try again.',
      _ => e.message,
    });
  }

  Future<BrainAnswer> _call(String method, String path, {Object? body}) async {
    try {
      return await _http.call(method, _u(path), body: body, token: _token);
    } on BrainException catch (e) {
      throw AuthException(e.message);
    }
  }

  UserProfile _profile(Map<String, dynamic> s) {
    final user = s['user'] as Map<String, dynamic>? ?? const {};
    final role = s['role'] as Map<String, dynamic>? ?? const {};
    permissions = [for (final p in s['permissions'] as List? ?? const []) p.toString()];
    userId = user['id'] as String? ?? '';
    roleId = role['id'] as String? ?? '';
    final name = (user['display_name'] as String?)?.trim();
    return UserProfile(
      role: mobileRoleFor(role['id'] as String? ?? ''),
      roleName: role['name'] as String? ?? '',
      short: role['short'] as String? ?? '',
      name: name == null || name.isEmpty ? user['username'] as String? ?? '' : name,
      email: user['email'] as String? ?? user['username'] as String? ?? '',
      colorValue: 0xFF1F6B4F,
      // Lefi Brain has no shifts, zone scopes or reporting lines yet: nothing is invented.
      greenhouseScope: 'Lefi Brain',
      shiftLabel: '',
      shiftStartHour: 0,
      shiftEndHour: 24,
      reportsTo: '',
      zones: const [],
      nextShift: '',
      fromBrain: true,
    );
  }

  @override
  List<UserProfile> demoAccounts() => const [];

  @override
  Future<UserProfile> signIn(String username, String password) async {
    final a = await _call(
      'POST',
      '/auth/login',
      body: {'username': username.trim(), 'password': password, 'token_transport': 'bearer'},
    );
    if (a.status != 200) _fail(a, 'Lefi Brain refused the sign-in (${a.status}).');
    _token = a.json['token'] as String?;
    if (_token == null) throw const AuthException('Lefi Brain did not return a session.');
    // Kept only once the password is final: a forced change must happen in this session.
    if (a.json['must_change_password'] == true) throw const PasswordChangeRequired();
    await _sessions.save(_token!);
    return _profile(a.json);
  }

  /// The session kept on this phone, if Lefi Brain still accepts it. Null = sign in again.
  /// A session Lefi Brain refuses is forgotten; one it could not check (offline) is kept.
  Future<UserProfile?> resume() async {
    final token = await _sessions.load();
    if (token == null) return null;
    _token = token;
    final BrainAnswer a;
    try {
      a = await _call('GET', '/auth/session');
    } on AuthException {
      _token = null;
      return null; // unreachable: keep it for the next launch
    }
    if (a.status == 200 && a.json['must_change_password'] != true) return _profile(a.json);
    _token = null;
    if (a.status == 401 || a.status == 403 || a.status == 200) await _sessions.clear();
    return null;
  }

  /// After [PasswordChangeRequired]: sets the new password on the same session.
  Future<UserProfile> changePassword(String current, String next) async {
    final a = await _call('POST', '/auth/password', body: {'current_password': current, 'new_password': next});
    if (a.status != 200) _fail(a, 'Lefi Brain refused the new password (${a.status}).');
    final t = a.json['token'];
    if (t is String) _token = t;
    if (_token != null) await _sessions.save(_token!);
    return _profile(a.json);
  }

  @override
  Future<UserProfile> unlockWithBiometrics(UserProfile lastUser) =>
      throw const AuthException('Sign in with your username and password.');

  @override
  Future<void> signOut() async {
    if (_token != null) {
      try {
        await _call('POST', '/auth/logout');
      } on AuthException {
        // Offline: the session ends on the phone anyway and expires on Lefi Brain.
      }
    }
    _token = null;
    await _sessions.clear();
  }

  /// A request as the signed-in person (notifications, alerts…). Lefi Brain checks the role.
  Future<BrainAnswer> api(String method, String path, {Object? body}) async {
    if (_token == null) throw const AuthException('Sign in to Lefi Brain first.');
    final a = await _call(method, path, body: body);
    if (a.status == 401 && a.error('').reason == null) {
      // The session ended on Lefi Brain (idle or absolute limit, signed out elsewhere).
      _token = null;
      await _sessions.clear();
      onSessionEnded?.call();
      throw const AuthException('Your session ended. Sign in again.');
    }
    if (a.status >= 400) _fail(a, 'Lefi Brain refused the request (${a.status}).');
    return a;
  }

  void close() => _client?.close();
}
