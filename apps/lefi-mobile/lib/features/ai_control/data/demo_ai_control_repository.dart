import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/demo_latency.dart';
import '../domain/ai_status.dart';

part 'demo_ai_control_repository.g.dart';

/// Demo only: keeps the AI state in memory. The real implementation calls the
/// Brain, which owns the persistent kill switch (`~/.lefi-crop/flags/ai.disabled`).
class DemoAiControlRepository implements AiControlRepository {
  @override
  Future<AiStatus> status() => demoDelay(() => const AiStatus.online(), ms: 50);

  @override
  Future<AiStatus> halt(HaltScope scope, String by, String? reason) =>
      demoDelay(() => AiStatus.halted(scope: scope, by: by, at: '10:24', reason: reason), ms: 400);

  @override
  Future<AiStatus> resume(String by) => demoDelay(() => const AiStatus.online(), ms: 400);
}

@Riverpod(keepAlive: true)
AiControlRepository aiControlRepository(Ref ref) => DemoAiControlRepository();
