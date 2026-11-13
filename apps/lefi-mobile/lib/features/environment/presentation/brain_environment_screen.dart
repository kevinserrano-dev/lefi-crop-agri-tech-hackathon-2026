import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/widgets/selectors.dart';
import '../../brain/data/brain_json.dart';
import '../../greenhouse/presentation/brain_zone_screen.dart' show ZoneReadingCard;
import '../application/brain_environment.dart';
import '../domain/brain_environment.dart';
import 'env_chart.dart';

/// Environmental Monitoring on the phone (ADR-108), read only, like Lefi Desktop's (ADR-084, 097): a
/// zone's current values with provenance and the range that applies, each variable's history over
/// 24 h / 7 d / 30 d with average, minimum, maximum and time in range, the ranges people set, the
/// species' ranges and why a crop gives none. Ranges are changed in Lefi Desktop.
class BrainEnvironmentScreen extends ConsumerStatefulWidget {
  const BrainEnvironmentScreen({super.key, this.zoneId});
  final String? zoneId;

  @override
  ConsumerState<BrainEnvironmentScreen> createState() => _BrainEnvironmentScreenState();
}

class _BrainEnvironmentScreenState extends ConsumerState<BrainEnvironmentScreen> {
  late String? _zone = widget.zoneId;
  String _range = '24h';

  @override
  Widget build(BuildContext context) {
    if (ref.watch(brainEnvironmentAuthProvider) == null) {
      return const PushedScreen(
        title: 'Environment',
        backLabel: 'Back',
        body: ScrollBody(children: [InfoNote(text: 'Environmental monitoring is not for your role in Lefi Brain.')]),
      );
    }
    final p = brainEnvironmentProvider(_zone, _range);
    return PushedScreen(
      title: 'Environment',
      backLabel: 'Back',
      body: AsyncView(
        ref.watch(p),
        data: (e) => RefreshIndicator(
          color: LefiColors.brandDark,
          onRefresh: () => ref.refresh(p.future),
          child: ScrollBody(
            children: [
              if (e.zones.isEmpty)
                const InfoNote(
                  text: 'Lefi Brain has no zone yet. Zones are added in Lefi Desktop.',
                  icon: Symbols.info_rounded,
                )
              else ...[
                _ZonePicker(e, onSelected: (id) => setState(() => _zone = id)),
                SegmentedTabs<String>(
                  items: envRanges,
                  selected: _range,
                  labelOf: envRangeLabel,
                  onSelected: (r) => setState(() => _range = r),
                ),
                ..._body(e),
              ],
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _body(BrainEnvironment e) => [
    SectionTitle(
      'Now',
      trailing: Text('Lefi Brain · ${brainHm(e.brainTime)}', style: LefiText.body(12, color: LefiColors.subtle)),
    ),
    if (e.values.isEmpty)
      const InfoNote(
        text: 'No enabled sensor measures in this zone yet. Sensors are added to a device in Lefi Desktop.',
        icon: Symbols.sensors_off_rounded,
      )
    else
      GridView.count(
        crossAxisCount: 2,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        mainAxisSpacing: 10,
        crossAxisSpacing: 10,
        childAspectRatio: 174 / 150,
        children: [for (final v in e.values) ZoneReadingCard(v)],
      ),
    SectionTitle('History · ${envRangeLabel(e.range)}'),
    if (e.series.isEmpty)
      const InfoNote(text: 'No stored readings for this zone in this window.', icon: Symbols.timeline_rounded)
    else
      for (final s in e.series) _SeriesCard(s, e),
    const SectionTitle('Ranges that apply here'),
    _Ranges(e),
    if (e.crops.isNotEmpty) ...[const SectionTitle('Crops and their species’ knowledge'), _Crops(e)],
    if (e.irrigation.isNotEmpty) InfoNote(text: 'Irrigation: ${e.irrigation}', icon: Symbols.water_drop_rounded),
    Text(
      'Read only on the phone. Ranges are set in Lefi Desktop (alert rules, AI Knowledge Center).',
      textAlign: TextAlign.center,
      style: LefiText.body(12, color: LefiColors.subtle, height: 1.45),
    ),
  ];
}

class _ZonePicker extends StatelessWidget {
  const _ZonePicker(this.e, {required this.onSelected});
  final BrainEnvironment e;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final sel = e.zone ?? e.zones.first;
    return LefiCard(
      padding: const EdgeInsets.fromLTRB(14, 4, 6, 4),
      child: Row(
        children: [
          const Icon(Symbols.grid_view_rounded, color: LefiColors.leaf, size: 22),
          const SizedBox(width: 10),
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: sel.id,
                isExpanded: true,
                borderRadius: BorderRadius.circular(14),
                items: [
                  for (final z in e.zones)
                    DropdownMenuItem(
                      value: z.id,
                      child: Text(
                        [z.title, if (z.greenhouse.isNotEmpty) z.greenhouse].join(' · '),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: LefiText.body(14.5, weight: 700),
                      ),
                    ),
                ],
                onChanged: (id) {
                  if (id != null) onSelected(id);
                },
              ),
            ),
          ),
          if (sel.alertsCritical > 0)
            ToneChip(plural(sel.alertsCritical, 'critical', 'critical'), tone: Tone.crit, fontSize: 11)
          else if (sel.alertsWarning > 0)
            ToneChip(plural(sel.alertsWarning, 'warning'), tone: Tone.warn, fontSize: 11)
          else
            ToneChip(plural(sel.sensors, 'sensor'), tone: Tone.neutral, fontSize: 11),
        ],
      ),
    );
  }
}

class _SeriesCard extends StatelessWidget {
  const _SeriesCard(this.s, this.e);
  final EnvSeries s;
  final BrainEnvironment e;

  @override
  Widget build(BuildContext context) {
    final st = s.stats;
    final r = s.range;
    Widget stat(String k, String v) => Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(k, style: LefiText.body(11, color: LefiColors.subtle)),
          Text(v, style: LefiText.body(13.5, weight: 700)),
        ],
      ),
    );
    return LefiCard(
      child: Gap(
        gap: 10,
        children: [
          Row(
            children: [
              Expanded(child: Text(s.label, style: LefiText.body(15, weight: 700))),
              if (s.simulated) const SimulationBadge(label: 'SIMULATED', fontSize: 9.5),
              const SizedBox(width: 6),
              Text(plural(s.sensors, 'sensor'), style: LefiText.body(12, color: LefiColors.subtle)),
            ],
          ),
          if (s.empty)
            Text('No stored readings in this window.', style: LefiText.body(13, color: LefiColors.muted))
          else ...[
            EnvChart(values: s.values, min: r?.min, max: r?.max),
            Row(
              children: [
                Text(
                  e.since == null ? envRangeLabel(e.range) : brainWhen(e.since),
                  style: LefiText.body(10.5, color: LefiColors.faint),
                ),
                const Spacer(),
                Text('now', style: LefiText.body(10.5, color: LefiColors.faint)),
              ],
            ),
          ],
          Row(
            children: [
              stat('Average', fmtEnvValue(st.average, s.unit)),
              stat('Min', fmtEnvValue(st.min, s.unit)),
              stat('Max', fmtEnvValue(st.max, s.unit)),
              stat('In range', st.timeInRange == null ? '—' : '${(st.timeInRange! * 100).round()} %'),
            ],
          ),
          Text(
            r == null
                ? 'No range applies: nobody set one and no species profile gives one.'
                : '${r.source == 'species' ? 'Species range' : 'Rule'} · ${r.rule} · ${fmtEnvRange(r.min, r.max, s.unit)}',
            style: LefiText.body(12, color: r == null ? LefiColors.muted : LefiColors.secondary, height: 1.4),
          ),
          Text(
            '${st.readings} stored readings · bucket averages, gaps where nothing was stored',
            style: LefiText.body(11, color: LefiColors.faint),
          ),
        ],
      ),
    );
  }
}

class _Ranges extends StatelessWidget {
  const _Ranges(this.e);
  final BrainEnvironment e;

  @override
  Widget build(BuildContext context) {
    if (e.rules.isEmpty && e.cropRanges.isEmpty) {
      return const InfoNote(
        text: 'No range applies in this zone: no alert rule and no published species profile with parameters.',
        icon: Symbols.straighten_rounded,
      );
    }
    return LefiCard(
      child: Gap(
        gap: 12,
        children: [
          for (final r in e.rules)
            _RangeRow(
              title: r.label,
              value: fmtEnvRange(r.min, r.max, r.unit),
              sub: 'Rule by a person · ${r.name} · ${r.appliesTo == 'all' ? 'all sensors' : humanize(r.appliesTo)}',
              chip: ToneChip(
                humanize(r.severity),
                tone: r.severity == 'critical' ? Tone.crit : Tone.warn,
                fontSize: 10.5,
              ),
            ),
          for (final c in e.cropRanges)
            _RangeRow(
              title: '${c.label} · ${c.crop}',
              value: fmtEnvRange(c.optimal[0], c.optimal[1], c.unit),
              sub: [
                'Species optimal · ${c.profile}',
                if (c.stage != null) c.stage!,
                'warning ${fmtEnvRange(c.warning[0], c.warning[1])}',
                'critical ${fmtEnvRange(c.critical[0], c.critical[1])}',
              ].join(' · '),
              chip: ToneChip(
                verificationLabel(c.verification),
                tone: c.verification == 'verified' ? Tone.ok : Tone.warn,
                fontSize: 10.5,
              ),
            ),
        ],
      ),
    );
  }
}

class _RangeRow extends StatelessWidget {
  const _RangeRow({required this.title, required this.value, required this.sub, required this.chip});
  final String title;
  final String value;
  final String sub;
  final Widget chip;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        children: [
          Expanded(child: Text(title, style: LefiText.body(14, weight: 700))),
          Text(value, style: LefiText.body(14, weight: 700, color: LefiColors.leaf)),
        ],
      ),
      const SizedBox(height: 2),
      Text(sub, style: LefiText.body(12, color: LefiColors.muted, height: 1.4)),
      const SizedBox(height: 4),
      chip,
    ],
  );
}

class _Crops extends StatelessWidget {
  const _Crops(this.e);
  final BrainEnvironment e;

  @override
  Widget build(BuildContext context) => LefiCard(
    child: Gap(
      gap: 12,
      children: [
        for (final c in e.crops)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                c.knowledge == 'ranges' ? Symbols.check_circle_rounded : Symbols.info_rounded,
                size: 20,
                color: c.knowledge == 'ranges' ? LefiColors.success : Tone.warn.dot,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      [
                        c.crop,
                        if (c.batch) 'batch' else if (c.plants != null) plural(c.plants!, 'plant'),
                        ?c.profile,
                      ].join(' · '),
                      style: LefiText.body(14, weight: 700),
                    ),
                    Text(
                      cropKnowledgeLabel(c.knowledge),
                      style: LefiText.body(12.5, color: LefiColors.muted, height: 1.4),
                    ),
                  ],
                ),
              ),
            ],
          ),
      ],
    ),
  );
}
