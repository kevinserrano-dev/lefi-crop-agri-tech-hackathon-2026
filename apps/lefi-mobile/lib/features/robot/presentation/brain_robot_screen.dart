import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/overlays.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../brain/data/brain_json.dart';
import '../../tasks/presentation/brain_task_sheets.dart' show runBrain;
import '../application/brain_robots.dart';
import '../domain/brain_robot.dart';
import 'robot_map.dart';

/// Poses kept for the path drawn on the map while the screen is open.
const _trailMax = 300;

Tone missionTone(String s) => switch (s) {
  'COMPLETED' => Tone.ok,
  'FAILED' || 'TIMED_OUT' => Tone.crit,
  'CANCELLED' => Tone.off,
  _ => Tone.info,
};

Tone commandTone(String s) => switch (s) {
  'done' => Tone.ok,
  'running' || 'accepted' || 'sent' => Tone.info,
  'failed' || 'rejected' || 'unreachable' => Tone.crit,
  _ => Tone.off,
};

/// "Inspecting Plant 2" · "Driving to Charging dock" · "Standing still" — what the robot is doing.
String robotDoing(BrainRobot r) {
  final m = r.mission;
  if (m != null && m.active) {
    final s = missionStateLabel(m.state);
    return switch (m.state) {
      'NAVIGATING' || 'DISPATCHED' => 'Driving to ${m.stationLabel}',
      'INSPECTING' => 'Inspecting ${m.stationLabel}',
      'REPORTING' => 'Finishing at ${m.stationLabel}',
      _ => '$s · ${m.title}',
    };
  }
  if (!r.online) return robotPowerLabel(r) ?? 'Not answering';
  return 'No mission · ${robotPhaseLabel(r.state?.phase ?? 'idle')}';
}

/// The safe stop (`POST /robots/{id}/stop`): no question first — stopping is always the safe side.
Future<bool> safeStopRobot(WidgetRef ref, String robotId) async {
  final repo = ref.read(brainRobotRepositoryProvider);
  if (repo == null) return false;
  final ok = await runBrain(
    ref,
    'Stopping the robot…',
    () => repo.safeStop(robotId),
    done: 'Safe stop sent to the simulated robot. Recorded in the audit trail.',
  );
  ref.invalidate(brainRobotLiveProvider);
  ref.invalidate(brainRobotsProvider);
  return ok;
}

/// Cancels the mission after asking (a person asked for it); Lefi Brain tells the robot to stop.
Future<bool> cancelRobotMission(BuildContext context, WidgetRef ref, RobotMission m) async {
  final repo = ref.read(brainRobotRepositoryProvider);
  if (repo == null) return false;
  final yes = await showLefiConfirm(
    context,
    title: 'Cancel “${m.title}”?',
    body:
        'Lefi Brain tells the simulated robot to stop and records who cancelled it. Someone asks again in '
        'Lefi Desktop to repeat it.',
    confirmLabel: 'Cancel mission',
    confirmColor: LefiColors.danger,
  );
  if (!yes) return false;
  final ok = await runBrain(
    ref,
    'Cancelling the mission…',
    () => repo.cancelMission(m.id),
    done: 'Mission cancelled; the robot was told to stop.',
  );
  ref.invalidate(brainRobotLiveProvider);
  ref.invalidate(brainRobotsProvider);
  return ok;
}

/// The simulated robot on the phone (ADR-106): what it does, the command it runs, where it is; cancel
/// its mission and the safe stop. Asking for missions and power are in Lefi Desktop's Robot Mission Center.
class BrainRobotScreen extends ConsumerStatefulWidget {
  const BrainRobotScreen({super.key});

  @override
  ConsumerState<BrainRobotScreen> createState() => _BrainRobotScreenState();
}

class _BrainRobotScreenState extends ConsumerState<BrainRobotScreen> {
  final _trail = <RobotPose>[];

  void _keep(RobotPose p) {
    final last = _trail.isEmpty ? null : _trail.last;
    if (last != null && last.distanceTo(p.x, p.y) < 0.02) return;
    _trail.add(p);
    if (_trail.length > _trailMax) _trail.removeAt(0);
  }

  @override
  Widget build(BuildContext context) {
    if (ref.watch(brainRobotRepositoryProvider) == null) {
      return const PushedScreen(
        title: 'Robot',
        backLabel: 'Back',
        body: ScrollBody(
          children: [InfoNote(text: 'The robot is not for your role in Lefi Brain.', icon: Symbols.lock_rounded)],
        ),
      );
    }
    ref.listen(brainRobotLiveProvider, (_, next) {
      final pose = next.value?.robot.state?.pose;
      if (pose != null) setState(() => _keep(pose));
    });
    final live = ref.watch(brainRobotLiveProvider);
    final v = live.value;
    final active = v?.robot.mission?.active == true ? v!.robot.mission : null;
    return PushedScreen(
      title: 'Robot',
      backLabel: 'Back',
      bottom: v == null
          ? null
          : StickyActionBar(
              children: [
                if (active != null)
                  LefiOutlineButton(
                    label: 'Cancel mission',
                    icon: Symbols.cancel_rounded,
                    borderColor: LefiColors.danger,
                    foreground: LefiColors.danger,
                    onPressed: () => cancelRobotMission(context, ref, active),
                  ),
                LefiButton(
                  label: 'Safe stop',
                  icon: Symbols.front_hand_rounded,
                  background: LefiColors.dangerStop,
                  onPressed: () => safeStopRobot(ref, v.robot.id),
                ),
              ],
            ),
      body: AsyncView(
        live,
        data: (v) => RefreshIndicator(
          color: LefiColors.brandDark,
          onRefresh: () => ref.refresh(brainRobotLiveProvider.future),
          child: v == null
              ? const ScrollBody(
                  children: [
                    InfoNote(
                      text: 'Lefi Brain has no robot. It is added in Lefi Desktop → Devices & Health → Robots.',
                      icon: Symbols.smart_toy_rounded,
                    ),
                  ],
                )
              : ScrollBody(
                  children: [
                    const _SimNote(),
                    _StatusCard(v.robot),
                    _DoingCard(v),
                    _CommandCard(v),
                    _WhereCard(v, _trail),
                    if (v.commands.isNotEmpty) _Commands(v),
                    if (v.missions.any((m) => !m.active))
                      _Missions([
                        for (final m in v.missions)
                          if (!m.active) m,
                      ]),
                    Text(
                      'Anyone who sees the robot can cancel its mission or stop it. Asking for missions and '
                      'turning it on or off are in Lefi Desktop → Robot Mission Center.',
                      textAlign: TextAlign.center,
                      style: LefiText.body(12, color: LefiColors.subtle, height: 1.45),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}

class _SimNote extends StatelessWidget {
  const _SimNote();

  @override
  Widget build(BuildContext context) => const InfoNote(
    text:
        'SIMULATED robot: the MH3 in a simulation on a PC of this installation. Nothing here is a real '
        'machine or a real plant.',
    icon: Symbols.science_rounded,
    background: LefiColors.simulation,
    foreground: Colors.white,
    fontWeight: 600,
  );
}

class _StatusCard extends StatelessWidget {
  const _StatusCard(this.r);
  final BrainRobot r;

  @override
  Widget build(BuildContext context) {
    final power = robotPowerLabel(r);
    final (tone, label) = r.online
        ? (Tone.ok, 'Answering')
        : r.power == 'starting'
        ? (Tone.warn, 'Starting…')
        : (Tone.off, r.connection == 'never_seen' ? 'Never answered' : 'Not answering');
    return LefiCard(
      child: Gap(
        gap: 10,
        children: [
          Row(
            children: [
              IconTile.tone(Symbols.smart_toy_rounded, tone, size: 48, radius: 14, iconSize: 26),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(child: Text(r.name, style: LefiText.outfit(18))),
                        const SizedBox(width: 6),
                        SimulationBadge(label: r.origin, fontSize: 10),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      [r.model, if (r.backend case final b?) b == 'lite' ? '2D (lite)' : '3D (Genesis)'].join(' · '),
                      style: LefiText.body(12.5, color: LefiColors.muted),
                    ),
                  ],
                ),
              ),
              ToneChip(label, tone: tone),
            ],
          ),
          if (power != null) KeyValueRow('Power', power, fontSize: 13.5),
          if (!r.online && r.lastSeen != null) KeyValueRow('Last answered', brainWhen(r.lastSeen), fontSize: 13.5),
          if (r.installStatus case final s? when s != 'installed')
            InfoNote(text: 'Lefi Crop Helper: ${humanize(s)}', icon: Symbols.install_desktop_rounded),
          if (!r.online && r.power == null && r.error != null)
            InfoNote(text: r.error!, icon: Symbols.cloud_off_rounded),
          if (r.powerMessage case final m?) InfoNote(text: m, icon: Symbols.error_rounded),
        ],
      ),
    );
  }
}

class _DoingCard extends StatelessWidget {
  const _DoingCard(this.v);
  final RobotLive v;

  @override
  Widget build(BuildContext context) {
    final r = v.robot;
    final m = r.mission != null && r.mission!.active ? r.mission : null;
    return Gap(
      gap: 8,
      children: [
        const SectionTitle('Doing now', size: 16),
        LefiCard(
          child: Gap(
            gap: 10,
            children: [
              Text(robotDoing(r), style: LefiText.outfit(19)),
              if (m != null) ...[
                _Steps(m),
                Text(
                  'Mission · ${m.title} · asked ${brainWhen(m.createdAt)}',
                  style: LefiText.body(13, color: LefiColors.secondary),
                ),
                if (m.events.isNotEmpty && m.events.last.note != null)
                  Text(m.events.last.note!, style: LefiText.body(12.5, color: LefiColors.muted, height: 1.4)),
              ] else if (r.online)
                Text(
                  'Nobody has asked it for a mission. Missions are asked in Lefi Desktop.',
                  style: LefiText.body(13, color: LefiColors.muted, height: 1.4),
                ),
              if (r.state case final s? when r.online)
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    ToneChip(robotPhaseLabel(s.phase), tone: s.moving ? Tone.info : Tone.neutral),
                    if (s.moving) ToneChip('${s.linearMps.toStringAsFixed(2)} m/s', tone: Tone.neutral),
                    ToneChip('Head ${s.headPitch.toStringAsFixed(2)} rad', tone: Tone.neutral),
                  ],
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// The mission's steps: done ones filled, the current one ringed.
class _Steps extends StatelessWidget {
  const _Steps(this.m);
  final RobotMission m;

  @override
  Widget build(BuildContext context) {
    final steps = m.steps;
    final at = steps.indexOf(m.state);
    return Row(
      children: [
        for (var i = 0; i < steps.length; i++) ...[
          Expanded(
            child: Column(
              children: [
                Container(
                  height: 6,
                  decoration: BoxDecoration(
                    color: i < at
                        ? LefiColors.brand
                        : i == at
                        ? const Color(0xFF3C84C0)
                        : LefiColors.progressTrack,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  missionStateLabel(steps[i]),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: LefiText.body(
                    10.5,
                    weight: i == at ? 700 : 500,
                    color: i == at ? LefiColors.ink : LefiColors.faint,
                  ),
                ),
              ],
            ),
          ),
          if (i < steps.length - 1) const SizedBox(width: 4),
        ],
      ],
    );
  }
}

class _CommandCard extends StatelessWidget {
  const _CommandCard(this.v);
  final RobotLive v;

  @override
  Widget build(BuildContext context) {
    final c = v.current;
    return Gap(
      gap: 8,
      children: [
        const SectionTitle('Command now', size: 16),
        LefiCard(
          child: c == null
              ? Text('No command running.', style: LefiText.body(14, color: LefiColors.muted))
              : Gap(
                  gap: 6,
                  children: [
                    Row(
                      children: [
                        Expanded(child: Text(commandLabel(c, v.scene), style: LefiText.body(16, weight: 700))),
                        ToneChip(commandStateLabel(c.state), tone: commandTone(c.state)),
                      ],
                    ),
                    Text(
                      [
                        if (c.actor.isNotEmpty) commandActorLabel(c.actor),
                        if (c.sentAt != null) 'sent ${brainWhen(c.sentAt)}',
                      ].join(' · '),
                      style: LefiText.body(12.5, color: LefiColors.muted),
                    ),
                    if (c.message case final msg?) Text(msg, style: LefiText.body(12.5, color: LefiColors.secondary)),
                  ],
                ),
        ),
      ],
    );
  }
}

class _WhereCard extends StatelessWidget {
  const _WhereCard(this.v, this.trail);
  final RobotLive v;
  final List<RobotPose> trail;

  @override
  Widget build(BuildContext context) {
    final s = v.robot.state;
    final m = v.robot.mission;
    final c = v.current;
    final target = m != null && m.active ? m.stationId : (c?.kind == 'go_to' ? jsn(c!.args['station_id']) : null);
    return Gap(
      gap: 8,
      children: [
        const SectionTitle('Where it is', size: 16),
        LefiCard(
          child: s == null || !v.robot.online
              ? Text('Unknown while the simulator does not answer.', style: LefiText.body(14, color: LefiColors.muted))
              : Gap(
                  gap: 10,
                  children: [
                    Text(robotWhere(s.pose, v.scene), style: LefiText.outfit(18)),
                    if (v.scene case final scene?)
                      RobotMap(scene: scene, pose: s.pose, trail: trail, targetId: target)
                    else
                      Text(
                        'The map appears when the simulator sends its greenhouse.',
                        style: LefiText.body(12.5, color: LefiColors.muted),
                      ),
                    KeyValueRow(
                      'Position',
                      'x ${s.pose.x.toStringAsFixed(2)} m · y ${s.pose.y.toStringAsFixed(2)} m',
                      fontSize: 13.5,
                    ),
                    KeyValueRow('Heading', '${s.pose.yawDeg.toStringAsFixed(0)}°', fontSize: 13.5),
                    KeyValueRow(
                      'Driven',
                      '${s.odometryM.toStringAsFixed(1)} m since it started',
                      fontSize: 13.5,
                      last: true,
                    ),
                    Text(
                      v.scene == null
                          ? 'Places of the simulation, not registered plants.'
                          : '${v.scene!.name} · simulated places, not registered plants. The path is drawn '
                                'while this screen is open.',
                      style: LefiText.body(11.5, color: LefiColors.subtle, height: 1.4),
                    ),
                  ],
                ),
        ),
      ],
    );
  }
}

class _Commands extends StatelessWidget {
  const _Commands(this.v);
  final RobotLive v;

  @override
  Widget build(BuildContext context) => Gap(
    gap: 8,
    children: [
      const SectionTitle('Last commands', size: 16),
      LefiCard(
        child: Gap(
          gap: 10,
          children: [
            for (final c in v.commands.take(8))
              Row(
                children: [
                  SizedBox(
                    width: 48,
                    child: Text(brainHm(c.sentAt), style: LefiText.body(12, color: LefiColors.faint)),
                  ),
                  Expanded(child: Text(commandLabel(c, v.scene), style: LefiText.body(13.5, weight: 600))),
                  ToneChip(commandStateLabel(c.state), tone: commandTone(c.state), fontSize: 11),
                ],
              ),
          ],
        ),
      ),
    ],
  );
}

class _Missions extends StatelessWidget {
  const _Missions(this.missions);
  final List<RobotMission> missions;

  @override
  Widget build(BuildContext context) => Gap(
    gap: 8,
    children: [
      const SectionTitle('Last missions', size: 16),
      LefiCard(
        child: Gap(
          gap: 10,
          children: [
            for (final m in missions.take(5))
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(m.title, style: LefiText.body(13.5, weight: 600)),
                        Text(
                          [brainWhen(m.finishedAt ?? m.createdAt), if (m.reason != null) m.reason!].join(' · '),
                          style: LefiText.body(12, color: LefiColors.muted, height: 1.35),
                        ),
                      ],
                    ),
                  ),
                  ToneChip(missionStateLabel(m.state), tone: missionTone(m.state), fontSize: 11),
                ],
              ),
          ],
        ),
      ),
    ],
  );
}
