import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/router/routes.dart';
import '../../../core/feedback/feedback.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/rows.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../alerts/presentation/brain_alerts_view.dart' show severityToneOf;
import '../../brain/data/brain_json.dart';
import '../../tasks/presentation/brain_task_sheets.dart' show brainError;
import '../application/brain_greenhouse.dart';
import '../domain/brain_plant_summary.dart';

/// The plant's summary on its screen (ADR-109): Lefi AI's short draft, active alerts, open tasks,
/// its own sensors, its zone's readings, what happened to it, and what to write on its NFC tag.
/// Parts the role does not see are left out; nothing is invented.
class PlantSummarySections extends ConsumerWidget {
  const PlantSummarySections({super.key, required this.plantId});
  final String plantId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(brainPlantSummaryProvider(plantId));
    final s = async.value;
    if (s == null) {
      return async.hasError
          ? InfoNote(text: 'The plant’s summary could not be read: ${brainError(async.error!)}')
          : const SizedBox(height: 60, child: Center(child: CircularProgressIndicator(strokeWidth: 2)));
    }
    return Gap(
      gap: 14,
      children: [
        if (s.canAskAi) _AiSummaryCard(s.id),
        if (s.activeAlerts case final alerts?) ...[
          SectionTitle('Active alerts', trailing: _count(alerts.length)),
          if (alerts.isEmpty)
            _none('No active alert about this plant, its sensors or its zone.')
          else
            CardList(children: [for (final a in alerts) _AlertRow(a)]),
        ],
        if (s.openTasks case final tasks?) ...[
          SectionTitle('Pending work', trailing: _count(tasks.length)),
          if (tasks.isEmpty)
            _none('No open task for this plant.')
          else
            CardList(children: [for (final t in tasks) _TaskRow(t)]),
        ],
        SectionTitle('Sensors of this plant', trailing: _count(s.sensors.length)),
        if (s.sensors.isEmpty)
          _none('No sensor is assigned to this plant. Its zone’s readings are below.')
        else
          for (final x in s.sensors) _SensorCard(x),
        if (s.zoneReadings case final zone? when zone.isNotEmpty) ...[
          SectionTitle('Its zone now${s.zone == null ? '' : ' · ${s.zone}'}'),
          for (final x in zone) _SensorCard(x),
        ],
        if (s.history.isNotEmpty) ...[const SectionTitle('History'), _History(s.history)],
        _TagCard(s),
      ],
    );
  }

  Widget _count(int n) => Text('$n', style: LefiText.body(13, color: LefiColors.subtle));

  Widget _none(String t) => Text(t, style: LefiText.body(13.5, color: LefiColors.muted, height: 1.4));
}

class _AiSummaryCard extends ConsumerWidget {
  const _AiSummaryCard(this.plantId);
  final String plantId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ai = Tone.ai;
    final s = ref.watch(brainPlantAiSummaryProvider(plantId)).value;
    final pending = s?.pending ?? false;
    Future<void> ask() async {
      final repo = ref.read(brainGreenhouseRepositoryProvider);
      if (repo == null) return;
      try {
        await repo.askPlantAiSummary(plantId);
      } on Object catch (e) {
        ref.read(toastProvider.notifier).show(brainError(e), bad: true);
      }
      ref.invalidate(brainPlantAiSummaryProvider(plantId));
    }

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: ai.bg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: ai.dot.withValues(alpha: .4)),
      ),
      child: Gap(
        gap: 8,
        children: [
          Row(
            children: [
              Icon(Symbols.auto_awesome_rounded, color: ai.fg, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Text('Lefi AI summary', style: LefiText.outfit(16, color: ai.fg)),
              ),
              if (s?.done ?? false) ToneChip('AI draft · check it', tone: Tone.ai, fontSize: 10.5),
            ],
          ),
          if (s != null && s.done) ...[
            Text(s.summary!, style: LefiText.body(14.5, color: LefiColors.body, height: 1.45)),
            for (final p in s.attention)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Icon(Symbols.arrow_right_rounded, color: ai.fg, size: 18),
                  ),
                  Expanded(
                    child: Text(p, style: LefiText.body(13.5, color: LefiColors.strong, height: 1.4)),
                  ),
                ],
              ),
            Text(
              'AI answer${s.model == null ? '' : ' · ${s.model}'} · ${brainWhen(s.at)} · from Lefi Brain’s facts '
              'about this plant',
              style: LefiText.body(11.5, color: LefiColors.subtle),
            ),
          ] else if (pending)
            Row(
              children: [
                SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: ai.fg)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(plantAiStatusLabel(s!), style: LefiText.body(13.5, color: ai.fg)),
                ),
              ],
            )
          else ...[
            if (s != null && plantAiStatusLabel(s).isNotEmpty)
              Text(plantAiStatusLabel(s), style: LefiText.body(13, color: LefiColors.secondary, height: 1.4)),
            Text(
              'Lefi AI reads this plant’s facts in Lefi Brain and writes a short summary. It never changes anything.',
              style: LefiText.body(12.5, color: LefiColors.muted, height: 1.4),
            ),
          ],
          if (!pending)
            LefiOutlineButton(
              label: s?.done ?? false ? 'Ask again' : 'Ask Lefi AI for a summary',
              icon: Symbols.auto_awesome_rounded,
              height: 44,
              borderColor: ai.dot,
              foreground: ai.fg,
              onPressed: ask,
            ),
        ],
      ),
    );
  }
}

class _AlertRow extends StatelessWidget {
  const _AlertRow(this.a);
  final SummaryAlert a;

  @override
  Widget build(BuildContext context) => NavRow(
    icon: a.source == 'ai' ? Symbols.auto_awesome_rounded : Symbols.warning_rounded,
    tone: severityToneOf(a.severity),
    title: a.title,
    subtitle: [
      ?a.number,
      switch (a.scope) {
        'plant' => 'this plant',
        'sensor' => 'its sensor',
        _ => 'its zone',
      },
      switch (a.source) {
        'ai' => 'Lefi AI · to confirm',
        'person' => 'reported by a person',
        _ => 'Lefi Brain rule',
      },
      if (a.origin == 'SIMULATED') 'SIMULATED',
      brainWhen(a.openedAt),
    ].join(' · '),
    chip: humanize(a.status),
    chipTone: a.status == 'open' ? Tone.crit : Tone.neutral,
    onTap: () => context.go(Routes.alerts),
  );
}

class _TaskRow extends StatelessWidget {
  const _TaskRow(this.t);
  final SummaryTask t;

  @override
  Widget build(BuildContext context) => NavRow(
    icon: t.assignee == 'robot' ? Symbols.smart_toy_rounded : Symbols.task_alt_rounded,
    tone: t.priority == 'urgent' || t.priority == 'high' ? Tone.warn : Tone.info,
    title: [?t.number, t.title].join(' · '),
    subtitle: [
      humanize(t.status),
      if (t.assignedTo != null) t.assignedTo! else if (t.forRole != null) 'for ${humanize(t.forRole!)}',
      if (t.dueAt != null) 'due ${brainWhen(t.dueAt)}',
    ].join(' · '),
    chip: humanize(t.priority),
    onTap: t.id.isEmpty ? null : () => context.pushTask(t.id),
  );
}

class _SensorCard extends StatelessWidget {
  const _SensorCard(this.x);
  final SummarySensor x;

  @override
  Widget build(BuildContext context) {
    final receiving = x.state == 'receiving';
    return LefiCard(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      child: Gap(
        gap: 6,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  [x.sensor, x.device].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: LefiText.body(13.5, weight: 700),
                ),
              ),
              if (x.simulated) const SimulationBadge(label: 'SIMULATED', fontSize: 9.5),
              const SizedBox(width: 6),
              ToneChip(receiving ? 'LIVE' : humanize(x.state), tone: receiving ? Tone.ok : Tone.warn, fontSize: 10.5),
            ],
          ),
          Wrap(
            spacing: 14,
            runSpacing: 4,
            children: [
              for (final v in x.values)
                Text(
                  '${v.label} ${v.value == null ? '—' : _num(v.value!)}${v.unit == null || v.value == null ? '' : ' ${v.unit}'}',
                  style: LefiText.body(13, color: LefiColors.strong),
                ),
            ],
          ),
          if (x.place != null) Text(x.place!, style: LefiText.body(11.5, color: LefiColors.faint)),
          if (x.error != null) Text(x.error!, style: LefiText.body(12, color: Tone.crit.fg)),
        ],
      ),
    );
  }

  static String _num(double v) => v.abs() >= 100 ? v.toStringAsFixed(0) : v.toStringAsFixed(1);
}

class _History extends StatelessWidget {
  const _History(this.items);
  final List<SummaryEvent> items;

  @override
  Widget build(BuildContext context) => LefiCard(
    child: Gap(
      gap: 10,
      children: [
        for (final e in items)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                switch (e.kind) {
                  'observation' => Symbols.visibility_rounded,
                  'task' => Symbols.task_alt_rounded,
                  _ => Symbols.notifications_rounded,
                },
                size: 18,
                color: LefiColors.leaf,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(e.text, style: LefiText.body(13.5, weight: 600)),
                    Text([brainWhen(e.at), ?e.by].join(' · '), style: LefiText.body(12, color: LefiColors.muted)),
                  ],
                ),
              ),
            ],
          ),
      ],
    ),
  );
}

/// What to write on the plant's NFC tag (a URL record), with Copy (ADR-109).
class _TagCard extends ConsumerWidget {
  const _TagCard(this.s);
  final PlantSummary s;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final url = plantTagUrl(s.id);
    return LefiCard(
      child: Gap(
        gap: 8,
        children: [
          Row(
            children: [
              const Icon(Symbols.nfc_rounded, color: LefiColors.leaf, size: 20),
              const SizedBox(width: 8),
              Expanded(child: Text('NFC tag', style: LefiText.body(14, weight: 700))),
              IconButton(
                tooltip: 'Copy',
                icon: const Icon(Symbols.content_copy_rounded, size: 20),
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: url));
                  ref.read(toastProvider.notifier).show('Tag address copied.');
                },
              ),
            ],
          ),
          SelectableText(url, style: LefiText.mono(12.5)),
          Text(
            'Write it on this plant’s tag as a URL record. Android opens this plant when the tag is read; on iPhone, '
            'a Shortcuts automation for the tag (“Open URL”) does it. Local only: no internet.',
            style: LefiText.body(12, color: LefiColors.muted, height: 1.4),
          ),
        ],
      ),
    );
  }
}
