import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../data/brain_handover_repository.dart';
import '../domain/brain_handover.dart';

part 'brain_handover.g.dart';

/// While open, the handover is asked again (Lefi AI's summary may still be pending).
const brainHandoverPoll = Duration(seconds: 15);

/// Lefi Brain's handover when signed in with `nav.handover` (not workers); null otherwise.
@Riverpod(keepAlive: true)
BrainHandoverRepository? brainHandoverRepository(Ref ref) {
  final auth = ref.watch(activeAuthRepositoryProvider);
  ref.watch(sessionProvider);
  if (auth is! BrainAuthRepository || !auth.can('nav.handover')) return null;
  return BrainHandoverRepository(auth);
}

BrainHandoverRepository _repo(Ref ref) =>
    ref.watch(brainHandoverRepositoryProvider) ?? (throw StateError('Not connected to Lefi Brain.'));

@riverpod
Future<HandoverView> brainHandoverCurrent(Ref ref) async {
  final repo = _repo(ref);
  final timer = Timer(brainHandoverPoll, ref.invalidateSelf);
  ref.onDispose(timer.cancel);
  return repo.current();
}

@riverpod
Future<List<BrainHandover>> brainHandoverHistory(Ref ref) => _repo(ref).recent();
