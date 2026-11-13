import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/navigation/open_target.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/dashed_border.dart';
import '../../../core/widgets/media.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/widgets/selectors.dart';
import '../../../shared/domain/role.dart';
import '../../auth/application/session.dart';
import '../../home/domain/dashboard.dart';
import '../../report/presentation/report_sheet.dart';
import '../application/brain_greenhouse.dart';
import '../application/greenhouse_providers.dart';
import '../domain/greenhouse.dart';
import 'brain_plant_screen.dart';

enum _ObsFilter { all, ai, human }

class PlantScreen extends ConsumerStatefulWidget {
  const PlantScreen({super.key, required this.plantId});
  final String plantId;

  @override
  ConsumerState<PlantScreen> createState() => _PlantScreenState();
}

class _PlantScreenState extends ConsumerState<PlantScreen> {
  _ObsFilter _f = _ObsFilter.all;

  bool _match(Observation o, _ObsFilter f) => switch (f) {
    _ObsFilter.all => true,
    _ObsFilter.ai => o.isAi,
    _ObsFilter.human => !o.isAi,
  };

  @override
  Widget build(BuildContext context) {
    if (ref.watch(brainGreenhouseRepositoryProvider) != null) return BrainPlantScreen(plantId: widget.plantId);
    final role = ref.watch(currentUserProvider).role;
    final canAi = role.can(Permission.aiInsights);
    final plants = ref.watch(plantsProvider);
    final zones = ref.watch(zonesProvider).value ?? const [];
    final ghs = ref.watch(greenhousesProvider).value ?? const [];
    final obs = ref.watch(plantObservationsProvider(widget.plantId)).value ?? const [];
    final history = ref.watch(plantHealthHistoryProvider(widget.plantId)).value;

    return PushedScreen(
      title: 'Plant profile',
      backLabel: 'Zone',
      bottom: StickyActionBar(
        children: [
          role.can(Permission.inspect)
              ? LefiButton(
                  label: 'Start inspection',
                  icon: Symbols.photo_camera_rounded,
                  onPressed: () => openTarget(context, InspectTarget(widget.plantId)),
                )
              : LefiButton(
                  label: 'Report an issue with this plant',
                  icon: Symbols.report_rounded,
                  onPressed: () => showReportSheet(context),
                ),
        ],
      ),
      body: AsyncView(
        plants,
        data: (all) {
          final p = all.firstWhere((x) => x.id == widget.plantId);
          final z = zones.firstWhere((x) => x.id == p.zoneId);
          final gh = ghs.where((g) => g.id == z.greenhouseId).firstOrNull?.name ?? '';
          final t = Tone.ofHealth(p.health);
          final visible = obs.where((o) => canAi || !o.isAi).toList();
          Widget chip(String s) => ToneChip(
            s,
            fontSize: 12.5,
            foreground: LefiColors.strong,
            radius: 8,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          );
          return ListView(
            padding: EdgeInsets.zero,
            children: [
              StripedPlaceholder(
                aspectRatio: 4 / 3,
                stripe: 14,
                radius: 0,
                child: Align(
                  alignment: Alignment.bottomLeft,
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: ImageLabel('PLANT PHOTO · ${p.id} · ${p.position} · today 07:54', fontSize: 10.5),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
                child: Gap(
                  gap: 14,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(p.id, style: LefiText.mono(26, weight: 600)),
                        const SizedBox(height: 4),
                        Text(
                          '${p.variety} · position ${p.position} · ${z.id} · ${z.label}',
                          style: LefiText.body(14, color: LefiColors.muted),
                        ),
                      ],
                    ),
                    Wrap(spacing: 6, runSpacing: 6, children: [chip(p.stage), chip('${p.ageDays} days'), chip(gh)]),
                    if (canAi)
                      LefiCard(
                        child: Gap(
                          gap: 8,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text('Health history · 14 days', style: LefiText.outfit(16)),
                                      Text(
                                        'AI health score · computer-vision estimate',
                                        style: LefiText.body(12, color: LefiColors.subtle),
                                      ),
                                    ],
                                  ),
                                ),
                                Text('${p.health}', style: LefiText.outfit(26, color: t.fg)),
                              ],
                            ),
                            if (history != null) Sparkline(values: history),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                for (final d in const ['Oct 15', 'Oct 21', 'Today'])
                                  Text(d, style: LefiText.mono(10.5, color: LefiColors.faint)),
                              ],
                            ),
                          ],
                        ),
                      )
                    else
                      const InfoNote(text: 'AI health scores aren’t shown for your role. Human notes are below.'),
                    Row(
                      children: [
                        Expanded(child: Text('Observations', style: LefiText.outfit(18))),
                        for (final f in _ObsFilter.values) ...[
                          const SizedBox(width: 4),
                          PillButton(
                            label:
                                '${switch (f) {
                                  _ObsFilter.all => 'All',
                                  _ObsFilter.ai => 'AI',
                                  _ObsFilter.human => 'Human',
                                }} · ${obs.where((o) => _match(o, f)).length}',
                            selected: _f == f,
                            height: 32,
                            fontSize: 12,
                            horizontalPadding: 10,
                            onTap: () => setState(() => _f = f),
                          ),
                        ],
                      ],
                    ),
                    for (final o in visible.where((o) => _match(o, _f))) _ObservationCard(o),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _ObservationCard extends StatelessWidget {
  const _ObservationCard(this.o);
  final Observation o;

  @override
  Widget build(BuildContext context) {
    final ai = o.isAi;
    final (stLabel, stTone) = ai
        ? (o.confirmed
              ? ('Confirmed by grower', Tone.ok)
              : o.text.startsWith('No anomalies')
              ? ('No action needed', Tone.ok)
              : ('Prediction · not confirmed', Tone.warn))
        : ('Human observation', Tone.brand);
    final card = Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: ai ? LefiColors.aiWash : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: ai ? null : Border.all(color: LefiColors.border),
      ),
      child: Gap(
        gap: 8,
        children: [
          Row(
            children: [
              Flexible(
                child: ToneChip(
                  '${ai ? 'AI' : 'Human'} · ${o.author}',
                  tone: ai ? Tone.ai : Tone.brand,
                  fontSize: 11.5,
                  icon: ai ? Symbols.psychiatry_rounded : Symbols.person_rounded,
                ),
              ),
              if (o.simulated) ...[const SizedBox(width: 6), const SimulationBadge(fontSize: 10)],
              const Spacer(),
              Text(o.time, style: LefiText.body(11.5, color: LefiColors.subtle)),
            ],
          ),
          Text(o.text, style: LefiText.body(14, color: LefiColors.body, height: 1.45)),
          Row(
            children: [
              ToneChip(stLabel, tone: stTone),
              if (o.confidence != null) ...[
                const SizedBox(width: 6),
                Text('Confidence ${o.confidence}', style: LefiText.body(12, weight: 700, color: LefiColors.simulation)),
              ],
            ],
          ),
        ],
      ),
    );
    // AI content is always visually distinct (dashed violet) from human notes.
    return ai ? DashedBorder(color: LefiColors.aiDash, radius: 16, child: card) : card;
  }
}
