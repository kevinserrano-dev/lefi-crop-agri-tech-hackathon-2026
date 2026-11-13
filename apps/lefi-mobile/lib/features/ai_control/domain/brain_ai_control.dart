import '../../brain/data/brain_json.dart';

/// A part of Lefi Brain and whether it needs Lefi AI (`kind` ai) or keeps running without it.
class AiPart {
  const AiPart({required this.name, required this.needsAi, required this.state, required this.detail});
  factory AiPart.fromJson(Map<String, dynamic> j) => AiPart(
    name: js(j['name']),
    needsAi: j['kind'] == 'ai',
    state: js(j['state'], 'unavailable'),
    detail: js(j['detail']),
  );
  final String name;
  final bool needsAi;

  /// online · stopped · unavailable · not_built · off
  final String state;
  final String detail;
}

/// One line of what Lefi AI may do: allowed per camera (ADR-079) or not available, with why.
class AiAction {
  const AiAction({
    required this.name,
    required this.area,
    required this.allowed,
    required this.detail,
    this.cameras = const [],
  });
  factory AiAction.fromJson(Map<String, dynamic> j) => AiAction(
    name: js(j['name']),
    area: js(j['area']),
    allowed: j['mode'] == 'allowed_per_camera',
    detail: js(j['detail']),
    cameras: jstrs(j['cameras']),
  );
  final String name;
  final String area;
  final bool allowed;
  final String detail;
  final List<String> cameras;
}

/// `GET /ai/control` (ADR-085): Lefi AI's state, the kill switch `lefi ai off` shares, what needs
/// it and what does not, what it may do, its settings and the tools it may use for this person.
class BrainAiControl {
  const BrainAiControl({
    required this.state,
    required this.reason,
    required this.killSwitch,
    required this.busy,
    required this.parts,
    required this.actions,
    required this.settings,
    required this.tools,
    required this.canStop,
    required this.canResume,
    this.model,
    this.stoppedNote,
  });

  factory BrainAiControl.fromJson(Map<String, dynamic> j) => BrainAiControl(
    state: js(j['state'], 'unknown'),
    reason: js(j['reason']),
    model: jsn(j['model']),
    killSwitch: jb(j['kill_switch']),
    stoppedNote: jsn(j['stopped_note']),
    busy: ji(j['busy']),
    parts: [for (final p in jl(j['parts'])) AiPart.fromJson(p)],
    actions: [for (final a in jl(j['actions'])) AiAction.fromJson(a)],
    settings: [for (final s in jl(j['settings'])) (js(s['name']), js(s['value']))],
    tools: jstrs(j['tools']),
    canStop: jb(j['can_stop']),
    canResume: jb(j['can_resume']),
  );

  /// available · disabled · unreachable · model_missing · …
  final String state;
  final String reason;
  final String? model;
  final bool killSwitch;

  /// Who stopped it, when and why, as the flag file says.
  final String? stoppedNote;
  final int busy;
  final List<AiPart> parts;
  final List<AiAction> actions;
  final List<(String, String)> settings;
  final List<String> tools;
  final bool canStop;
  final bool canResume;

  bool get available => state == 'available' && !killSwitch;
  bool get stopped => killSwitch;
}

/// `GET /ai/assistant`: whether Lefi AI can answer now, for any role.
class BrainAiState {
  const BrainAiState({required this.state, required this.reason, required this.killSwitch, this.model});
  factory BrainAiState.fromJson(Map<String, dynamic> j) => BrainAiState(
    state: js(j['state'], 'unknown'),
    reason: js(j['reason']),
    model: jsn(j['model']),
    killSwitch: jb(j['kill_switch']),
  );
  final String state;
  final String reason;
  final String? model;
  final bool killSwitch;

  bool get available => state == 'available' && !killSwitch;
}

String aiPartStateLabel(String s) => switch (s) {
  'online' => 'Running',
  'stopped' => 'Stopped',
  'unavailable' => 'Unavailable',
  'not_built' => 'Not built yet',
  'off' => 'Off',
  _ => humanize(s),
};
