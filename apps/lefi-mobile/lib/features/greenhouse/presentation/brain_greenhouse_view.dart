import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/router/routes.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/rows.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/widgets/selectors.dart';
import '../../brain/data/brain_json.dart';
import '../application/brain_greenhouse.dart';
import '../domain/brain_greenhouse.dart';
import 'brain_greenhouse_style.dart';
import 'greenhouse_format.dart';

/// The Greenhouse tab on Lefi Brain (ADR-080, 099): greenhouse → zones, from real data only.
class BrainGreenhouseView extends ConsumerStatefulWidget {
  const BrainGreenhouseView({super.key});

  @override
  ConsumerState<BrainGreenhouseView> createState() => _BrainGreenhouseViewState();
}

class _BrainGreenhouseViewState extends ConsumerState<BrainGreenhouseView> {
  String? _gh;

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(brainGreenhouseOverviewProvider);
    return AsyncView(
      async,
      data: (o) {
        if (o.greenhouses.isEmpty) {
          return const Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, 28),
            child: InfoNote(
              text: 'Lefi Brain has no greenhouse yet. An administrator adds greenhouses and zones in Lefi Desktop.',
              icon: Symbols.info_rounded,
            ),
          );
        }
        final sel = o.greenhouses.firstWhere((g) => g.id == _gh, orElse: () => o.greenhouses.first);
        final zones = o.zones.where((z) => z.greenhouseId == sel.id).toList();
        final plants = zones.fold(0, (a, z) => a + z.plants);
        final crops = zones.fold(0, (a, z) => a + z.activeCrops);
        final crit = zones.fold(0, (a, z) => a + (o.envZones[z.id]?.alertsCritical ?? 0));
        final warn = zones.fold(0, (a, z) => a + (o.envZones[z.id]?.alertsWarning ?? 0));
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
          child: Gap(
            gap: 12,
            children: [
              if (o.greenhouses.length > 1)
                FilterPills<BrainGreenhouse>(
                  items: o.greenhouses,
                  selected: sel,
                  labelOf: (g) => g.name,
                  onSelected: (g) => setState(() => _gh = g.id),
                  height: 38,
                ),
              LefiCard(
                radius: 20,
                child: Gap(
                  children: [
                    Row(
                      children: [
                        IconTile(Symbols.yard_rounded, size: 44),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(sel.name, style: LefiText.outfit(20)),
                              Text('Lefi Brain · LIVE', style: LefiText.body(12.5, color: LefiColors.subtle)),
                            ],
                          ),
                        ),
                        if (crit + warn == 0)
                          const ToneChip('No active alerts', tone: Tone.ok)
                        else
                          ToneChip(
                            plural(crit + warn, 'alert'),
                            tone: crit > 0 ? Tone.crit : Tone.warn,
                            icon: Symbols.warning_rounded,
                          ),
                      ],
                    ),
                    Row(
                      children: [
                        _stat('${zones.length}', 'Zones'),
                        _stat(thousands(plants), 'Registered plants'),
                        _stat('$crops', 'Active crops'),
                      ],
                    ),
                  ],
                ),
              ),
              if (o.envZones.isNotEmpty)
                CardList(
                  children: [
                    NavRow(
                      icon: Symbols.monitoring_rounded,
                      tone: Tone.info,
                      title: 'Environmental monitoring',
                      subtitle: 'Each zone’s values, history and ranges',
                      onTap: () => context.pushEnvironment(zones.isEmpty ? null : zones.first.id),
                    ),
                  ],
                ),
              const Padding(padding: EdgeInsets.only(top: 4), child: SectionTitle('Zones')),
              if (zones.isEmpty) const InfoNote(text: 'This greenhouse has no zones yet.', icon: Symbols.info_rounded),
              for (final z in zones) BrainZoneCard(zone: z, env: o.envZones[z.id]),
            ],
          ),
        );
      },
    );
  }

  Widget _stat(String v, String k) => Expanded(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(v, style: LefiText.outfit(18)),
        Text(k, style: LefiText.body(12, color: LefiColors.subtle)),
      ],
    ),
  );
}

class BrainZoneCard extends StatelessWidget {
  const BrainZoneCard({super.key, required this.zone, this.env});
  final BrainZone zone;
  final EnvZone? env;

  @override
  Widget build(BuildContext context) {
    final z = zone;
    final crit = env?.alertsCritical ?? 0;
    final warn = env?.alertsWarning ?? 0;
    final tone = crit > 0 ? Tone.crit : (warn > 0 ? Tone.warn : (z.status == 'active' ? Tone.ok : Tone.off));
    Widget cell(String k, String v) => Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(k, style: LefiText.body(11.5, color: LefiColors.subtle)),
          Text(v, style: LefiText.body(14.5, weight: 700)),
        ],
      ),
    );
    return LefiCard(
      onTap: () => context.pushDetail<void>('zone/${z.id}'),
      borderColor: crit > 0 ? LefiColors.dangerBorder : LefiColors.border,
      child: Gap(
        gap: 12,
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: tone.bg, borderRadius: BorderRadius.circular(14)),
                child: Text(
                  z.code ?? z.name.characters.first.toUpperCase(),
                  style: LefiText.outfit(z.code != null && z.code!.length > 3 ? 13 : 17, color: tone.fg),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(z.name, style: LefiText.body(16, weight: 700, color: LefiColors.ink)),
                    const SizedBox(height: 2),
                    Text(purposeLabel(z), style: LefiText.body(12.5, color: LefiColors.subtle)),
                  ],
                ),
              ),
              if (z.status != 'active') ...[
                ToneChip(zoneStatusLabel(z.status), tone: zoneStatusTone(z.status)),
                const SizedBox(width: 6),
              ],
              const Chevron(size: 22),
            ],
          ),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: LefiColors.surfaceMuted, borderRadius: BorderRadius.circular(12)),
            child: Row(
              children: [
                cell('Plants', thousands(z.plants)),
                const SizedBox(width: 8),
                cell('Crops', '${z.activeCrops}'),
                const SizedBox(width: 8),
                cell('Sensors', env == null ? '—' : '${env!.sensors}'),
              ],
            ),
          ),
          if (crit + warn > 0)
            Row(
              children: [
                Icon(Symbols.error_rounded, size: 18, color: crit > 0 ? LefiColors.dangerDeep : LefiColors.amberDeep),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    [if (crit > 0) '$crit critical', if (warn > 0) '$warn warning'].join(' · '),
                    style: LefiText.body(
                      13,
                      weight: 700,
                      color: crit > 0 ? LefiColors.dangerDeep : LefiColors.amberDeep,
                    ),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}
