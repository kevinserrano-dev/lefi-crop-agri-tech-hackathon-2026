import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where this phone keeps its Lefi Brain session token between launches (ADR-075). Only in the
/// system's secure storage, next to the pairing; never in a plain file or in logs.
abstract interface class SessionStore {
  Future<String?> load();
  Future<void> save(String token);
  Future<void> clear();
}

class SecureSessionStore implements SessionStore {
  SecureSessionStore([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _storage;
  static const _key = 'lefi.brain.session.v1';

  @override
  Future<String?> load() async {
    try {
      return await _storage.read(key: _key);
    } on Exception {
      return null; // no secure storage on this platform: the person signs in again
    }
  }

  @override
  Future<void> save(String token) async {
    try {
      await _storage.write(key: _key, value: token);
    } on Exception {
      // Not kept: the session still works until the app closes.
    }
  }

  @override
  Future<void> clear() async {
    try {
      await _storage.delete(key: _key);
    } on Exception {
      // nothing stored
    }
  }
}

/// For tests and for platforms without secure storage.
class MemorySessionStore implements SessionStore {
  MemorySessionStore([this.token]);
  String? token;

  @override
  Future<String?> load() async => token;

  @override
  Future<void> save(String token) async => this.token = token;

  @override
  Future<void> clear() async => token = null;
}
