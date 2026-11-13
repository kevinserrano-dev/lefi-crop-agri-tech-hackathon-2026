import '../../auth/domain/auth_repository.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../domain/brain_robot.dart';

/// The simulated robot through Lefi Gateway (ADR-106, `nav.robots`): what it is doing, the command it
/// runs and where it is, plus the two actions whoever sees the robot may always take (ADR-091): cancel
/// its mission and the safe stop. Asking for missions, power and reinstall are in Lefi Desktop.
class BrainRobotRepository {
  BrainRobotRepository(this.brain);
  final BrainAuthRepository brain;

  Future<List<BrainRobot>> robots() async {
    final body = (await brain.api('GET', '/robots')).body;
    return [
      for (final r in body is List ? body : const [])
        if (r is Map<String, dynamic>) BrainRobot.fromJson(r),
    ];
  }

  /// The simulated greenhouse; null while the simulator has not answered yet (409 `robot_offline`).
  /// Only the map needs it, so any refusal leaves the map out; `robots()` reports the rest.
  Future<RobotScene?> scene(String robotId) async {
    try {
      return RobotScene.fromJson((await brain.api('GET', '/robots/$robotId/scene')).json);
    } on AuthException {
      return null;
    }
  }

  /// The commands Lefi Brain sent, newest first.
  Future<List<RobotCommand>> commands(String robotId, {int limit = 12}) async {
    final body = (await brain.api('GET', '/robots/$robotId/commands?limit=$limit')).body;
    return [
      for (final c in body is List ? body : const [])
        if (c is Map<String, dynamic>) RobotCommand.fromJson(c),
    ];
  }

  /// Cancels the mission; Lefi Brain tells the robot to stop and records it (audited).
  Future<RobotMission> cancelMission(String missionId) async =>
      RobotMission.fromJson((await brain.api('POST', '/robot-missions/$missionId/cancel')).json);

  /// Stops the base now and cancels any mission (`robot.safe_stop`, audited). Always allowed with `nav.robots`.
  Future<RobotCommand> safeStop(String robotId) async =>
      RobotCommand.fromJson((await brain.api('POST', '/robots/$robotId/stop')).json);

  /// The robot's missions, newest first.
  Future<List<RobotMission>> missions(String robotId, {int limit = 6}) async {
    final body = (await brain.api(
      'GET',
      '/robot-missions?robot_id=${Uri.encodeQueryComponent(robotId)}&limit=$limit',
    )).body;
    return [
      for (final m in body is List ? body : const [])
        if (m is Map<String, dynamic>) RobotMission.fromJson(m),
    ];
  }
}
