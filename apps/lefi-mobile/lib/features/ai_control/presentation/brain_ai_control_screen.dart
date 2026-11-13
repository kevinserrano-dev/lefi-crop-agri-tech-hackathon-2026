import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/inputs.dart';
import '../../../core/widgets/overlays.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/widgets/selectors.dart';
import '../../brain/data/brain_json.dart';
import '../../home/application/home_providers.dart';
import '../../tasks/presentation/brain_task_sheets.dart' show runBrain;
import '../application/brain_ai_control.dart';
import '../domain/brain_ai_control.dart';

/// After a stop or a resume, everything that shows Lefi AI's state asks Lefi Brain again.
void refreshBrainAi(WidgetRef ref) {
  ref.invalidate(brainAiControlProvider);
  ref.invalidate(brainAiStateProvider);
  ref.invalidate(dashboardProvider);
}

/// The emergency stop on Lefi Brain (`POST /ai/stop`, `ai.halt`): a reason is required (3–200
/// characters, kept in the flag file and the audit trail). Returns true when Lefi AI was stopped.
Future<bool> stopBrainAi(BuildContext context, WidgetRef ref) async {
  final repo = ref.read(brainAiControlRepositoryProvider);
  if (repo == null) return false;
  final reason = await showLefiSheet<String>(context, builder: (_) => const _StopSheet());
  if (reason == null) return false;
  final ok = await runBrain(
    ref,
    'Stopping Lefi AI…',
    () => repo.stop(reason),
    done: 'Lefi AI stopped. Sensors, rules and alerts keep running.',
  );
  if (ok) refreshBrainAi(ref);
  return ok;
}

Future<bool> resumeBrainAi(WidgetRef ref) async {
  final repo = ref.read(brainAiControlRepositoryProvider);
  if (repo == null) return false;
  final ok = await runBrain(ref, 'Resuming Lefi AI…', repo.resume, done: 'Lefi AI resumed.');
  if (ok) refreshBrainAi(ref);
  return ok;
}

class _StopSheet extends StatefulWidget {
  const _StopSheet();

  @override
  State<_StopSheet> createState() => _StopSheetState();
}

class _StopSheetState extends State<_StopSheet> {
  final _ctl = TextEditingController();

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  bool get _valid => _ctl.text.trim().length >= 3 && _ctl.text.trim().length <= 200;

  @override
  Widget build(BuildContext context) {
    const quick = ['Wrong answer', 'Wrong camera move', 'Someone is in the zone', 'Checking the system'];
    return Gap(
      gap: 14,
      children: [
        Row(
          children: [
            const Icon(Symbols.emergency_home_rounded, size: 30, color: LefiColors.danger),
            const SizedBox(width: 10),
            Text('Stop Lefi AI', style: LefiText.outfit(22)),
          ],
        ),
        Text(
          'Lefi AI stops answering and moves no camera until a manager resumes it. The same switch as '
          '“lefi ai off”: Lefi Desktop and the CLI see it at once. Lefi Brain records who stopped it and why.',
          style: LefiText.body(14, color: LefiColors.strong, height: 1.5),
        ),
        Text('Why?', style: LefiText.body(13, weight: 700, color: LefiColors.strong)),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final r in quick)
              PillButton(
                label: r,
                selected: _ctl.text == r,
                height: 40,
                radius: 11,
                horizontalPadding: 12,
                borderWidth: 1.5,
                onTap: () => setState(() => _ctl.text = r),
              ),
          ],
        ),
        LefiTextField(
          controller: _ctl,
          minLines: 2,
          fontSize: 15,
          hint: 'Reason (required, up to 200 characters)',
          textCapitalization: TextCapitalization.sentences,
          onChanged: (_) => setState(() {}),
        ),
        LefiButton(
          label: 'STOP LEFI AI',
          icon: Symbols.front_hand_rounded,
          iconSize: 24,
          height: 58,
          radius: 16,
          letterSpacing: .5,
          background: LefiColors.dangerStop,
          opacity: _valid ? 1 : .45,
          onPressed: () {
            if (_valid) Navigator.pop(context, _ctl.text.trim());
          },
        ),
        Text(
          'There is no pump, valve or motor for Lefi AI to stop: Lefi Brain gives it no actuator. '
          'Robots keep their own safe stop.',
          textAlign: TextAlign.center,
          style: LefiText.body(12, color: LefiColors.subtle, height: 1.45),
        ),
      ],
    );
  }
}

/// AI Control & Safety on Lefi Brain (ADR-085, 102).
class BrainAiControlScreen extends ConsumerWidget {
  const BrainAiControlScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(brainAiControlRepositoryProvider) == null) {
      return const PushedScreen(
        title: 'AI control & safety',
        backLabel: 'Back',
        body: ScrollBody(
          children: [
            InfoNote(text: 'AI control & safety is not for your role in Lefi Brain.', icon: Symbols.lock_rounded),
          ],
        ),
      );
    }
    final async = ref.watch(brainAiControlProvider);
    final v = async.value;
    Widget? bottom;
    if (v != null) {
      if (v.stopped && v.canResume) {
        bottom = StickyActionBar(
          children: [
            LefiButton(label: 'Resume Lefi AI', icon: Symbols.play_circle_rounded, onPressed: () => resumeBrainAi(ref)),
          ],
        );
      } else if (v.stopped) {
        bottom = const StickyActionBar(
          children: [
            DoneBanner(label: 'Stopped · only a manager or an administrator resumes it', icon: Symbols.lock_rounded),
          ],
        );
      } else if (v.canStop) {
        bottom = StickyActionBar(
          children: [
            LefiButton(
              label: 'Stop Lefi AI',
              icon: Symbols.front_hand_rounded,
              background: LefiColors.dangerStop,
              onPressed: () => stopBrainAi(context, ref),
            ),
          ],
        );
      }
    }
    return PushedScreen(
      title: 'AI control & safety',
      backLabel: 'Back',
      bottom: bottom,
      body: AsyncView(
        async,
        data: (v) => RefreshIndicator(
          color: LefiColors.brandDark,
          onRefresh: () => ref.refresh(brainAiControlProvider.future),
          child: ScrollBody(
            children: [
              _StateCard(v),
              _Parts('Needs Lefi AI', [
                for (final p in v.parts)
                  if (p.needsAi) p,
              ]),
              _Parts('Keeps running without Lefi AI', [
                for (final p in v.parts)
                  if (!p.needsAi) p,
              ]),
              _Actions(v.actions),
              _Settings(v),
            ],
          ),
        ),
      ),
    );
  }
}

class _StateCard extends StatelessWidget {
  const _StateCard(this.v);
  final BrainAiControl v;

  @override
  Widget build(BuildContext context) {
    final (tone, icon, label) = v.stopped
        ? (Tone.crit, Symbols.front_hand_rounded, 'Stopped')
        : v.available
        ? (Tone.ok, Symbols.psychiatry_rounded, 'Available')
        : (Tone.warn, Symbols.cloud_off_rounded, humanize(v.state));
    return LefiCard(
      color: v.available ? LefiColors.surface : tone.bg,
      borderColor: v.available ? LefiColors.border : tone.dot,
      child: Gap(
        gap: 10,
        children: [
          Row(
            children: [
              IconTile.tone(icon, tone, size: 48, radius: 14, iconSize: 26),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Overline('Lefi AI'),
                    const SizedBox(height: 2),
                    Text(label, style: LefiText.outfit(20, color: tone.fg)),
                  ],
                ),
              ),
              if (v.busy > 0) ToneChip('${plural(v.busy, 'answer')} now', tone: Tone.ai),
            ],
          ),
          if (v.model != null)
            Text('Model · ${v.model}', style: LefiText.body(13, weight: 700, color: LefiColors.strong)),
          if (v.reason.isNotEmpty)
            Text(v.reason, style: LefiText.body(13.5, color: LefiColors.secondary, height: 1.45)),
          if (v.stoppedNote case final n?)
            InfoNote(
              text: humanizeStopNote(n),
              icon: Symbols.front_hand_rounded,
              background: Tone.crit.bg,
              foreground: Tone.crit.fg,
            ),
          Text(
            'Lefi AI explains and suggests; it never runs a pump, valve or motor. Rules, alerts and '
            'sensors do not depend on it.',
            style: LefiText.body(12.5, color: LefiColors.muted, height: 1.45),
          ),
        ],
      ),
    );
  }
}

/// The flag file says "stopped by Name (user) at 2026-…T…: reason"; the time is shown local.
String humanizeStopNote(String note) {
  final m = RegExp(r'^stopped by (.+?) at (\S+?): (.*)$', dotAll: true).firstMatch(note.trim());
  if (m == null) return note;
  final at = DateTime.tryParse(m.group(2)!)?.toLocal();
  return 'Stopped by ${m.group(1)} · ${at == null ? m.group(2) : brainWhen(at)} · “${m.group(3)}”';
}

Tone _partTone(String s) => switch (s) {
  'online' => Tone.ok,
  'stopped' => Tone.crit,
  'unavailable' => Tone.warn,
  _ => Tone.off,
};

class _Parts extends StatelessWidget {
  const _Parts(this.title, this.parts);
  final String title;
  final List<AiPart> parts;

  @override
  Widget build(BuildContext context) => Gap(
    gap: 8,
    children: [
      SectionTitle(title, size: 16),
      LefiCard(
        child: Gap(
          gap: 12,
          children: [
            for (final p in parts)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(p.name, style: LefiText.body(14, weight: 700)),
                        if (p.detail.isNotEmpty)
                          Text(p.detail, style: LefiText.body(12.5, color: LefiColors.muted, height: 1.4)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  ToneChip(aiPartStateLabel(p.state), tone: _partTone(p.state)),
                ],
              ),
          ],
        ),
      ),
    ],
  );
}

class _Actions extends StatelessWidget {
  const _Actions(this.actions);
  final List<AiAction> actions;

  @override
  Widget build(BuildContext context) => Gap(
    gap: 8,
    children: [
      const SectionTitle('What Lefi AI may do', size: 16),
      LefiCard(
        child: Gap(
          gap: 12,
          children: [
            for (final a in actions)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    a.allowed ? Symbols.check_circle_rounded : Symbols.block_rounded,
                    size: 20,
                    color: a.allowed ? LefiColors.success : LefiColors.faint,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${a.name} · ${a.area}', style: LefiText.body(14, weight: 700)),
                        Text(a.detail, style: LefiText.body(12.5, color: LefiColors.muted, height: 1.4)),
                        if (a.allowed)
                          Text(
                            a.cameras.isEmpty ? 'No camera allowed yet' : 'Allowed: ${a.cameras.join(', ')}',
                            style: LefiText.body(12.5, weight: 600, color: LefiColors.strong),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    ],
  );
}

class _Settings extends StatelessWidget {
  const _Settings(this.v);
  final BrainAiControl v;

  @override
  Widget build(BuildContext context) => Gap(
    gap: 8,
    children: [
      const SectionTitle('Settings', size: 16),
      LefiCard(
        child: Gap(
          gap: 8,
          children: [
            for (final (k, val) in v.settings)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 130,
                    child: Text(k, style: LefiText.body(13, color: LefiColors.muted)),
                  ),
                  Expanded(child: Text(val, style: LefiText.body(13, weight: 600))),
                ],
              ),
            if (v.tools.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text('What Lefi AI may read for you', style: LefiText.body(13, color: LefiColors.muted)),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [for (final t in v.tools) ToneChip(humanize(t), tone: Tone.ai)],
              ),
            ],
            Text(
              'Changed by an administrator on the Lefi Brain PC, not from the phone.',
              style: LefiText.body(12, color: LefiColors.subtle),
            ),
          ],
        ),
      ),
    ],
  );
}
