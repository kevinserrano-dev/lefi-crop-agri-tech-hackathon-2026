import '../../../shared/domain/role.dart';

class AuthException implements Exception {
  const AuthException(this.message);
  final String message;
  @override
  String toString() => message;
}

abstract interface class AuthRepository {
  /// Accounts offered on the login screen (demo builds only).
  List<UserProfile> demoAccounts();

  Future<UserProfile> signIn(String email, String password);

  /// Biometric unlock re-uses the last session on this device.
  Future<UserProfile> unlockWithBiometrics(UserProfile lastUser);

  Future<void> signOut();
}
