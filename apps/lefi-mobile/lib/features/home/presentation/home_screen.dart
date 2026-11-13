import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/navigation/open_target.dart';
import '../../../app/router/routes.dart';
import '../../../core/feedback/feedback.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/glyph_icons.dart';
import '../../../core/widgets/media.dart';
import '../../../core/widgets/overlays.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/rows.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/theme/tone.dart';
import '../../ai_control/application/brain_ai_control.dart';
import '../../ai_control/presentation/ai_widgets.dart';
import '../../ai_control/presentation/brain_ai_control_screen.dart';
import '../../alerts/application/notifications_controller.dart';
import '../../assistant/presentation/ask_lefi_card.dart';
import '../../auth/application/session.dart';
import '../../robot/presentation/brain_robot_card.dart';
import '../application/home_providers.dart';
import '../domain/dashboard.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final unread = ref.watch(notificationsControllerProvider).value?.unread ?? 0;
    final dash = ref.watch(dashboardProvider);
    void open(AppTarget t) => openTarget(context, t);

    return AnnotatedRegion(
      value: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent),
      child: ColoredBox(
        color: LefiColors.screen,
        child: SafeArea(
          bottom: false,
          child: AsyncView(
            dash,
            data: (d) => ListView(
              padding: EdgeInsets.zero,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(18, 8, 18, 14),
                  child: Row(
                    children: [
                      Avatar(initials: user.initials, color: Color(user.colorValue)),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Good morning, ${user.firstName}', style: LefiText.outfit(22)),
                            const SizedBox(height: 1),
                            Text(
                              user.roleName,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: LefiText.body(12.5, color: LefiColors.muted),
                            ),
                          ],
                        ),
                      ),
                      _BellButton(unread: unread > 0, onTap: () => context.go(Routes.alerts)),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
                  child: Gap(
                    gap: 16,
                    children: [
                      if (d.source case final s?) _SourceLine(s, onRefresh: () => ref.invalidate(dashboardProvider)),
                      // On Lefi Brain without `/overview` (worker) there is no AI row: never the demo's.
                      if (d.ai case final ai?) _BrainAiRow(ai) else if (d.source == null) const AiStatusRow(),
                      if (d.source != null) const AskLefiCard(),
                      _Hero(d.hero),
                      if (d.quickActions.isNotEmpty)
                        Row(
                          children: [
                            for (final (i, q) in d.quickActions.indexed) ...[
                              if (i > 0) const SizedBox(width: 10),
                              Expanded(child: _QuickAction(q, onTap: () => open(q.target))),
                            ],
                          ],
                        ),
                      if (d.showReportIssue) _ReportIssueButton(onTap: () => openTarget(context, const ReportTarget())),
                      for (final s in d.sections.where((s) => s.rows.isNotEmpty))
                        Gap(
                          gap: 8,
                          children: [
                            SectionTitle(s.title),
                            CardList(
                              children: [
                                for (final r in s.rows)
                                  NavRow(
                                    icon: glyphIcon(r.glyph),
                                    tone: severityTone(r.severity),
                                    title: r.title,
                                    subtitle: r.sub,
                                    chip: r.chip,
                                    chipTone: severityTone(r.chipSeverity),
                                    onTap: () => open(r.target),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      if (d.instructions.isNotEmpty) _Instructions(d.instructions),
                      if (d.kpis.isNotEmpty) _Kpis(d.kpis),
                      if (d.showRobotCard) const _RobotCard() else if (d.source != null) const BrainRobotCard(),
                      if (d.unavailable.isNotEmpty) _NotAvailable(d.unavailable),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _BellButton extends StatelessWidget {
  const _BellButton({required this.unread, required this.onTap});
  final bool unread;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    shape: const CircleBorder(side: BorderSide(color: LefiColors.chipBorder)),
    child: InkWell(
      customBorder: const CircleBorder(),
      onTap: onTap,
      child: SizedBox(
        width: 46,
        height: 46,
        child: Stack(
          alignment: Alignment.center,
          children: [
            const Icon(Symbols.notifications_rounded, size: 24, color: LefiColors.strong, semanticLabel: 'Alerts'),
            if (unread)
              Positioned(
                top: 9,
                right: 10,
                child: Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    color: LefiColors.danger,
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 2),
                  ),
                ),
              ),
          ],
        ),
      ),
    ),
  );
}

/// Provenance of the whole summary: LIVE from Lefi Brain, at Lefi Brain's time (ADR-012).
class _SourceLine extends StatelessWidget {
  const _SourceLine(this.s, {required this.onRefresh});
  final DashboardSource s;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      ToneChip(
        'LIVE',
        fontSize: 10,
        background: severityTone(Severity.ok).bg,
        foreground: severityTone(Severity.ok).fg,
        radius: 5,
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      ),
      const SizedBox(width: 8),
      Expanded(
        child: Text('From ${s.label} · ${s.at}', style: LefiText.body(12.5, color: LefiColors.muted)),
      ),
      IconButton(
        onPressed: onRefresh,
        visualDensity: VisualDensity.compact,
        icon: const Icon(Symbols.refresh_rounded, size: 20, color: LefiColors.muted, semanticLabel: 'Refresh'),
      ),
    ],
  );
}

/// Lefi AI as Lefi Brain reports it; never the demo AI controls. Tap = AI control & safety (roles
/// with `nav.aiControl`); "Stop AI" for roles with `ai.halt` while it runs (ADR-085, 102).
class _BrainAiRow extends ConsumerWidget {
  const _BrainAiRow(this.ai);
  final DashboardAi ai;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final repo = ref.watch(brainAiControlRepositoryProvider);
    final canStop = repo != null && repo.brain.can('ai.halt') && !ai.stopped;
    final t = ai.stopped ? Tone.crit : severityTone(ai.available ? Severity.ok : Severity.warn);
    final title = ai.stopped
        ? 'Lefi AI · stopped'
        : ai.available
        ? 'Lefi AI · available'
        : 'Lefi AI · ${ai.state.replaceAll('_', ' ')}';
    return Container(
      constraints: const BoxConstraints(minHeight: 60),
      padding: const EdgeInsets.fromLTRB(14, 8, 8, 8),
      decoration: BoxDecoration(
        color: ai.available ? Colors.white : t.bg,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: ai.available ? LefiColors.border : t.dot),
      ),
      child: Row(
        children: [
          Expanded(
            child: InkWell(
              onTap: repo == null ? null : () => context.pushAiControl(),
              child: Row(
                children: [
                  IconTile.tone(
                    ai.stopped ? Symbols.front_hand_rounded : Symbols.smart_toy_rounded,
                    t,
                    size: 36,
                    radius: 11,
                    iconSize: 20,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title, style: LefiText.body(14, weight: 700, color: LefiColors.strong)),
                        const SizedBox(height: 2),
                        Text(
                          [if (ai.model != null) ai.model!, if (ai.reason.isNotEmpty) ai.reason].join(' · '),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: LefiText.body(12.5, color: LefiColors.muted),
                        ),
                      ],
                    ),
                  ),
                  if (repo != null) const Chevron(color: LefiColors.faint),
                ],
              ),
            ),
          ),
          if (canStop) ...[
            const SizedBox(width: 8),
            SizedBox(
              width: 104,
              child: LefiButton(
                label: 'Stop AI',
                icon: Symbols.front_hand_rounded,
                iconSize: 19,
                height: 44,
                radius: 12,
                fontSize: 13.5,
                background: LefiColors.dangerStop,
                onPressed: () => stopBrainAi(context, ref),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _NotAvailable extends StatelessWidget {
  const _NotAvailable(this.items);
  final List<String> items;

  @override
  Widget build(BuildContext context) => Gap(
    gap: 8,
    children: [
      const SectionTitle('Not available yet'),
      LefiCard(
        child: Gap(
          gap: 8,
          children: [for (final it in items) Text(it, style: LefiText.body(13, color: LefiColors.muted, height: 1.45))],
        ),
      ),
    ],
  );
}

class _Hero extends StatelessWidget {
  const _Hero(this.h);
  final DashboardHero h;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(color: LefiColors.brandDark, borderRadius: BorderRadius.circular(22)),
    child: Gap(
      children: [
        Overline(h.label, color: LefiColors.mint),
        Wrap(
          crossAxisAlignment: WrapCrossAlignment.end,
          spacing: 8,
          children: [
            Text(h.value, style: LefiText.outfit(40, color: Colors.white, height: 1)),
            if (h.unit.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Text(h.unit, style: LefiText.body(15, color: LefiColors.mintSoft)),
              ),
          ],
        ),
        Text(h.sub, style: LefiText.body(13.5, color: LefiColors.mintPale, height: 1.45)),
        LefiProgress(value: h.progress, track: LefiColors.heroTrack),
        if (h.chips.isNotEmpty)
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final c in h.chips)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(color: const Color(0x1FFFFFFF), borderRadius: BorderRadius.circular(8)),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 7,
                        height: 7,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: c.severity == Severity.crit ? const Color(0xFFE25C4F) : severityTone(c.severity).dot,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(c.label, style: LefiText.body(12, weight: 700, color: Colors.white)),
                    ],
                  ),
                ),
            ],
          ),
      ],
    ),
  );
}

class _QuickAction extends StatelessWidget {
  const _QuickAction(this.q, {required this.onTap});
  final QuickAction q;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => LefiCard(
    onTap: onTap,
    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
    child: ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 68),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconTile(glyphIcon(q.glyph), size: 38, iconSize: 22),
          const SizedBox(height: 7),
          Text(
            q.label,
            textAlign: TextAlign.center,
            style: LefiText.body(12.5, weight: 700, color: LefiColors.body),
          ),
        ],
      ),
    ),
  );
}

class _ReportIssueButton extends StatelessWidget {
  const _ReportIssueButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: LefiColors.brand,
    borderRadius: BorderRadius.circular(20),
    child: InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 76),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            const IconTile(
              Symbols.report_rounded,
              size: 48,
              radius: 14,
              iconSize: 26,
              background: LefiColors.brandDark,
              foreground: Colors.white,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Report an issue', style: LefiText.outfit(17, weight: 700, color: LefiColors.brandDeep)),
                  const SizedBox(height: 2),
                  Text(
                    'Leaks, damaged plants, pests, safety',
                    style: LefiText.body(13, color: const Color(0xFF14402F)),
                  ),
                ],
              ),
            ),
            const Icon(Symbols.chevron_right_rounded, size: 24, color: LefiColors.brandDeep),
          ],
        ),
      ),
    ),
  );
}

class _Instructions extends StatelessWidget {
  const _Instructions(this.items);
  final List<Instruction> items;

  @override
  Widget build(BuildContext context) => Gap(
    gap: 8,
    children: [
      const SectionTitle('Today’s work instructions'),
      LefiCard(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        child: Column(
          children: [
            for (final (i, it) in items.indexed)
              Container(
                padding: const EdgeInsets.symmetric(vertical: 11),
                decoration: BoxDecoration(
                  border: i == items.length - 1 ? null : const Border(bottom: BorderSide(color: LefiColors.divider)),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    IconTile.tone(glyphIcon(it.glyph), severityTone(it.severity), size: 32, radius: 10, iconSize: 19),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.only(top: 5),
                        child: Text(it.text, style: LefiText.body(14, color: LefiColors.body, height: 1.45)),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    ],
  );
}

class _Kpis extends StatelessWidget {
  const _Kpis(this.kpis);
  final List<Kpi> kpis;

  @override
  Widget build(BuildContext context) => Gap(
    gap: 8,
    children: [
      const SectionTitle('Operational KPIs'),
      GridView.count(
        crossAxisCount: 2,
        shrinkWrap: true,
        padding: EdgeInsets.zero,
        physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 10,
        crossAxisSpacing: 10,
        childAspectRatio: 174 / 92,
        children: [
          for (final k in kpis)
            LefiCard(
              radius: 16,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(k.value, style: LefiText.outfit(22)),
                  const SizedBox(height: 2),
                  Text(k.label, style: LefiText.body(13, weight: 700, color: LefiColors.strong)),
                  const SizedBox(height: 2),
                  Text(k.sub, style: LefiText.body(11.5, color: LefiColors.subtle)),
                ],
              ),
            ),
        ],
      ),
    ],
  );
}

class _RobotCard extends ConsumerWidget {
  const _RobotCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) => LefiCard(
    child: Gap(
      gap: 12,
      children: [
        Row(
          children: [
            Image.asset('assets/brand/mascot-working.png', width: 54),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text('LEFI-R1', style: LefiText.outfit(16)),
                      const SizedBox(width: 6),
                      const SimulationBadge(fontSize: 10),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    'Docked · charging · no active mission',
                    style: LefiText.body(12.5, color: LefiColors.muted, height: 1.4),
                  ),
                ],
              ),
            ),
          ],
        ),
        LefiButton(
          label: 'Open robot mission',
          icon: Symbols.smart_toy_rounded,
          iconSize: 18,
          height: 44,
          radius: 12,
          fontSize: 13.5,
          fontWeight: 700,
          onPressed: () => showRobotPhotosSheet(context),
        ),
      ],
    ),
  );
}

/// Last mission photos (all simulated).
Future<void> showRobotPhotosSheet(BuildContext context) => showLefiSheet<void>(
  context,
  builder: (ctx) => Gap(
    gap: 14,
    children: [
      Row(
        children: [
          Text('Mission M-1043 · photos', style: LefiText.outfit(20)),
          const SizedBox(width: 8),
          const SimulationBadge(fontSize: 10),
        ],
      ),
      Text(
        'Photos come from the robot simulator, not a physical camera. Wilting confirmed on 14 of 16 plants around B-03; valve V-B3 suspected.',
        style: LefiText.body(13.5, color: LefiColors.muted, height: 1.5),
      ),
      GridView.count(
        crossAxisCount: 3,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        padding: EdgeInsets.zero,
        children: [
          for (final l in const [
            'IMG-4800 · B-03 north',
            'IMG-4801 · B-03 canopy',
            'IMG-4802 · B-03 root zone',
            'IMG-4803 · B-02',
            'IMG-4804 · B-04',
            'IMG-4805 · drip line B-3',
          ])
            StripedPlaceholder.dark(
              child: Align(
                alignment: Alignment.bottomLeft,
                child: Padding(
                  padding: const EdgeInsets.all(6),
                  child: Text(l, style: LefiText.mono(9, color: LefiColors.mintSoft, height: 1.25)),
                ),
              ),
            ),
        ],
      ),
      LefiButton(
        label: 'Open robot mission',
        icon: Symbols.smart_toy_rounded,
        iconSize: 18,
        height: 48,
        fontSize: 14,
        fontWeight: 700,
        background: LefiColors.simulation,
        onPressed: () {
          Navigator.pop(ctx);
          ProviderScope.containerOf(context, listen: false)
              .read(toastProvider.notifier)
              .show('Robot mission tracking is designed and arrives in the next iteration of the app.');
        },
      ),
    ],
  ),
);
