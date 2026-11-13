import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../data/demo_ai_control_repository.dart';
import '../domain/ai_status.dart';

part 'ai_controller.g.dart';

@Riverpod(keepAlive: true)
class AiController extends _$AiController {
  @override
  Future<AiStatus> build() => ref.watch(aiControlRepositoryProvider).status();

  Future<void> halt(HaltScope scope, String? reason) async {
    final who = ref.read(currentUserProvider).name;
    state = AsyncData(await ref.read(aiControlRepositoryProvider).halt(scope, who, reason));
  }

  Future<void> resume() async {
    final who = ref.read(currentUserProvider).name;
    state = AsyncData(await ref.read(aiControlRepositoryProvider).resume(who));
  }
}
