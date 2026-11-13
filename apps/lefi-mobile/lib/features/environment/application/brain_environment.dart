import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../domain/brain_environment.dart';

part 'brain_environment.g.dart';

/// While the screen is open the zone is asked again this often (readings arrive at 1 Hz; history in
/// 30 min buckets at the finest).
const brainEnvironmentPoll = Duration(seconds: 30);

/// Environmental Monitoring on Lefi Brain (`nav.environment`, every role); null otherwise.
@Riverpod(keepAlive: true)
BrainAuthRepository? brainEnvironmentAuth(Ref ref) {
  final auth = ref.watch(activeAuthRepositoryProvider);
  ref.watch(sessionProvider);
  if (auth is! BrainAuthRepository || !auth.can('nav.environment')) return null;
  return auth;
}

/// One zone (null = Lefi Brain's first) over a window: `GET /environment?zone_id=&range=` (ADR-084, 097, 108).
@riverpod
Future<BrainEnvironment> brainEnvironment(Ref ref, String? zoneId, String range) async {
  final brain = ref.watch(brainEnvironmentAuthProvider) ?? (throw StateError('Not connected to Lefi Brain.'));
  final t = Timer(brainEnvironmentPoll, ref.invalidateSelf);
  ref.onDispose(t.cancel);
  final q = [
    if (zoneId != null) 'zone_id=${Uri.encodeQueryComponent(zoneId)}',
    'range=${Uri.encodeQueryComponent(range)}',
  ].join('&');
  return BrainEnvironment.fromJson((await brain.api('GET', '/environment?$q')).json);
}
