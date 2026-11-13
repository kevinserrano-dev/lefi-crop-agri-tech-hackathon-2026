import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../core/feedback/feedback.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/overlays.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/selectors.dart';
import '../../../shared/domain/role.dart';
import '../../../app/router/routes.dart';
import '../../../core/theme/tone.dart';
import '../../auth/application/session.dart';
import '../application/ai_controller.dart';
import '../application/brain_ai_control.dart';
import '../domain/ai_status.dart';

class _AiTone {
  const _AiTone(this.bg, this.border, this.fg, this.dot, this.icon);
  final Color bg;
  final Color border;
  final Color fg;
  final Color dot;
  final IconData icon;
}

_AiTone _toneOf(AiStatus s) => s.isHalted
    ? const _AiTone(
        LefiColors.dangerWash2,
        LefiColors.dangerBorder,
        LefiColors.dangerDeep,
        LefiColors.danger,
        Symbols.front_hand_rounded,
      )
    : const _AiTone(
        Color(0xFFFFF9EC),
        Color(0xFFF1DDB0),
        Color(0xFF8A5A00),
        Color(0xFFE0A21B),
        Symbols.cloud_off_rounded,
      );

/// Home "Lefi AI · online" row with the Stop AI kill switch.
class AiStatusRow extends ConsumerWidget {
  const AiStatusRow({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(aiControllerProvider).value ?? const AiStatus.outage(at: '—');
    final user = ref.watch(currentUserProvider);
    final online = status.isOnline;
    final t = _toneOf(status);
    final label = online
        ? 'Lefi AI · online'
        : status.isHalted
        ? (status.scope == HaltScope.aiAndAutomations ? 'AI + automations stopped' : 'Lefi AI stopped')
        : 'AI offline · manual mode';
    final sub = online
        ? 'All decisions need approval unless set on web'
        : status.isHalted
        ? 'By ${status.by} · ${status.at} · tap for details'
        : 'Server unreachable · retrying every 30 s';
    return Container(
      constraints: const BoxConstraints(minHeight: 60),
      padding: const EdgeInsets.fromLTRB(14, 8, 8, 8),
      decoration: BoxDecoration(
        color: online ? Colors.white : t.bg,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: online ? LefiColors.border : t.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: InkWell(
              onTap: () => showAiStatusSheet(context),
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 44),
                child: Row(
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(shape: BoxShape.circle, color: online ? LefiColors.brand : t.dot),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(label, style: LefiText.body(14, weight: 800, color: online ? LefiColors.ink : t.fg)),
                          const SizedBox(height: 1),
                          Text(
                            sub,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: LefiText.body(12, color: LefiColors.muted),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (online && user.role.can(Permission.haltAi)) ...[
            const SizedBox(width: 10),
            SizedBox(
              width: 112,
              child: LefiButton(
                label: 'Stop AI',
                icon: Symbols.front_hand_rounded,
                iconSize: 19,
                height: 44,
                radius: 12,
                fontSize: 13.5,
                background: LefiColors.dangerStop,
                onPressed: () => showEmergencyStopSheet(context),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Bar shown on other screens while AI is not online (manual mode).
class AiOfflineBar extends ConsumerWidget {
  const AiOfflineBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(onBrainProvider)) return const _BrainAiBar();
    final s = ref.watch(aiControllerProvider).value;
    if (s == null || s.isOnline) return const SizedBox.shrink();
    final t = _toneOf(s);
    final title = s.isHalted ? 'AI stopped by ${s.by!.split(' ').first} · ${s.at}' : 'Lefi AI offline since ${s.at}';
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Material(
        color: t.bg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: t.border),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: () => showAiStatusSheet(context),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                Icon(t.icon, size: 22, color: t.fg),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: LefiText.body(13.5, weight: 800, color: t.fg)),
                      Text(
                        'Manual mode · sensors, alerts, tasks and robot buttons still work',
                        style: LefiText.body(12, color: LefiColors.secondary),
                      ),
                    ],
                  ),
                ),
                const Chevron(color: LefiColors.faint),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// On Lefi Brain: shown while Lefi AI is stopped or unavailable (`/ai/assistant`, every role).
/// Tap = AI control & safety for roles that have it.
class _BrainAiBar extends ConsumerWidget {
  const _BrainAiBar();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ai = ref.watch(brainAiStateProvider).value;
    if (ai == null || ai.available) return const SizedBox.shrink();
    final canOpen = ref.watch(brainAiControlRepositoryProvider) != null;
    final stopped = ai.killSwitch;
    final t = stopped ? Tone.crit : Tone.warn;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Material(
        color: t.bg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: t.dot),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: canOpen ? () => context.pushAiControl() : null,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                Icon(stopped ? Symbols.front_hand_rounded : Symbols.cloud_off_rounded, size: 22, color: t.fg),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        stopped ? 'Lefi AI stopped by a person' : 'Lefi AI unavailable',
                        style: LefiText.body(13.5, weight: 800, color: t.fg),
                      ),
                      Text(
                        'Sensors, rules, alerts, tasks and handover keep working without it',
                        style: LefiText.body(12, color: LefiColors.secondary),
                      ),
                    ],
                  ),
                ),
                if (canOpen) const Chevron(color: LefiColors.faint),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

Future<void> showAiStatusSheet(BuildContext context) =>
    showLefiSheet<void>(context, builder: (_) => const _AiStatusSheet());

class _AiStatusSheet extends ConsumerWidget {
  const _AiStatusSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(aiControllerProvider).value ?? const AiStatus.online();
    final role = ref.watch(currentUserProvider).role;
    final (label, bg, fg, icon, desc) = switch (s.availability) {
      AiAvailability.online => (
        'Online',
        const Color(0xFFE4F4EA),
        const Color(0xFF1F7A4D),
        Symbols.psychiatry_rounded,
        'All AI services healthy. Autonomy is set by the System Administrator on the web; by default every AI action asks for approval.',
      ),
      AiAvailability.halted => (
        s.scope == HaltScope.aiAndAutomations ? 'Stopped · AI + automations' : 'Stopped · AI only',
        const Color(0xFFFBE4E2),
        LefiColors.dangerDeep,
        Symbols.front_hand_rounded,
        'Emergency stop by ${s.by} at ${s.at}${s.reason != null ? ' · “${s.reason}”' : ''}. Stopped missions and automations stay stopped until someone restarts them.',
      ),
      AiAvailability.outage => (
        'Offline · manual mode',
        const Color(0xFFFCF0D6),
        const Color(0xFF8A5A00),
        Symbols.cloud_off_rounded,
        'The AI server is not responding since ${s.at}. Lefi Crop switched to manual mode automatically and keeps working on the on-site rules engine.',
      ),
    };
    final keeps = [
      'Live sensor readings and threshold alerts',
      'Alert calls & SMS on the fixed escalation chain',
      'Tasks, photos, handover and issue reports',
      'Manual robot buttons: pause, stop, return, photo',
      s.isHalted && s.scope == HaltScope.aiAndAutomations
          ? 'Irrigation & vents on manual hold'
          : 'Climate & irrigation on the last approved schedule',
    ];
    const paused = [
      'AI plant diagnosis and suggestions',
      'AI robot dispatch and voice/text commands',
      'Dynamic escalation (falls back to fixed chain)',
    ];
    final canResume = s.isHalted && role.can(Permission.resumeAi);
    final note = s.availability == AiAvailability.outage
        ? 'Reconnects automatically when the server is back.'
        : (s.isHalted && !role.can(Permission.resumeAi))
        ? 'Only the Greenhouse Manager can resume AI from mobile (or an admin on the web).'
        : null;

    Widget line(IconData i, Color c, String t) => Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(i, size: 18, color: c),
          const SizedBox(width: 8),
          Expanded(child: Text(t, style: LefiText.body(13.5, height: 1.4))),
        ],
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            IconTile(icon, size: 48, radius: 14, iconSize: 26, background: bg, foreground: fg),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Overline('Lefi AI'),
                const SizedBox(height: 2),
                Text(label, style: LefiText.outfit(20, color: fg)),
              ],
            ),
          ],
        ),
        const SizedBox(height: 14),
        Text(desc, style: LefiText.body(13.5, color: LefiColors.strong, height: 1.5)),
        const SizedBox(height: 14),
        const Overline('Works without AI', color: Color(0xFF1F7A4D)),
        for (final k in keeps) line(Symbols.check_circle_rounded, LefiColors.success, k),
        const SizedBox(height: 14),
        const Overline('Needs AI', color: Color(0xFF8A5A00)),
        for (final k in paused)
          line(s.isOnline ? Symbols.psychiatry_rounded : Symbols.pause_circle_rounded, const Color(0xFFE0A21B), k),
        if (canResume) ...[
          const SizedBox(height: 14),
          LefiButton(
            label: 'Resume Lefi AI',
            icon: Symbols.play_circle_rounded,
            onPressed: () async {
              await ref.read(aiControllerProvider.notifier).resume();
              if (context.mounted) Navigator.pop(context);
              ref.read(toastProvider.notifier).show('Lefi AI resumed. Stopped missions stay stopped.');
            },
          ),
        ],
        if (note != null) ...[const SizedBox(height: 14), InfoNote(text: note, icon: Symbols.info_rounded)],
        if (s.isOnline && role.can(Permission.haltAi)) ...[
          const SizedBox(height: 14),
          LefiButton(
            label: 'Emergency stop',
            icon: Symbols.front_hand_rounded,
            background: LefiColors.dangerStop,
            onPressed: () {
              Navigator.pop(context);
              showEmergencyStopSheet(context);
            },
          ),
        ],
      ],
    );
  }
}

Future<void> showEmergencyStopSheet(BuildContext context) =>
    showLefiSheet<void>(context, builder: (_) => const _EmergencyStopSheet());

class _EmergencyStopSheet extends ConsumerStatefulWidget {
  const _EmergencyStopSheet();

  @override
  ConsumerState<_EmergencyStopSheet> createState() => _EmergencyStopSheetState();
}

class _EmergencyStopSheetState extends ConsumerState<_EmergencyStopSheet> {
  HaltScope _scope = HaltScope.aiOnly;
  String? _why;

  @override
  Widget build(BuildContext context) {
    const scopes = [
      (
        HaltScope.aiOnly,
        'Stop Lefi AI only',
        'AI decisions, AI-run actions and voice/text robot commands stop. Climate and irrigation schedules keep running.',
      ),
      (
        HaltScope.aiAndAutomations,
        'Stop AI + all automations',
        'Robots safe-stop and dock, dosing pumps close, irrigation goes to manual hold, vents hold position.',
      ),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Icon(Symbols.emergency_home_rounded, size: 30, color: LefiColors.danger),
            const SizedBox(width: 10),
            Text('Emergency stop', style: LefiText.outfit(22)),
          ],
        ),
        const SizedBox(height: 14),
        Text(
          'Use it if Lefi AI made a mistake or is running something unsafe for the greenhouse. It takes effect at once and is logged.',
          style: LefiText.body(14, color: LefiColors.strong, height: 1.5),
        ),
        for (final (k, l, d) in scopes) ...[
          const SizedBox(height: 14),
          Material(
            color: _scope == k ? LefiColors.dangerWash2 : Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(color: _scope == k ? LefiColors.danger : LefiColors.border, width: 1.5),
            ),
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: () => setState(() => _scope = k),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(top: 1),
                      child: RadioDot(
                        selected: _scope == k,
                        color: LefiColors.danger,
                        idle: LefiColors.border,
                        fillBackground: true,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(l, style: LefiText.body(15, weight: 800)),
                          const SizedBox(height: 3),
                          Text(d, style: LefiText.body(12.5, color: LefiColors.secondary, height: 1.45)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
        const SizedBox(height: 14),
        Text('Why? (optional)', style: LefiText.body(13, weight: 700, color: LefiColors.strong)),
        const SizedBox(height: 14),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final r in const ['Wrong action', 'Unsafe for crop', 'Crew in zone', 'Sensor fault'])
              PillButton(
                label: r,
                selected: _why == r,
                height: 40,
                radius: 11,
                horizontalPadding: 12,
                borderWidth: 1.5,
                onTap: () => setState(() => _why = _why == r ? null : r),
              ),
          ],
        ),
        const SizedBox(height: 14),
        LefiButton(
          label: 'STOP NOW',
          icon: Symbols.front_hand_rounded,
          iconSize: 24,
          height: 58,
          radius: 16,
          letterSpacing: .5,
          background: LefiColors.dangerStop,
          shadow: const [BoxShadow(color: Color(0x4DC93A3A), blurRadius: 20, offset: Offset(0, 8))],
          onPressed: () async {
            await ref.read(aiControllerProvider.notifier).halt(_scope, _why);
            if (context.mounted) Navigator.pop(context);
            ref
                .read(toastProvider.notifier)
                .show(
                  _scope == HaltScope.aiOnly
                      ? 'Lefi AI stopped. Sensors and alarms stay on.'
                      : 'AI and automations stopped. Sensors and alarms stay on.',
                  bad: true,
                );
          },
        ),
        const SizedBox(height: 14),
        Text(
          'Sensors and alarms stay on. Robots also keep their physical E-stop button.',
          textAlign: TextAlign.center,
          style: LefiText.body(12, color: LefiColors.subtle, height: 1.45),
        ),
      ],
    );
  }
}
