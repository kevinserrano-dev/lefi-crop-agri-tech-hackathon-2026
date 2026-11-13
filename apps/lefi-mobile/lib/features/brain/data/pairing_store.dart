import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../domain/brain_pairing.dart';

/// Where this phone keeps its pairing. The private key is in it, so it lives only in the
/// system's secure storage (iOS Keychain, Android Keystore-backed), never in a plain file.
abstract interface class PairingStore {
  Future<BrainPairing?> load();
  Future<void> save(BrainPairing pairing);
  Future<void> clear();
}

class SecurePairingStore implements PairingStore {
  SecurePairingStore([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _storage;
  static const _key = 'lefi.brain.pairing.v1';

  @override
  Future<BrainPairing?> load() async {
    final raw = await _storage.read(key: _key);
    if (raw == null) return null;
    try {
      final p = BrainPairing.fromJson(jsonDecode(raw) as Map<String, dynamic>);
      if (p == null) await clear(); // incomplete: discarded, the phone pairs again
      return p;
    } on FormatException {
      await clear();
      return null;
    }
  }

  @override
  Future<void> save(BrainPairing pairing) => _storage.write(key: _key, value: jsonEncode(pairing.toJson()));

  @override
  Future<void> clear() => _storage.delete(key: _key);
}

/// For tests and for platforms without secure storage: kept in memory only.
class MemoryPairingStore implements PairingStore {
  MemoryPairingStore([this._pairing]);
  BrainPairing? _pairing;

  @override
  Future<BrainPairing?> load() async => _pairing;

  @override
  Future<void> save(BrainPairing pairing) async => _pairing = pairing;

  @override
  Future<void> clear() async => _pairing = null;
}
