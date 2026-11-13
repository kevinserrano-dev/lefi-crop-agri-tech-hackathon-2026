import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../core/feedback/feedback.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/overlays.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/rows.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/widgets/selectors.dart';
import '../application/brain_alerts.dart';
import '../domain/brain_alert.dart';

String _two(int v) => v.toString().padLeft(2, '0');

/// "14:05" today, "3/11 14:05" otherwise.
String alertTime(DateTime? t, {DateTime? now}) {
  if (t == null) return '—';
  final n = now ?? DateTime.now();
  final hm = '${_two(t.hour)}:${_two(t.minute)}';
  return t.year == n.year && t.month == n.month && t.day == n.day ? hm : '${t.day}/${t.month} $hm';
}

Tone severityToneOf(String s) => switch (s) {
  'critical' => Tone.crit,
  'warning' => Tone.warn,
  _ => Tone.info,
};

String statusLabel(String s) => switch (s) {
  'open' => 'Open',
  'acknowledged' => 'Acknowledged',
  'resolved' => 'Resolved',
  _ => s,
};

Tone statusTone(String s) => switch (s) {
  'open' => Tone.crit,
  'acknowledged' => Tone.warn,
  'resolved' => Tone.ok,
  _ => Tone.neutral,
};

/// Tags under an alert: where it comes from (rules engine, a person, or Lefi AI seeing it in a
/// photo — to be confirmed, ADR-088) and its provenance.
List<(String, Tone)> alertTags(BrainAlert a) => [
  (statusLabel(a.status), statusTone(a.status)),
  switch (a.source) {
    'person' => ('Reported by a person', Tone.neutral),
    'ai' => ('Lefi AI · to confirm', Tone.ai),
    _ => ('Rule', Tone.neutral),
  },
  if (a.simulated) ('Simulation', Tone.ai),
  if (a.occurrences > 1) ('×${a.occurrences}', Tone.neutral),
];

/// The Alerts tab's list of Lefi Brain alerts (ADR-071).
class BrainAlertsView extends ConsumerStatefulWidget {
  const BrainAlertsView({super.key});

  @override
  ConsumerState<BrainAlertsView> createState() => _BrainAlertsViewState();
}

class _BrainAlertsViewState extends ConsumerState<BrainAlertsView> {
  String _status = 'active';

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(brainAlertsProvider(_status));
    return Gap(
      gap: 12,
      children: [
        FilterPills<String>(
          items: const ['active', 'resolved', 'all'],
          selected: _status,
          labelOf: (s) => switch (s) {
            'active' => 'Active${async.value == null ? '' : ' · ${async.value!.active}'}',
            'resolved' => 'Resolved',
            _ => 'All',
          },
          onSelected: (s) => setState(() => _status = s),
          horizontalPadding: 13,
        ),
        AsyncView(
          async,
          data: (l) => Gap(
            gap: 12,
            children: [
              _Summary(l),
              if (l.alerts.isNotEmpty)
                CardList(children: [for (final a in l.alerts) _AlertRow(a, list: l)])
              else
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 30, horizontal: 12),
                  child: Column(
                    children: [
                      Image.asset('assets/brand/mascot-calm.png', width: 110),
                      const SizedBox(height: 8),
                      Text(_status == 'active' ? 'No active alerts' : 'Nothing here', style: LefiText.outfit(18)),
                      const SizedBox(height: 6),
                      Text(
                        'Lefi Brain\'s rules engine: ${l.monitorReason}',
                        textAlign: TextAlign.center,
                        style: LefiText.body(13.5, color: LefiColors.subtle),
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
}

class _Summary extends StatelessWidget {
  const _Summary(this.l);
  final BrainAlertList l;

  @override
  Widget build(BuildContext context) => LefiCard(
    child: Row(
      children: [
        ToneChip('LIVE', tone: Tone.ok, fontSize: 10, radius: 5),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            '${l.active} active · ${l.critical} critical · ${l.warning} warning · ${l.unacknowledged} not acknowledged',
            style: LefiText.body(12.5, color: LefiColors.muted, height: 1.4),
          ),
        ),
      ],
    ),
  );
}

class _AlertRow extends StatelessWidget {
  const _AlertRow(this.a, {required this.list});
  final BrainAlert a;
  final BrainAlertList list;

  @override
  Widget build(BuildContext context) => Material(
    color: a.isOpen ? const Color(0xFFFFF8F7) : Colors.white,
    child: InkWell(
      onTap: () => showBrainAlertSheet(context, a.id, canAcknowledge: list.canAcknowledge, canResolve: list.canResolve),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: LefiColors.divider)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            IconTile.tone(
              a.severity == 'critical' ? Symbols.error_rounded : Symbols.warning_rounded,
              severityToneOf(a.severity),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          a.title,
                          style: LefiText.body(14.5, weight: 700, color: LefiColors.ink, height: 1.3),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(alertTime(a.updatedAt), style: LefiText.body(12, color: LefiColors.subtle)),
                    ],
                  ),
                  if (a.subject.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(a.subject, style: LefiText.body(13, color: LefiColors.secondary, height: 1.4)),
                  ],
                  const SizedBox(height: 5),
                  Wrap(
                    spacing: 5,
                    runSpacing: 5,
                    children: [
                      for (final (l, t) in alertTags(a))
                        ToneChip(
                          l,
                          tone: t,
                          fontSize: 10.5,
                          radius: 6,
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// One alert with its history and the actions Lefi Brain allows this person.
Future<void> showBrainAlertSheet(
  BuildContext context,
  String id, {
  required bool canAcknowledge,
  required bool canResolve,
}) => showLefiSheet<void>(
  context,
  builder: (_) => _AlertSheet(id, canAcknowledge: canAcknowledge, canResolve: canResolve),
);

class _AlertSheet extends ConsumerStatefulWidget {
  const _AlertSheet(this.id, {required this.canAcknowledge, required this.canResolve});
  final String id;
  final bool canAcknowledge;
  final bool canResolve;

  @override
  ConsumerState<_AlertSheet> createState() => _AlertSheetState();
}

class _AlertSheetState extends ConsumerState<_AlertSheet> {
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _act(Future<BrainAlert> Function() action, String done) async {
    setState(() => _busy = true);
    final toast = ref.read(toastProvider.notifier);
    try {
      await action();
      ref.invalidate(brainAlertDetailProvider(widget.id));
      ref.invalidate(brainAlertsProvider);
      toast.show(done);
    } on Exception catch (e) {
      toast.show(e.toString(), bad: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final repo = ref.watch(brainAlertRepositoryProvider);
    final async = ref.watch(brainAlertDetailProvider(widget.id));
    return AsyncView(
      async,
      data: (a) => Gap(
        gap: 12,
        children: [
          Text(a.title, style: LefiText.outfit(20)),
          Wrap(
            spacing: 5,
            runSpacing: 5,
            children: [
              ToneChip(a.severity[0].toUpperCase() + a.severity.substring(1), tone: severityToneOf(a.severity)),
              for (final (l, t) in alertTags(a)) ToneChip(l, tone: t),
            ],
          ),
          if (a.detail.isNotEmpty) Text(a.detail, style: LefiText.body(14, color: LefiColors.body, height: 1.5)),
          LefiCard(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Column(
              children: [
                if (a.subject.isNotEmpty) KeyValueRow('Subject', a.subject),
                KeyValueRow('Opened', alertTime(a.openedAt)),
                KeyValueRow('Updated', alertTime(a.updatedAt)),
                if (a.source == 'rule') KeyValueRow('Condition', a.conditionActive ? 'Still present' : 'Cleared'),
                if (a.reportedBy != null) KeyValueRow('Reported by', a.reportedBy!),
                if (a.acknowledgedBy != null)
                  KeyValueRow('Acknowledged', '${a.acknowledgedBy} · ${alertTime(a.acknowledgedAt)}'),
                if (a.assignedTo != null) KeyValueRow('Assigned to', a.assignedTo!),
                if (a.resolvedBy != null) KeyValueRow('Resolved', '${a.resolvedBy} · ${alertTime(a.resolvedAt)}'),
                if (a.resolution != null) KeyValueRow('Resolution', a.resolution!, last: true),
              ],
            ),
          ),
          if (a.events.isNotEmpty) ...[
            const SectionTitle('History', size: 16),
            LefiCard(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
              child: Column(
                children: [
                  for (final (i, e) in a.events.reversed.indexed)
                    Container(
                      padding: const EdgeInsets.symmetric(vertical: 9),
                      decoration: BoxDecoration(
                        border: i == a.events.length - 1
                            ? null
                            : const Border(bottom: BorderSide(color: LefiColors.divider)),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(
                            width: 74,
                            child: Text(alertTime(e.at), style: LefiText.body(12, color: LefiColors.subtle)),
                          ),
                          Expanded(
                            child: Text(
                              [e.kind.replaceAll('_', ' '), e.by, ?e.note].where((x) => x.isNotEmpty).join(' · '),
                              style: LefiText.body(13, color: LefiColors.body, height: 1.4),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
          if (repo != null && widget.canAcknowledge && a.isOpen)
            LefiButton(
              label: _busy ? 'Working…' : 'Acknowledge',
              icon: Symbols.check_rounded,
              height: 48,
              fontSize: 15,
              onPressed: _busy ? null : () => _act(() => repo.acknowledge(a.id), 'Acknowledged in Lefi Brain.'),
            ),
          if (repo != null && widget.canResolve && !a.isResolved) ...[
            TextField(
              controller: _note,
              maxLength: 500,
              decoration: const InputDecoration(labelText: 'Resolution note (optional)', border: OutlineInputBorder()),
            ),
            LefiOutlineButton(
              label: 'Resolve',
              icon: Symbols.task_alt_rounded,
              onPressed: _busy
                  ? null
                  : () => _act(() => repo.resolve(a.id, note: _note.text), 'Resolved in Lefi Brain.'),
            ),
          ],
        ],
      ),
    );
  }
}
