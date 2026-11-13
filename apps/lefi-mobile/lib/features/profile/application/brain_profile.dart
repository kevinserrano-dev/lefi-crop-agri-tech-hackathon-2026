import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../data/brain_profile_repository.dart';

part 'brain_profile.g.dart';

@Riverpod(keepAlive: true)
BrainProfileRepository? brainProfileRepository(Ref ref) {
  final auth = ref.watch(activeAuthRepositoryProvider);
  ref.watch(sessionProvider);
  if (auth is! BrainAuthRepository) return null;
  return BrainProfileRepository(auth);
}

BrainProfileRepository _repo(Ref ref) =>
    ref.watch(brainProfileRepositoryProvider) ?? (throw StateError('Not connected to Lefi Brain.'));

@riverpod
Future<MyShifts?> myShifts(Ref ref) => _repo(ref).myShifts();

@riverpod
Future<String> notificationLevel(Ref ref) => _repo(ref).notificationLevel();
