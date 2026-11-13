import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/demo_latency.dart';
import '../../../demo/demo_users.dart';
import '../../../shared/domain/role.dart';
import '../domain/auth_repository.dart';

part 'demo_auth_repository.g.dart';

/// Demo sign-in: any demo account, any password of 8+ characters. There are no
/// real credentials in the app.
class DemoAuthRepository implements AuthRepository {
  @override
  List<UserProfile> demoAccounts() => demoUsers.values.toList();

  @override
  Future<UserProfile> signIn(String email, String password) => demoDelay(() {
    final match = demoUsers.values.where((u) => u.email == email.trim().toLowerCase());
    if (match.isEmpty) throw const AuthException('No demo account with that email.');
    return match.first;
  }, ms: 800);

  @override
  Future<UserProfile> unlockWithBiometrics(UserProfile lastUser) => demoDelay(() => lastUser, ms: 700);

  @override
  Future<void> signOut() async {}
}

/// Current time of day in hours. Demo builds freeze it at the design's 10:24 so
/// shift progress matches the fixtures.
@Riverpod(keepAlive: true)
double clockHours(Ref ref) => demoNowHours;

@Riverpod(keepAlive: true)
AuthRepository authRepository(Ref ref) => DemoAuthRepository();
