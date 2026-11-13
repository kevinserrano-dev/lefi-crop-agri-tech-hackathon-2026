import '../../brain/data/brain_auth_repository.dart';
import '../domain/brain_ai_control.dart';

/// AI Control & Safety through Lefi Gateway (ADR-085): reading needs `nav.aiControl`, the
/// emergency stop `ai.halt`, resuming `ai.resume`. Stop and resume set and clear the same flag
/// `lefi ai off` uses, and Lefi Brain audits both.
class BrainAiControlRepository {
  BrainAiControlRepository(this.brain);
  final BrainAuthRepository brain;

  Future<BrainAiControl> control() async => BrainAiControl.fromJson((await brain.api('GET', '/ai/control')).json);

  /// Lefi Brain asks for a reason of 3 to 200 characters.
  Future<BrainAiControl> stop(String reason) async =>
      BrainAiControl.fromJson((await brain.api('POST', '/ai/stop', body: {'reason': reason.trim()})).json);

  Future<BrainAiControl> resume() async => BrainAiControl.fromJson((await brain.api('POST', '/ai/resume')).json);
}
