import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../core/feedback/feedback.dart';
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
import '../../alerts/application/brain_alerts.dart';
import '../../alerts/presentation/brain_report_sheet.dart';
import '../../brain/data/brain_json.dart';
import '../../tasks/presentation/brain_task_sheets.dart';
import '../application/brain_greenhouse.dart';
import '../domain/brain_greenhouse.dart';
import 'brain_greenhouse_style.dart';
import 'brain_plant_summary_view.dart';

/// One registered plant on Lefi Brain: where it is, its batch, and the observations people
/// recorded (ADR-070, 082). No photo, AI score or height exists for a plant: none is shown.
class BrainPlantScreen extends ConsumerWidget {
  const BrainPlantScreen({super.key, required this.plantId});
  final String plantId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(brainPlantDetailProvider(plantId));
    final d = async.value;
    final repo = ref.watch(brainGreenhouseRepositoryProvider)!;
    final canObserve = d?.health?.canObserve ?? false;
    final canRequest = d?.health?.canRequest ?? false;
    final canReport = ref.watch(brainReporterProvider) != null;

    void refresh() {
      ref.invalidate(brainPlantDetailProvider(plantId));
      ref.invalidate(brainPlantSummaryProvider(plantId));
      if (d != null) ref.invalidate(brainZoneDetailProvider(d.plant.zoneId));
    }

    Widget? bottom;
    if (d != null) {
      final req = d.openRequest;
      bottom = StickyActionBar(
        children: [
          if (canObserve)
            LefiButton(
              label: 'Record observation',
              icon: Symbols.edit_note_rounded,
              onPressed: () async {
                if (await showObservationSheet(context, ref, d)) refresh();
              },
            ),
          if (canRequest && req == null)
            LefiOutlineButton(
              label: 'Request an inspection',
              icon: Symbols.person_search_rounded,
              onPressed: () async {
                final reason = await showNoteSheet(
                  context,
                  title: 'Request an inspection',
                  body: 'A scout or grower is asked to look at ${d.plant.code}. Recording an observation closes it.',
                  hint: 'Why (optional)',
                  confirmLabel: 'Request inspection',
                );
                if (reason == null) return;
                final ok = await runBrain(
                  ref,
                  'Requesting…',
                  () => repo.requestInspection(d.plant.id, reason: reason),
                  done: 'Inspection requested.',
                );
                if (ok) refresh();
              },
            ),
          if (canRequest && req != null)
            LefiOutlineButton(
              label: 'Cancel the inspection request',
              icon: Symbols.cancel_rounded,
              onPressed: () async {
                final ok = await runBrain(
                  ref,
                  'Cancelling…',
                  () => repo.cancelRequest(req.id),
                  done: 'Inspection request cancelled.',
                );
                if (ok) refresh();
              },
            ),
          if (!canObserve && canReport)
            LefiOutlineButton(
              label: 'Report an issue with this plant',
              icon: Symbols.report_rounded,
              onPressed: () => showBrainReportSheet(
                context,
                plantId: d.plant.id,
                zoneId: d.plant.zoneId,
                about: '${d.plant.title} · ${d.zone?.name ?? ''}',
              ),
            ),
        ],
      );
    }

    return PushedScreen(
      title: 'Plant',
      backLabel: 'Back',
      bottom: bottom,
      body: AsyncView(
        async,
        data: (d) => RefreshIndicator(
          color: LefiColors.brandDark,
          onRefresh: () {
            ref.invalidate(brainPlantSummaryProvider(plantId));
            return ref.refresh(brainPlantDetailProvider(plantId).future);
          },
          child: _PlantBody(d),
        ),
      ),
    );
  }
}

class _PlantBody extends StatelessWidget {
  const _PlantBody(this.d);
  final PlantDetail d;

  @override
  Widget build(BuildContext context) {
    final p = d.plant;
    final now = DateTime.now();
    final latest = d.observations.firstOrNull;
    final (hLabel, hTone) = plantHealthTag(latest?.health);
    final req = d.openRequest;
    final planted = p.plantedOn == null ? null : DateTime.tryParse(p.plantedOn!);
    return ScrollBody(
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(p.code, style: LefiText.mono(26, weight: 600)),
                  if (p.name != null) Text(p.name!, style: LefiText.body(15, weight: 700)),
                  const SizedBox(height: 2),
                  Text(
                    [d.crop?.label ?? 'Crop', ?d.zone?.name].join(' · '),
                    style: LefiText.body(14, color: LefiColors.muted),
                  ),
                ],
              ),
            ),
            if (d.health != null)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(color: hTone.bg, borderRadius: BorderRadius.circular(12)),
                child: Column(
                  children: [
                    Text(hLabel, style: LefiText.outfit(16, color: hTone.fg)),
                    Text('BY PEOPLE', style: LefiText.body(9.5, weight: 800, color: hTone.fg)),
                  ],
                ),
              ),
          ],
        ),
        if (p.status != 'active') InfoNote(text: 'This plant is ${p.status}.'),
        if (req != null)
          InfoNote(
            text:
                'Inspection requested by ${req.requestedBy} · ${brainWhen(req.requestedAt, now: now)}${req.reason == null ? '' : ' — ${req.reason}'}',
            icon: Symbols.person_search_rounded,
            background: Tone.info.bg,
            foreground: Tone.info.fg,
          ),
        LefiCard(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
          child: Column(
            children: [
              KeyValueRow('Zone', d.zone?.title ?? '—'),
              KeyValueRow('Location', d.location?.label ?? 'Not set'),
              KeyValueRow(
                'Planted',
                planted == null
                    ? 'Not recorded'
                    : '${brainDate(p.plantedOn)} · ${DateTime(now.year, now.month, now.day).difference(planted).inDays} days',
              ),
              KeyValueRow(
                'Crop batch',
                d.batch == null
                    ? 'None'
                    : [
                        ?d.batch!.batchCode,
                        if (d.batch!.growthStage != null) humanize(d.batch!.growthStage!),
                      ].join(' · ').ifEmptyOr('Active batch'),
              ),
              KeyValueRow('NFC tag', p.nfcUid ?? 'Not linked', last: p.notes == null),
              if (p.notes != null) KeyValueRow('Notes', p.notes!, last: true),
            ],
          ),
        ),
        if (d.crop?.isPlaceholder ?? false)
          InfoNote(
            text: '${d.crop!.name} is a placeholder crop: its ranges are not from an agronomist yet.',
            icon: Symbols.warning_rounded,
            background: Tone.warn.bg,
            foreground: LefiColors.amberDeep,
          ),
        if (d.health != null && d.health!.visionReason.isNotEmpty)
          InfoNote(
            text: 'AI vision: ${d.health!.visionReason}',
            icon: Symbols.psychiatry_rounded,
            background: Tone.ai.bg,
            foreground: Tone.ai.fg,
          ),
        PlantSummarySections(plantId: p.id),
        SectionTitle(
          'Observations',
          trailing: Text('${d.observations.length}', style: LefiText.body(13, color: LefiColors.subtle)),
        ),
        if (d.health == null)
          const InfoNote(text: 'Plant observations are shared with growers, scouts, supervisors and managers.')
        else if (d.observations.isEmpty)
          Text(
            'No one has recorded an observation of this plant yet.',
            style: LefiText.body(13.5, color: LefiColors.muted),
          )
        else
          for (final o in d.observations) _ObservationCard(o, now: now),
      ],
    );
  }
}

class _ObservationCard extends StatelessWidget {
  const _ObservationCard(this.o, {required this.now});
  final PlantObservation o;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final (label, tone) = plantHealthTag(o.health);
    return LefiCard(
      child: Gap(
        gap: 8,
        children: [
          Row(
            children: [
              ToneChip('Human · ${o.observedBy}', tone: Tone.brand, icon: Symbols.person_rounded, fontSize: 11.5),
              const Spacer(),
              Text(
                brainWhen(o.observedAt, now: now),
                style: LefiText.body(11.5, color: LefiColors.subtle),
              ),
            ],
          ),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              ToneChip(label, tone: tone, fontSize: 12),
              for (final i in o.issues) ToneChip(issueLabel(i), fontSize: 12),
            ],
          ),
          if (o.note != null) Text(o.note!, style: LefiText.body(14, color: LefiColors.body, height: 1.45)),
        ],
      ),
    );
  }
}

/// A person's observation of the plant (`plant.observe`). True when Lefi Brain kept it.
Future<bool> showObservationSheet(BuildContext context, WidgetRef ref, PlantDetail d) async =>
    await showLefiSheet<bool>(context, builder: (_) => _ObservationForm(d)) ?? false;

class _ObservationForm extends ConsumerStatefulWidget {
  const _ObservationForm(this.d);
  final PlantDetail d;

  @override
  ConsumerState<_ObservationForm> createState() => _ObservationFormState();
}

class _ObservationFormState extends ConsumerState<_ObservationForm> {
  String? _health;
  final _issues = <String>{};
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final issues = widget.d.health?.issues.isNotEmpty ?? false ? widget.d.health!.issues : plantIssues;
    return Gap(
      gap: 14,
      children: [
        Text('Observation of ${widget.d.plant.code}', style: LefiText.outfit(21)),
        Text(
          'Saved as your observation — a person’s, never an AI detection.',
          style: LefiText.body(13.5, color: LefiColors.subtle),
        ),
        FieldLabel(
          'How it looks',
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final h in plantHealthStates)
                PillButton(
                  label: plantHealthTag(h).$1,
                  selected: _health == h,
                  onTap: () => setState(() => _health = h),
                ),
            ],
          ),
        ),
        FieldLabel(
          'Issues seen',
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final i in issues)
                PillButton(
                  label: issueLabel(i),
                  selected: _issues.contains(i),
                  onTap: () => setState(() => _issues.contains(i) ? _issues.remove(i) : _issues.add(i)),
                ),
            ],
          ),
        ),
        FieldLabel(
          'Note (optional)',
          child: LefiTextField(
            controller: _note,
            minLines: 3,
            fontSize: 15,
            hint: 'What you saw',
            textCapitalization: TextCapitalization.sentences,
          ),
        ),
        LefiButton(
          label: 'Save observation',
          opacity: _health == null ? .5 : 1,
          onPressed: () async {
            if (_health == null) {
              return ref.read(toastProvider.notifier).show('Choose how the plant looks.', bad: true);
            }
            var closed = 0;
            final ok = await runBrain(
              ref,
              'Saving…',
              () async => closed = await ref
                  .read(brainGreenhouseRepositoryProvider)!
                  .recordObservation(widget.d.plant.id, health: _health!, issues: _issues.toList(), note: _note.text),
              done: 'Observation saved.',
            );
            if (!ok || !context.mounted) return;
            if (closed > 0) ref.read(toastProvider.notifier).show('Observation saved · inspection request closed.');
            Navigator.pop(context, true);
          },
        ),
      ],
    );
  }
}

extension on String {
  String ifEmptyOr(String other) => isEmpty ? other : this;
}
