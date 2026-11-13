import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../data/brain_pairing_service.dart';
import '../data/pairing_store.dart';
import '../data/session_store.dart';
import '../domain/brain_pairing.dart';

part 'brain_connection.g.dart';

@Riverpod(keepAlive: true)
PairingStore pairingStore(Ref ref) => SecurePairingStore();

/// The signed-in session kept between launches (ADR-075).
@Riverpod(keepAlive: true)
SessionStore sessionStore(Ref ref) => SecureSessionStore();

@Riverpod(keepAlive: true)
BrainPairingService brainPairingService(Ref ref) => const BrainPairingService();

/// This phone's pairing with Lefi Brain, or null (the app then runs on demo data only).
@Riverpod(keepAlive: true)
class BrainConnection extends _$BrainConnection {
  @override
  Future<BrainPairing?> build() async {
    try {
      return await ref.read(pairingStoreProvider).load();
    } on Exception {
      return null; // no secure storage on this platform: not paired
    }
  }

  /// Pairs with a code from Lefi Crop Helper and keeps the pairing. Throws [BrainException].
  Future<void> pair({required String address, required String code, required String deviceName}) async {
    final p = await ref.read(brainPairingServiceProvider).pair(address: address, code: code, deviceName: deviceName);
    await ref.read(pairingStoreProvider).save(p);
    state = AsyncData(p);
  }

  /// Signs out and removes the pairing and its key from this phone.
  Future<void> forget() async {
    await ref.read(sessionProvider.notifier).signOut();
    await ref.read(pairingStoreProvider).clear();
    state = const AsyncData(null);
  }
}
