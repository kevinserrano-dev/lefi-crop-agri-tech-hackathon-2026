import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../core/feedback/feedback.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/dashed_border.dart';
import '../../../core/widgets/overlays.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/rows.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/widgets/selectors.dart';
import '../../auth/application/session.dart';
import '../../brain/data/brain_json.dart';
import '../../greenhouse/presentation/brain_greenhouse_style.dart' show fmtNum, issueLabel, plantHealthTag;
import '../../tasks/domain/brain_task.dart' show taskStatusLabel;
import '../../tasks/presentation/brain_task_sheets.dart';
import '../application/brain_handover.dart';
import '../domain/brain_handover.dart';

/// Shift handover on Lefi Brain (ADR-095, 101): the outgoing shift's facts, Lefi AI's summary to
/// review, sign (outgoing lead) and acknowledge (incoming team), and the latest handovers.
class BrainHandoverScreen extends ConsumerStatefulWidget {
  const BrainHandoverScreen({super.key});

  @override
  ConsumerState<BrainHandoverScreen> createState() => _BrainHandoverScreenState();
}

class _BrainHandoverScreenState extends ConsumerState<BrainHandoverScreen> {
  bool _read = false;

  void _refresh() {
    ref.invalidate(brainHandoverCurrentProvider);
    ref.invalidate(brainHandoverHistoryProvider);
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(brainHandoverCurrentProvider);
    final repo = ref.watch(brainHandoverRepositoryProvider)!;
    final me = ref.watch(currentUserProvider).name;
    final v = async.value;
    final h = v?.handover;
    final toast = ref.read(toastProvider.notifier);

    Future<void> sign() async {
      final note = await showNoteSheet(
        context,
        title: 'Sign the handover',
        body:
            'The facts of ${h!.shift} are frozen as they are now and the incoming team is told. '
            'Read Lefi AI’s summary first: it is a draft, the facts above it are Lefi Brain’s.',
        hint: 'Anything the next shift must know (optional)',
        confirmLabel: 'Sign handover',
      );
      if (note == null) return;
      if (await runBrain(
        ref,
        'Signing…',
        () => repo.sign(h.id, note),
        done: 'Handover signed. The incoming team is told.',
      )) {
        _refresh();
      }
    }

    Future<void> acknowledge() async {
      if (!_read) return toast.show('Confirm you have read the handover first.', bad: true);
      final note = await showNoteSheet(
        context,
        title: 'Acknowledge the handover',
        body: 'You confirm your shift has received ${h!.shift}’s handover.',
        hint: 'Note (optional)',
        confirmLabel: 'Acknowledge',
      );
      if (note == null) return;
      if (await runBrain(ref, 'Acknowledging…', () => repo.acknowledge(h.id, note), done: 'Handover acknowledged.')) {
        _refresh();
      }
    }

    Widget? bottom;
    if (v != null && h != null) {
      final signedByMe = h.signedBy != null && h.signedBy == me && repo.roleId != 'admin';
      bottom = StickyActionBar(
        children: switch (h.status) {
          'open' when v.canSign => [
            LefiButton(label: 'Sign handover', icon: Symbols.signature_rounded, onPressed: sign),
          ],
          'open' => [
            const DoneBanner(label: 'Waiting for the outgoing lead to sign', icon: Symbols.hourglass_top_rounded),
          ],
          'signed' when v.canAcknowledge && !signedByMe => [
            InkWell(
              onTap: () => setState(() => _read = !_read),
              child: SizedBox(
                height: 44,
                child: Row(
                  children: [
                    CheckSquare(checked: _read),
                    const SizedBox(width: 12),
                    Text('I have read this handover', style: LefiText.body(14, weight: 600)),
                  ],
                ),
              ),
            ),
            LefiButton(label: 'Acknowledge', opacity: _read ? 1 : .45, onPressed: acknowledge),
          ],
          'signed' => [
            DoneBanner(
              label: signedByMe
                  ? 'Signed by you · the incoming team acknowledges'
                  : 'Signed · waiting for the incoming team',
              icon: Symbols.hourglass_top_rounded,
            ),
          ],
          _ => [
            DoneBanner(
              label: 'Acknowledged by ${h.acknowledgedBy ?? 'the incoming team'} · ${brainWhen(h.acknowledgedAt)}',
              icon: Symbols.verified_rounded,
            ),
          ],
        },
      );
    }

    return PushedScreen(
      title: 'Shift handover',
      backLabel: 'Back',
      bottom: bottom,
      body: AsyncView(
        async,
        data: (v) => RefreshIndicator(
          color: LefiColors.brandDark,
          onRefresh: () {
            ref.invalidate(brainHandoverHistoryProvider);
            return ref.refresh(brainHandoverCurrentProvider.future);
          },
          child: ScrollBody(
            children: [
              if (v.state == 'no_shifts' || v.handover == null) ...[
                Center(child: Image.asset('assets/brand/mascot-calm.png', width: 120)),
                InfoNote(text: v.reason ?? 'There is no handover to show yet.', icon: Symbols.event_busy_rounded),
              ] else ...[
                _Header(v),
                HandoverBody(
                  handover: v.handover!,
                  canRewrite: v.canSign && v.handover!.status == 'open',
                  onRewrite: () async {
                    if (await runBrain(
                      ref,
                      'Asking Lefi AI…',
                      () => repo.rewriteSummary(v.handover!.id),
                      done: 'Lefi AI is writing the summary again.',
                    )) {
                      _refresh();
                    }
                  },
                ),
              ],
              const _History(),
            ],
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header(this.v);
  final HandoverView v;

  @override
  Widget build(BuildContext context) {
    final h = v.handover!;
    final tone = switch (h.status) {
      'acknowledged' => Tone.ok,
      'signed' => Tone.info,
      _ => Tone.warn,
    };
    Widget slot(String label, ShiftSlot? s) => Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: LefiText.overline(color: LefiColors.subtle)),
          const SizedBox(height: 2),
          Text(s?.name ?? 'No shift', style: LefiText.body(15, weight: 800)),
          if (s != null)
            Text('${brainHm(s.start)}–${brainHm(s.end)}', style: LefiText.body(12, color: LefiColors.subtle)),
          const SizedBox(height: 6),
          if (s == null || s.people.isEmpty)
            Text('Nobody on the roster', style: LefiText.body(12.5, color: LefiColors.faint))
          else
            for (final p in s.people)
              Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Text(
                  '${p.name}${p.lead ? ' · lead' : ''}',
                  style: LefiText.body(12.5, weight: p.lead ? 700 : 500, color: LefiColors.secondary),
                ),
              ),
        ],
      ),
    );
    return Gap(
      gap: 12,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(h.shift, style: LefiText.outfit(24)),
            const SizedBox(height: 4),
            Text(
              '${brainDate(h.day)} · ${brainHm(h.start)}–${brainHm(h.end)} · facts from ${brainHm(h.refreshedAt)}',
              style: LefiText.body(13, color: LefiColors.subtle),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                ToneChip(handoverStatusLabel(h.status), tone: tone, fontSize: 11.5),
                if (h.simulated) const SimulationBadge(fontSize: 10.5),
              ],
            ),
          ],
        ),
        LefiCard(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              slot('OUTGOING', v.outgoing),
              const Padding(
                padding: EdgeInsets.only(top: 18, left: 6, right: 6),
                child: Icon(Symbols.arrow_forward_rounded, color: LefiColors.leaf),
              ),
              slot('INCOMING', v.incoming),
            ],
          ),
        ),
      ],
    );
  }
}

/// The facts and Lefi AI's summary of one handover (current or past).
class HandoverBody extends StatelessWidget {
  const HandoverBody({super.key, required this.handover, this.canRewrite = false, this.onRewrite});
  final BrainHandover handover;
  final bool canRewrite;
  final VoidCallback? onRewrite;

  @override
  Widget build(BuildContext context) {
    final h = handover;
    Tone sev(String s) => switch (s) {
      'critical' => Tone.crit,
      'warning' => Tone.warn,
      _ => Tone.info,
    };
    Widget incidents(String title, List<HandoverIncident> list) => _Section(
      title: title,
      count: list.length,
      empty: 'None.',
      children: [
        for (final i in list)
          _Line(
            icon: Symbols.crisis_alert_rounded,
            tone: sev(i.severity),
            title: [?i.number, i.title].join(' · '),
            sub: [humanize(i.status), if (i.source == 'ai') 'Lefi AI · to confirm', ?i.resolution].join(' · '),
          ),
      ],
    );
    return Gap(
      gap: 14,
      children: [
        _SummaryCard(summary: h.summary, canRewrite: canRewrite, onRewrite: onRewrite),
        incidents('Alerts opened in the shift', h.incidentsOpened),
        incidents('Alerts resolved', h.incidentsResolved),
        incidents('Alerts still active', h.incidentsActive),
        _Section(
          title: 'Tasks done',
          count: h.tasksDone.length,
          empty: 'No task was finished in this shift.',
          children: [
            for (final t in h.tasksDone)
              _Line(
                icon: Symbols.task_alt_rounded,
                tone: Tone.ok,
                title: [?t.number, t.title].join(' · '),
                sub: [taskStatusLabel(t.status), ?t.notes].join(' · '),
              ),
          ],
        ),
        _Section(
          title: 'Tasks left for the next shift',
          count: h.outstandingCount,
          empty: 'Nothing left to do.',
          children: [
            for (final t in h.outstanding)
              _Line(
                icon: Symbols.pending_actions_rounded,
                tone: t.priority == 'urgent' ? Tone.crit : (t.priority == 'high' ? Tone.warn : Tone.info),
                title: [?t.number, t.title].join(' · '),
                sub: [
                  taskStatusLabel(t.status),
                  if (t.priority != null) humanize(t.priority!),
                  if (t.waitingForAPerson) 'nobody can take it yet',
                ].join(' · '),
              ),
            if (h.outstandingCount > h.outstanding.length)
              Text(
                '…and ${h.outstandingCount - h.outstanding.length} more',
                style: LefiText.body(12.5, color: LefiColors.subtle),
              ),
          ],
        ),
        _Section(
          title: 'Plant health recorded by people',
          count: h.healthRecords,
          empty: 'No observation was recorded in this shift.',
          children: [
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final e in h.healthByState.entries)
                  ToneChip('${plantHealthTag(e.key).$1} · ${e.value}', tone: plantHealthTag(e.key).$2, fontSize: 12),
                for (final e in h.healthIssues.entries) ToneChip('${issueLabel(e.key)} · ${e.value}', fontSize: 12),
              ],
            ),
          ],
        ),
        _Section(
          title: 'Environment in the shift',
          count: h.environment.length,
          empty: 'No readings were stored in this shift.',
          children: [
            for (final r in h.environment)
              _Line(
                icon: Symbols.sensors_rounded,
                tone: r.state == 'in range'
                    ? Tone.ok
                    : (r.state.startsWith('above') || r.state.startsWith('below') ? Tone.crit : Tone.neutral),
                title: '${r.zone} · ${r.measurement}',
                sub: [
                  'now ${fmtNum(r.last)}${r.unit == null ? '' : ' ${r.unit}'}',
                  '${fmtNum(r.min)}–${fmtNum(r.max)}',
                  r.state,
                  if (r.origin == 'SIMULATED') 'SIMULATED',
                ].join(' · '),
              ),
          ],
        ),
        if (h.robotMissions.isNotEmpty)
          InfoNote(text: 'Robot missions: ${h.robotMissions}', icon: Symbols.smart_toy_rounded),
        if (h.signedBy != null || h.acknowledgedBy != null)
          LefiCard(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
            child: Column(
              children: [
                if (h.signedBy != null) KeyValueRow('Signed by', '${h.signedBy} · ${brainWhen(h.signedAt)}'),
                if (h.signNote != null) KeyValueRow('Their note', h.signNote!),
                if (h.acknowledgedBy != null)
                  KeyValueRow('Acknowledged by', '${h.acknowledgedBy} · ${brainWhen(h.acknowledgedAt)}'),
                if (h.ackNote != null) KeyValueRow('Their note', h.ackNote!, last: true),
              ],
            ),
          ),
      ],
    );
  }
}

/// Lefi AI's words, always violet and labelled with the model; a draft people review (ADR-095).
class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.summary, required this.canRewrite, this.onRewrite});
  final HandoverSummary summary;
  final bool canRewrite;
  final VoidCallback? onRewrite;

  @override
  Widget build(BuildContext context) {
    final s = summary;
    final ai = Tone.ai;
    Widget list(String title, List<String> items) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: LefiText.body(13, weight: 800, color: ai.fg)),
        const SizedBox(height: 3),
        for (final i in items)
          Padding(
            padding: const EdgeInsets.only(bottom: 3),
            child: Text('• $i', style: LefiText.body(13.5, color: LefiColors.body, height: 1.4)),
          ),
      ],
    );
    final card = Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: LefiColors.aiWash, borderRadius: BorderRadius.circular(16)),
      child: Gap(
        gap: 8,
        children: [
          Row(
            children: [
              ToneChip('Lefi AI · summary', tone: ai, icon: Symbols.psychiatry_rounded, fontSize: 11.5),
              const Spacer(),
              if (s.model != null) Text(s.model!, style: LefiText.mono(10.5, color: ai.fg)),
            ],
          ),
          ...switch (s.status) {
            'done' => [
              if (s.happened != null) Text(s.happened!, style: LefiText.body(14, color: LefiColors.body, height: 1.45)),
              if (s.why != null) Text(s.why!, style: LefiText.body(13.5, color: LefiColors.secondary, height: 1.45)),
              if (s.done.isNotEmpty) list('Done', s.done),
              if (s.attention.isNotEmpty) list('Needs attention', s.attention),
              Text(
                'A draft from the facts below — check it before relying on it.',
                style: LefiText.body(11.5, color: ai.fg),
              ),
            ],
            'pending' => [
              Text('Lefi AI is writing the summary…', style: LefiText.body(13.5, color: LefiColors.secondary)),
            ],
            'invalid' => [
              Text(
                'Lefi AI’s answer did not fit the expected shape, so it is not shown. The facts below are complete.',
                style: LefiText.body(13.5, color: LefiColors.secondary),
              ),
            ],
            _ => [
              Text(
                'No summary: ${s.error ?? 'Lefi AI is not available'}. The facts below are complete.',
                style: LefiText.body(13.5, color: LefiColors.secondary),
              ),
            ],
          },
          if (canRewrite)
            Align(
              alignment: Alignment.centerLeft,
              child: LefiTextButton('Ask Lefi AI again', color: ai.fg, onPressed: onRewrite!),
            ),
        ],
      ),
    );
    return DashedBorder(color: LefiColors.aiDash, radius: 16, child: card);
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.count, required this.empty, required this.children});
  final String title;
  final int count;
  final String empty;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => LefiCard(
    child: Gap(
      gap: 8,
      children: [
        Row(
          children: [
            Expanded(child: Text(title, style: LefiText.outfit(16))),
            Text('$count', style: LefiText.body(13, weight: 700, color: LefiColors.subtle)),
          ],
        ),
        if (count == 0) Text(empty, style: LefiText.body(13, color: LefiColors.faint)) else ...children,
      ],
    ),
  );
}

class _Line extends StatelessWidget {
  const _Line({required this.icon, required this.tone, required this.title, required this.sub});
  final IconData icon;
  final Tone tone;
  final String title;
  final String sub;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(
        padding: const EdgeInsets.only(top: 1),
        child: Icon(icon, size: 18, color: tone.fg),
      ),
      const SizedBox(width: 8),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: LefiText.body(13.5, weight: 700)),
            if (sub.isNotEmpty) Text(sub, style: LefiText.body(12, color: LefiColors.subtle, height: 1.35)),
          ],
        ),
      ),
    ],
  );
}

class _History extends ConsumerWidget {
  const _History();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(brainHandoverHistoryProvider);
    final list = async.value ?? const <BrainHandover>[];
    if (list.isEmpty) return const SizedBox.shrink();
    return Gap(
      gap: 8,
      children: [
        const SectionTitle('Latest handovers'),
        CardList(
          children: [
            for (final h in list)
              NavRow(
                icon: Symbols.sync_alt_rounded,
                tone: switch (h.status) {
                  'acknowledged' => Tone.ok,
                  'signed' => Tone.info,
                  _ => Tone.warn,
                },
                title: '${h.shift} · ${brainDate(h.day)}',
                subtitle: [
                  handoverStatusLabel(h.status),
                  if (h.signedBy != null) 'signed by ${h.signedBy}',
                ].join(' · '),
                onTap: () => showLefiSheet<void>(
                  context,
                  builder: (_) => Gap(
                    gap: 12,
                    children: [
                      Text('${h.shift} · ${brainDate(h.day)}', style: LefiText.outfit(21)),
                      HandoverBody(handover: h),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}
