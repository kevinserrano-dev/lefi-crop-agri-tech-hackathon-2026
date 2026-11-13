import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../../auth/domain/auth_repository.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../data/brain_ai_control_repository.dart';
import '../domain/brain_ai_control.dart';

part 'brain_ai_control.g.dart';

/// While watched, Lefi AI's state is asked again (someone may stop it from Lefi Desktop or the CLI).
const brainAiControlPoll = Duration(seconds: 30);

/// AI Control & Safety on Lefi Brain for roles with `nav.aiControl`; null otherwise.
@Riverpod(keepAlive: true)
BrainAiControlRepository? brainAiControlRepository(Ref ref) {
  final auth = ref.watch(activeAuthRepositoryProvider);
  ref.watch(sessionProvider);
  if (auth is! BrainAuthRepository || !auth.can('nav.aiControl')) return null;
  return BrainAiControlRepository(auth);
}

/// True when signed in to Lefi Brain (any role): the demo AI controls must never show then.
@Riverpod(keepAlive: true)
bool onBrain(Ref ref) {
  ref.watch(sessionProvider);
  return ref.watch(activeAuthRepositoryProvider) is BrainAuthRepository;
}

/// Lefi AI's state for any signed-in role (`GET /ai/assistant`, `ai.chat`, every role): the bar
/// on the other tabs. Null when not on Lefi Brain or when it could not be read.
@riverpod
Future<BrainAiState?> brainAiState(Ref ref) async {
  ref.watch(sessionProvider);
  final auth = ref.watch(activeAuthRepositoryProvider);
  if (auth is! BrainAuthRepository || !auth.can('ai.chat')) return null;
  final timer = Timer(brainAiControlPoll, ref.invalidateSelf);
  ref.onDispose(timer.cancel);
  try {
    return BrainAiState.fromJson((await auth.api('GET', '/ai/assistant')).json);
  } on AuthException {
    return null;
  }
}

@riverpod
Future<BrainAiControl> brainAiControl(Ref ref) async {
  final repo = ref.watch(brainAiControlRepositoryProvider) ?? (throw StateError('Not connected to Lefi Brain.'));
  final timer = Timer(brainAiControlPoll, ref.invalidateSelf);
  ref.onDispose(timer.cancel);
  return repo.control();
}
