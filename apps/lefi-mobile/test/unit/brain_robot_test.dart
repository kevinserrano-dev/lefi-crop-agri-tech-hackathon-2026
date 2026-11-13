// Lefi Brain's simulated robot (ADR-091, 104) → the phone, read only (ADR-106). All data here is a
// test fixture shaped like `RobotOut`, `RobotCommandOut` and `RobotSceneOut`; it is not a real robot.
import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/robot/application/brain_robots.dart';
import 'package:lefi_mobile/features/robot/domain/brain_robot.dart';
import 'package:lefi_mobile/features/robot/presentation/brain_robot_screen.dart';

final _scene = RobotScene.fromJson({
  'id': 'test-gh',
  'name': 'TEST greenhouse',
  'origin': 'SIMULATED',
  'bounds': {'x_min': -1.5, 'x_max': 6.5, 'y_min': -2.6, 'y_max': 2.6},
  'start': {'x': 0, 'y': 0, 'yaw_deg': 0},
  'benches': [
    {'id': 'b', 'label': 'TEST bench', 'x': 3.0, 'y': 1.25, 'length': 4.4, 'width': 0.8, 'height': 0.75},
  ],
  'stations': [
    {
      'id': 'p2',
      'label': 'TEST Plant 2',
      'kind': 'tomato',
      'bench': 'b',
      'x': 3.4,
      'y': 1.25,
      'approach': {'x': 3.4, 'y': 0.5, 'yaw_deg': 90},
    },
    {
      'id': 'dock',
      'label': 'TEST dock',
      'kind': 'dock',
      'bench': null,
      'x': 0,
      'y': 0,
      'approach': {'x': 0, 'y': 0, 'yaw_deg': 0},
    },
  ],
  'decor_plants': [],
});

Map<String, dynamic> _robot({
  Map<String, dynamic>? state,
  Map<String, dynamic>? mission,
  String connection = 'online',
}) => {
  'id': 'mh3-sim',
  'name': 'TEST MH3',
  'model': 'TEST model',
  'origin': 'SIMULATED',
  'connection': connection,
  'backend': 'lite',
  'feeds': [],
  'state': state,
  'last_seen': '2026-11-13T10:00:00Z',
  'active_mission': mission,
  'error': null,
  'device': {'status': 'installed'},
  'power': connection == 'online' ? 'on' : 'off',
  'power_detail': connection == 'online'
      ? null
      : {'problem': 'stopped', 'message': null, 'log_tail': null, 'since': null},
};

Map<String, dynamic> _state({String? activeId}) => {
  'pose': {'x': 3.3, 'y': 0.45, 'yaw_deg': 88},
  'phase': 'driving',
  'moving': true,
  'linear_mps': 0.3,
  'angular_radps': 0,
  'head_pitch': 0,
  'odometry_m': 4.2,
  'sim_time': 12,
  'active_command': activeId == null ? null : {'command_id': activeId, 'kind': 'go_to', 'state': 'running'},
};

Map<String, dynamic> _mission(String state) => {
  'id': 'm1',
  'robot_id': 'mh3-sim',
  'kind': 'inspect',
  'station_id': 'p2',
  'station_label': 'TEST Plant 2',
  'state': state,
  'active': true,
  'created_by': 'u1',
  'created_at': '2026-11-13T10:00:00Z',
  'updated_at': '2026-11-13T10:00:05Z',
  'finished_at': null,
  'reason': null,
  'has_photo': false,
  'photo_at': null,
  'origin': 'SIMULATED',
  'events': [
    {'at': '2026-11-13T10:00:00Z', 'state': 'QUEUED', 'note': null},
  ],
};

RobotCommand _cmd(String id, String kind, Map<String, dynamic> args, String state) => RobotCommand.fromJson({
  'id': id,
  'robot_id': 'mh3-sim',
  'mission_id': 'm1',
  'kind': kind,
  'args': args,
  'state': state,
  'actor': 'lefi-brain',
  'sent_at': '2026-11-13T10:00:01Z',
  'expires_at': '2026-11-13T10:05:01Z',
  'updated_at': null,
  'message': null,
});

void main() {
  test('a robot keeps its state, mission and power; origin stays SIMULATED', () {
    final r = BrainRobot.fromJson(
      _robot(
        state: _state(activeId: 'c1'),
        mission: _mission('NAVIGATING'),
      ),
    );
    expect(r.online, isTrue);
    expect(r.origin, 'SIMULATED');
    expect(r.state!.phase, 'driving');
    expect(r.state!.activeCommand!.id, 'c1');
    expect(r.mission!.title, 'Inspect TEST Plant 2');
    expect(robotDoing(r), 'Driving to TEST Plant 2');
    expect(robotPowerLabel(r), 'On');
  });

  test('an off robot says why, not what it was doing', () {
    final r = BrainRobot.fromJson(_robot(connection: 'offline'));
    expect(r.online, isFalse);
    expect(robotPowerLabel(r), 'Off · it stopped by itself');
    expect(robotDoing(r), 'Off · it stopped by itself');
  });

  test('a go_to mission has no inspecting step', () {
    final m = RobotMission.fromJson({..._mission('NAVIGATING'), 'kind': 'go_to', 'station_id': 'dock'});
    expect(m.steps, isNot(contains('INSPECTING')));
    expect(m.title, 'Go to TEST Plant 2');
  });

  test('where: at a station within 0.35 m of its approach, else near the closest with the distance', () {
    expect(robotWhere(const RobotPose(3.3, 0.45, 90), _scene), 'At TEST Plant 2');
    expect(robotWhere(const RobotPose(1.0, 0.0, 0), _scene), 'Near TEST dock · 1.0 m away');
    expect(robotWhere(const RobotPose(1.0, 0.0, 0), null), 'x 1.00 m, y 0.00 m');
  });

  test('commands are said in words, with the station named from the scene', () {
    expect(commandLabel(_cmd('a', 'go_to', {'station_id': 'p2'}, 'running'), _scene), 'Go to TEST Plant 2');
    expect(commandLabel(_cmd('b', 'go_to', {'x': 1, 'y': 0.5}, 'sent')), 'Go to x 1.0, y 0.5');
    expect(commandLabel(_cmd('c', 'look', {'head_pitch': 0.45}, 'done')), 'Look down (head 0.45 rad)');
    expect(commandLabel(_cmd('d', 'look', {'head_pitch': 0.0}, 'done')), 'Look ahead (head back to 0)');
    expect(commandActorLabel('user:123'), 'A person');
    expect(commandStateLabel('rejected'), 'Refused by the robot');
  });

  test('the command now is the one the simulator runs, with Lefi Brain’s arguments', () {
    final r = BrainRobot.fromJson(
      _robot(
        state: _state(activeId: 'c2'),
        mission: _mission('NAVIGATING'),
      ),
    );
    final live = RobotLive(
      robot: r,
      commands: [
        _cmd('c3', 'look', {'head_pitch': 0.0}, 'done'),
        _cmd('c2', 'go_to', {'station_id': 'p2'}, 'running'),
      ],
      missions: const [],
      scene: _scene,
    );
    expect(live.current!.id, 'c2');
    expect(commandLabel(live.current!, _scene), 'Go to TEST Plant 2');
  });

  test('with no active command from the simulator, the newest unfinished one; none when all ended', () {
    final r = BrainRobot.fromJson(_robot(state: _state()));
    final some = RobotLive(
      robot: r,
      commands: [
        _cmd('c5', 'stop', {}, 'sent'),
        _cmd('c4', 'go_to', {'station_id': 'p2'}, 'done'),
      ],
      missions: const [],
    );
    expect(some.current!.id, 'c5');
    final none = RobotLive(robot: r, commands: [_cmd('c4', 'go_to', {}, 'done')], missions: const []);
    expect(none.current, isNull);
  });
}
