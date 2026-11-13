import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../data/brain_robot_repository.dart';
import '../domain/brain_robot.dart';

part 'brain_robots.g.dart';

/// While the robot screen is open its state is asked again this often (Lefi Desktop: 0.5 s; the phone
/// is gentler on the network and the battery).
const brainRobotPoll = Duration(seconds: 2);

/// The Home card asks less often.
const brainRobotCardPoll = Duration(seconds: 10);

/// The simulated robot on Lefi Brain for roles with `nav.robots` (everyone but the worker); null otherwise.
@Riverpod(keepAlive: true)
BrainRobotRepository? brainRobotRepository(Ref ref) {
  final auth = ref.watch(activeAuthRepositoryProvider);
  ref.watch(sessionProvider);
  if (auth is! BrainAuthRepository || !auth.can('nav.robots')) return null;
  return BrainRobotRepository(auth);
}

BrainRobotRepository _repo(Ref ref) =>
    ref.watch(brainRobotRepositoryProvider) ?? (throw StateError('Not connected to Lefi Brain.'));

/// What the robot screen shows: the robot, the command it runs, the last commands and missions, the scene.
class RobotLive {
  const RobotLive({required this.robot, required this.commands, required this.missions, this.scene});
  final BrainRobot robot;
  final List<RobotCommand> commands;
  final List<RobotMission> missions;
  final RobotScene? scene;

  /// The command the simulator runs now, with its arguments from Lefi Brain's record; else the
  /// newest one Lefi Brain sent that has not finished.
  RobotCommand? get current {
    final active = robot.state?.activeCommand;
    if (active != null) {
      for (final c in commands) {
        if (c.id == active.id) return c;
      }
      return RobotCommand(id: active.id, kind: active.kind, args: const {}, state: active.state, actor: '');
    }
    for (final c in commands) {
      if (!c.finished) return c;
    }
    return null;
  }
}

/// The robots Lefi Brain knows (one simulated MH3 today), for the Home card.
@riverpod
Future<List<BrainRobot>> brainRobots(Ref ref) async {
  final timer = Timer(brainRobotCardPoll, ref.invalidateSelf);
  ref.onDispose(timer.cancel);
  return _repo(ref).robots();
}

/// The first robot with its commands, missions and scene; null when Lefi Brain has no robot.
@riverpod
Future<RobotLive?> brainRobotLive(Ref ref) async {
  final repo = _repo(ref);
  final timer = Timer(brainRobotPoll, ref.invalidateSelf);
  ref.onDispose(timer.cancel);
  final robots = await repo.robots();
  if (robots.isEmpty) return null;
  final r = robots.first;
  final (commands, missions) = await (repo.commands(r.id), repo.missions(r.id)).wait;
  final scene = r.online ? await ref.watch(brainRobotSceneProvider(r.id).future) : null;
  return RobotLive(robot: r, commands: commands, missions: missions, scene: scene);
}

/// The scene does not change while the simulator runs: asked once, again only after it came back null.
@Riverpod(keepAlive: true)
Future<RobotScene?> brainRobotScene(Ref ref, String robotId) async {
  final s = await _repo(ref).scene(robotId);
  if (s == null) {
    final t = Timer(brainRobotCardPoll, ref.invalidateSelf);
    ref.onDispose(t.cancel);
  }
  return s;
}
