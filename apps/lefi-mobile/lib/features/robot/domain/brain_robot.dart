import 'dart:math' as math;

import '../../brain/data/brain_json.dart';

/// Where the simulated robot is in the simulated greenhouse (metres; heading 0 = +x, 90 = +y).
class RobotPose {
  const RobotPose(this.x, this.y, this.yawDeg);
  factory RobotPose.fromJson(Map<String, dynamic> j) =>
      RobotPose(jd(j['x']) ?? 0, jd(j['y']) ?? 0, jd(j['yaw_deg']) ?? 0);
  final double x;
  final double y;
  final double yawDeg;

  double distanceTo(double ox, double oy) => math.sqrt(math.pow(x - ox, 2) + math.pow(y - oy, 2));
}

/// The command the simulator says it is running now.
class RobotActiveCommand {
  const RobotActiveCommand(this.id, this.kind, this.state);
  final String id;
  final String kind;
  final String state;
}

/// What the simulator reports about the robot (ADR-091, `RobotStateOut`).
class RobotLiveState {
  const RobotLiveState({
    required this.pose,
    required this.phase,
    required this.moving,
    required this.linearMps,
    required this.headPitch,
    required this.odometryM,
    this.activeCommand,
  });
  factory RobotLiveState.fromJson(Map<String, dynamic> j) {
    final c = j['active_command'];
    return RobotLiveState(
      pose: RobotPose.fromJson(jm(j['pose'])),
      phase: js(j['phase'], 'idle'),
      moving: jb(j['moving']),
      linearMps: jd(j['linear_mps']) ?? 0,
      headPitch: jd(j['head_pitch']) ?? 0,
      odometryM: jd(j['odometry_m']) ?? 0,
      activeCommand: c is Map<String, dynamic>
          ? RobotActiveCommand(js(c['command_id']), js(c['kind']), js(c['state']))
          : null,
    );
  }
  final RobotPose pose;

  /// idle · turning · driving · aligning
  final String phase;
  final bool moving;
  final double linearMps;
  final double headPitch;
  final double odometryM;
  final RobotActiveCommand? activeCommand;
}

class RobotMissionEvent {
  const RobotMissionEvent(this.at, this.state, this.note);
  final DateTime? at;
  final String state;
  final String? note;
}

/// What a person asked the robot to do; Lefi Brain turns it into commands (ADR-091).
class RobotMission {
  const RobotMission({
    required this.id,
    required this.kind,
    required this.stationId,
    required this.stationLabel,
    required this.state,
    required this.active,
    required this.events,
    this.createdAt,
    this.finishedAt,
    this.reason,
  });
  factory RobotMission.fromJson(Map<String, dynamic> j) => RobotMission(
    id: js(j['id']),
    kind: js(j['kind'], 'inspect'),
    stationId: js(j['station_id']),
    stationLabel: js(j['station_label'], js(j['station_id'])),
    state: js(j['state']),
    active: jb(j['active']),
    createdAt: jt(j['created_at']),
    finishedAt: jt(j['finished_at']),
    reason: jsn(j['reason']),
    events: [for (final e in jl(j['events'])) RobotMissionEvent(jt(e['at']), js(e['state']), jsn(e['note']))],
  );
  final String id;

  /// inspect · go_to
  final String kind;
  final String stationId;
  final String stationLabel;
  final String state;
  final bool active;
  final DateTime? createdAt;
  final DateTime? finishedAt;
  final String? reason;
  final List<RobotMissionEvent> events;

  /// "Inspect Plant 2" · "Go to Charging dock"
  String get title => kind == 'go_to' ? 'Go to $stationLabel' : 'Inspect $stationLabel';

  /// The mission's steps, in order (a go_to has no inspecting step).
  List<String> get steps => [
    'QUEUED',
    'DISPATCHED',
    'NAVIGATING',
    if (kind != 'go_to') 'INSPECTING',
    'REPORTING',
    'COMPLETED',
  ];
}

/// One command Lefi Brain sent the robot (`RobotCommandOut`).
class RobotCommand {
  const RobotCommand({
    required this.id,
    required this.kind,
    required this.args,
    required this.state,
    required this.actor,
    this.missionId,
    this.sentAt,
    this.message,
  });
  factory RobotCommand.fromJson(Map<String, dynamic> j) => RobotCommand(
    id: js(j['id']),
    kind: js(j['kind']),
    args: jm(j['args']),
    state: js(j['state']),
    actor: js(j['actor']),
    missionId: jsn(j['mission_id']),
    sentAt: jt(j['sent_at']),
    message: jsn(j['message']),
  );
  final String id;

  /// go_to · look · stop
  final String kind;
  final Map<String, dynamic> args;

  /// sent · accepted · running · done · failed · cancelled · rejected · unreachable
  final String state;

  /// `lefi-brain` (for a mission) or `user:<id>` (a person's safe stop).
  final String actor;
  final String? missionId;
  final DateTime? sentAt;
  final String? message;

  bool get finished => const {'done', 'failed', 'cancelled', 'rejected', 'unreachable'}.contains(state);
}

/// The simulated robot as Lefi Brain reports it (`RobotOut`). Always SIMULATED (ADR-091).
class BrainRobot {
  const BrainRobot({
    required this.id,
    required this.name,
    required this.model,
    required this.origin,
    required this.connection,
    this.backend,
    this.state,
    this.lastSeen,
    this.mission,
    this.error,
    this.installStatus,
    this.power,
    this.powerProblem,
    this.powerMessage,
  });
  factory BrainRobot.fromJson(Map<String, dynamic> j) {
    final m = j['active_mission'];
    final s = j['state'];
    final d = j['device'];
    final pd = jm(j['power_detail']);
    return BrainRobot(
      id: js(j['id']),
      name: js(j['name'], 'Robot'),
      model: js(j['model']),
      origin: js(j['origin'], 'SIMULATED'),
      connection: js(j['connection'], 'never_seen'),
      backend: jsn(j['backend']),
      state: s is Map<String, dynamic> ? RobotLiveState.fromJson(s) : null,
      lastSeen: jt(j['last_seen']),
      mission: m is Map<String, dynamic> ? RobotMission.fromJson(m) : null,
      error: jsn(j['error']),
      installStatus: d is Map<String, dynamic> ? jsn(d['status']) : null,
      power: jsn(j['power']),
      powerProblem: jsn(pd['problem']),
      powerMessage: jsn(pd['message']),
    );
  }
  final String id;
  final String name;
  final String model;
  final String origin;

  /// online · offline · never_seen
  final String connection;
  final String? backend;
  final RobotLiveState? state;
  final DateTime? lastSeen;
  final RobotMission? mission;
  final String? error;

  /// Added from Lefi Desktop (ADR-090): installing · installed · install_failed · …; null = configured by hand.
  final String? installStatus;

  /// on · starting · off · unknown; null when it was not added from Lefi Desktop.
  final String? power;
  final String? powerProblem;
  final String? powerMessage;

  bool get online => connection == 'online';
}

class SceneStation {
  const SceneStation(this.id, this.label, this.kind, this.x, this.y, this.approach);
  final String id;
  final String label;

  /// a plant kind (lettuce, tomato…) or `dock`
  final String kind;
  final double x;
  final double y;
  final RobotPose approach;
}

class SceneBench {
  const SceneBench(this.label, this.x, this.y, this.length, this.width);
  final String label;
  final double x;
  final double y;
  final double length;
  final double width;
}

/// The simulated greenhouse the robot drives in (`RobotSceneOut`). Its places are SIMULATED, not
/// registered plants.
class RobotScene {
  const RobotScene({
    required this.name,
    required this.xMin,
    required this.xMax,
    required this.yMin,
    required this.yMax,
    required this.benches,
    required this.stations,
  });
  factory RobotScene.fromJson(Map<String, dynamic> j) {
    final b = jm(j['bounds']);
    return RobotScene(
      name: js(j['name'], 'Simulated greenhouse'),
      xMin: jd(b['x_min']) ?? -1,
      xMax: jd(b['x_max']) ?? 1,
      yMin: jd(b['y_min']) ?? -1,
      yMax: jd(b['y_max']) ?? 1,
      benches: [
        for (final x in jl(j['benches']))
          SceneBench(js(x['label']), jd(x['x']) ?? 0, jd(x['y']) ?? 0, jd(x['length']) ?? 0, jd(x['width']) ?? 0),
      ],
      stations: [
        for (final x in jl(j['stations']))
          SceneStation(
            js(x['id']),
            js(x['label'], js(x['id'])),
            js(x['kind']),
            jd(x['x']) ?? 0,
            jd(x['y']) ?? 0,
            RobotPose.fromJson(jm(x['approach'])),
          ),
      ],
    );
  }
  final String name;
  final double xMin;
  final double xMax;
  final double yMin;
  final double yMax;
  final List<SceneBench> benches;
  final List<SceneStation> stations;

  SceneStation? station(String id) {
    for (final s in stations) {
      if (s.id == id) return s;
    }
    return null;
  }
}

/// Within this distance of a station's approach spot the robot is "at" it.
const robotAtStationM = 0.35;

/// "At Plant 2" · "Near Plant 2 · 1.4 m away" · "x 1.20 m, y 0.50 m", from the pose and the scene.
String robotWhere(RobotPose pose, RobotScene? scene) {
  final coords = 'x ${pose.x.toStringAsFixed(2)} m, y ${pose.y.toStringAsFixed(2)} m';
  if (scene == null || scene.stations.isEmpty) return coords;
  SceneStation? best;
  var bestD = double.infinity;
  for (final s in scene.stations) {
    final d = pose.distanceTo(s.approach.x, s.approach.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (bestD <= robotAtStationM) return 'At ${best!.label}';
  return 'Near ${best!.label} · ${bestD.toStringAsFixed(1)} m away';
}

String missionStateLabel(String s) => switch (s) {
  'CREATED' => 'Created',
  'VALIDATING' => 'Checking',
  'QUEUED' => 'Queued',
  'DISPATCHED' => 'Sent',
  'NAVIGATING' => 'Driving',
  'INSPECTING' => 'Inspecting',
  'REPORTING' => 'Reporting',
  'COMPLETED' => 'Done',
  'CANCELLED' => 'Cancelled',
  'FAILED' => 'Failed',
  'TIMED_OUT' => 'Timed out',
  _ => humanize(s.toLowerCase()),
};

String robotPhaseLabel(String p) => switch (p) {
  'idle' => 'Standing still',
  'turning' => 'Turning',
  'driving' => 'Driving',
  'aligning' => 'Facing the plant',
  _ => humanize(p),
};

String commandStateLabel(String s) => switch (s) {
  'sent' => 'Sent',
  'accepted' => 'Accepted',
  'running' => 'Running',
  'done' => 'Done',
  'failed' => 'Failed',
  'cancelled' => 'Cancelled',
  'rejected' => 'Refused by the robot',
  'unreachable' => 'Never reached the robot',
  _ => humanize(s),
};

/// "Go to Plant 2" · "Go to x 1.0, y 0.5" · "Look down (head 0.45 rad)" · "Look ahead" · "Stop".
String commandLabel(RobotCommand c, [RobotScene? scene]) {
  final a = c.args;
  switch (c.kind) {
    case 'go_to':
      final sid = jsn(a['station_id']);
      if (sid != null) return 'Go to ${scene?.station(sid)?.label ?? sid}';
      return 'Go to x ${(jd(a['x']) ?? 0).toStringAsFixed(1)}, y ${(jd(a['y']) ?? 0).toStringAsFixed(1)}';
    case 'look':
      final p = jd(a['head_pitch']) ?? 0;
      if (p.abs() < 0.01) return 'Look ahead (head back to 0)';
      return '${p > 0 ? 'Look down' : 'Look up'} (head ${p.toStringAsFixed(2)} rad)';
    case 'stop':
      return 'Stop';
    default:
      return humanize(c.kind);
  }
}

/// Who sent it, as the phone can say it without reading people's accounts.
String commandActorLabel(String actor) =>
    actor == 'lefi-brain' ? 'Lefi Brain, for the mission' : (actor.startsWith('user:') ? 'A person' : actor);

/// The power state in words (ADR-104); null when the robot was not added from Lefi Desktop.
String? robotPowerLabel(BrainRobot r) => switch (r.power) {
  'on' => 'On',
  'starting' => 'Starting…',
  'off' => switch (r.powerProblem) {
    'starter_missing' || 'program_missing' => 'Off · files missing (reinstall it in Lefi Desktop)',
    'stopped' => 'Off · it stopped by itself',
    'power_failed' => 'Off · the last request failed',
    _ => 'Off',
  },
  'unknown' => 'Unknown · Lefi Crop Helper is not answering on its PC',
  _ => null,
};
