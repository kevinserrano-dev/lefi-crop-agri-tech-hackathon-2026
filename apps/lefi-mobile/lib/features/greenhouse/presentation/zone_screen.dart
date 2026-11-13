import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/navigation/open_target.dart';
import '../../../core/feedback/feedback.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/media.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/rows.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../shared/domain/provenance.dart';
import '../../../shared/domain/role.dart';
import '../../auth/application/session.dart';
import '../../home/domain/dashboard.dart';
import '../application/brain_greenhouse.dart';
import '../application/greenhouse_providers.dart';
import '../domain/greenhouse.dart';
import 'brain_zone_screen.dart';
import 'greenhouse_format.dart';

IconData metricIcon(Metric m) => switch (m) {
  Metric.temp => Symbols.thermostat_rounded,
  Metric.rh => Symbols.humidity_percentage_rounded,
  Metric.ppfd => Symbols.light_mode_rounded,
  Metric.moisture => Symbols.water_drop_rounded,
  Metric.ec => Symbols.bolt_rounded,
  Metric.ph => Symbols.science_rounded,
};

(String, Tone) originBadge(DataOrigin o) => switch (o) {
  DataOrigin.live => ('LIVE', Tone.ok),
  DataOrigin.simulated => ('SIMULATED', Tone.ai),
  DataOrigin.offline => ('OFFLINE', Tone.off),
};

class ZoneScreen extends ConsumerStatefulWidget {
  const ZoneScreen({super.key, required this.zoneId});
  final String zoneId;

  @override
  ConsumerState<ZoneScreen> createState() => _ZoneScreenState();
}

class _ZoneScreenState extends ConsumerState<ZoneScreen> {
  String _snap = '10:11';

  @override
  Widget build(BuildContext context) {
    if (ref.watch(brainGreenhouseRepositoryProvider) != null) return BrainZoneScreen(zoneId: widget.zoneId);
    final role = ref.watch(currentUserProvider).role;
    final canAi = role.can(Permission.aiInsights);
    final data = ref.watch(zonesProvider).whenData((zones) => zones);
    final plants = ref.watch(plantsProvider).value ?? const [];
    final ghs = ref.watch(greenhousesProvider).value ?? const [];

    return PushedScreen(
      title: 'Zone',
      backLabel: 'Greenhouse',
      body: AsyncView(
        data,
        data: (zones) {
          final zi = zones.indexWhere((z) => z.id == widget.zoneId);
          final z = zones[zi];
          final t = Tone.ofHealth(z.health);
          final gh = ghs.where((g) => g.id == z.greenhouseId).firstOrNull?.name ?? '';
          final zp = plants.where((p) => p.zoneId == z.id).toList();
          final flagged = ref.watch(zoneAiFlagsProvider(z.id)).value ?? const [];
          return ScrollBody(
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${z.label} · ${z.id}', style: LefiText.outfit(24)),
                        const SizedBox(height: 3),
                        Text(
                          '${z.crop} · ${thousands(z.plantCount)} plants · $gh',
                          style: LefiText.body(13, color: LefiColors.subtle),
                        ),
                      ],
                    ),
                  ),
                  if (canAi)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(color: t.bg, borderRadius: BorderRadius.circular(12)),
                      child: Column(
                        children: [
                          Text('${z.health}', style: LefiText.outfit(22, color: t.fg)),
                          Text('HEALTH', style: LefiText.body(10.5, weight: 800, color: t.fg)),
                        ],
                      ),
                    ),
                ],
              ),
              if (z.reEntryRestricted)
                InfoNote(
                  text: 'Closed for spraying — re-entry interval until 14:00.',
                  icon: Symbols.warning_rounded,
                  iconSize: 22,
                  background: Tone.warn.bg,
                  foreground: LefiColors.amberDeep,
                  fontSize: 13.5,
                  fontWeight: 600,
                  padding: const EdgeInsets.all(12),
                ),
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                padding: EdgeInsets.zero,
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                childAspectRatio: 174 / 116,
                children: [for (final m in Metric.values) _ReadingCard(m, z.readings[m]!)],
              ),
              if (role.can(Permission.camera))
                LefiCard(
                  padding: EdgeInsets.zero,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      StripedPlaceholder(
                        aspectRatio: 16 / 10,
                        stripe: 12,
                        radius: 0,
                        child: Align(
                          alignment: Alignment.bottomLeft,
                          child: Padding(
                            padding: const EdgeInsets.all(10),
                            child: ImageLabel(
                              'CAMERA SNAPSHOT · CAM-${z.greenhouseId.replaceAll('-', '')}-0${zi % 6 + 1}',
                            ),
                          ),
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('Camera snapshot', style: LefiText.body(14, weight: 700)),
                                  Text('Today $_snap', style: LefiText.body(12, color: LefiColors.subtle)),
                                ],
                              ),
                            ),
                            SizedBox(
                              height: 40,
                              child: OutlinedButton.icon(
                                style: OutlinedButton.styleFrom(
                                  side: const BorderSide(color: LefiColors.brandBorder),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(11)),
                                  padding: const EdgeInsets.symmetric(horizontal: 12),
                                  foregroundColor: LefiColors.brandDark,
                                ),
                                onPressed: () async {
                                  await ref
                                      .read(busyProvider.notifier)
                                      .run(
                                        'Requesting snapshot…',
                                        () => Future<void>.delayed(const Duration(milliseconds: 900)),
                                      );
                                  setState(() => _snap = '10:${25 + DateTime.now().second % 9}');
                                  ref.read(toastProvider.notifier).show('New snapshot received.');
                                },
                                icon: const Icon(Symbols.refresh_rounded, size: 18),
                                label: Text(
                                  'Refresh',
                                  style: LefiText.body(13, weight: 700, color: LefiColors.brandDark),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              if (canAi)
                Gap(
                  gap: 8,
                  children: [
                    const SectionTitle('AI observations'),
                    CardList(
                      color: LefiColors.aiWash,
                      borderColor: LefiColors.aiDash,
                      dashed: true,
                      children: [
                        if (flagged.isEmpty)
                          Padding(
                            padding: const EdgeInsets.all(14),
                            child: Text(
                              'No AI flags in this zone in the last 24 h.',
                              style: LefiText.body(13.5, color: LefiColors.muted),
                            ),
                          ),
                        for (final (p, o) in flagged)
                          NavRow(
                            icon: Symbols.psychiatry_rounded,
                            tone: Tone.ai,
                            tileSize: 36,
                            iconSize: 20,
                            minHeight: 62,
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            titleSize: 14,
                            subtitleSize: 12,
                            background: Colors.transparent,
                            divider: Tone.ai.bg,
                            title: '${p.id} · ${o.text.split(RegExp('[.—]')).first.trim()}',
                            subtitle: '${o.author} · ${o.time} · ${o.confidence}',
                            onTap: () => openTarget(context, PlantTarget(p.id)),
                          ),
                      ],
                    ),
                  ],
                )
              else
                const InfoNote(text: 'AI observations are shared with growers, scouts and supervisors.'),
              const Padding(padding: EdgeInsets.only(top: 4), child: SectionTitle('Tracked plants')),
              CardList(
                children: [
                  for (final p in zp)
                    NavRow(
                      icon: Symbols.potted_plant_rounded,
                      tone: Tone.ok,
                      leading: const StripedPlaceholder(width: 44, height: 44, stripe: 6),
                      minHeight: 62,
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      title: p.id,
                      titleMono: true,
                      subtitle: 'Position ${p.position} · ${p.stage}',
                      trailing: canAi
                          ? ToneChip(
                              '${p.health}',
                              tone: Tone.ofHealth(p.health),
                              fontSize: 12,
                              radius: 8,
                              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                            )
                          : null,
                      onTap: () => openTarget(context, PlantTarget(p.id)),
                    ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}

class _ReadingCard extends StatelessWidget {
  const _ReadingCard(this.m, this.r);
  final Metric m;
  final Reading r;

  @override
  Widget build(BuildContext context) {
    final v = r.value;
    final Tone st;
    final String label;
    if (v == null) {
      st = Tone.off;
      label = 'No data';
    } else if (v < m.low || v > m.high) {
      final dist = v < m.low ? m.low - v : v - m.high;
      st = dist / (m.high - m.low) > .25 ? Tone.crit : Tone.warn;
      label = st == Tone.crit ? 'Critical' : 'Out of range';
    } else {
      st = Tone.ok;
      label = 'In range';
    }
    String fmt(double x) =>
        x == x.roundToDouble() && m.decimals == 0 ? x.toInt().toString() : x.toStringAsFixed(m.decimals);
    final (badge, badgeTone) = originBadge(r.origin);
    return LefiCard(
      radius: 16,
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(metricIcon(m), size: 20, color: st.fg),
              const Spacer(),
              ToneChip(
                badge,
                tone: badgeTone,
                fontSize: 9.5,
                radius: 5,
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
              ),
            ],
          ),
          const SizedBox(height: 5),
          Text(m.label, style: LefiText.body(12, weight: 600, color: LefiColors.muted)),
          const SizedBox(height: 5),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(v == null ? '—' : fmt(v), style: LefiText.outfit(22)),
              const SizedBox(width: 4),
              Text(m.unit, style: LefiText.body(11.5, color: LefiColors.subtle)),
            ],
          ),
          const SizedBox(height: 5),
          Text('$label · ${_n(m.low)}–${_n(m.high)}', style: LefiText.body(11.5, weight: 700, color: st.fg)),
        ],
      ),
    );
  }

  static String _n(double x) => x == x.roundToDouble() ? x.toInt().toString() : '$x';
}
