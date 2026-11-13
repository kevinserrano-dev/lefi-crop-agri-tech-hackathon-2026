import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/navigation/open_target.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/media.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/widgets/selectors.dart';
import '../../../shared/domain/role.dart';
import '../../ai_control/presentation/ai_widgets.dart';
import '../../auth/application/session.dart';
import '../../home/domain/dashboard.dart';
import '../application/brain_greenhouse.dart';
import '../application/greenhouse_providers.dart';
import '../domain/greenhouse.dart';
import 'brain_greenhouse_view.dart';
import 'greenhouse_format.dart';

class GreenhouseScreen extends ConsumerStatefulWidget {
  const GreenhouseScreen({super.key});

  @override
  ConsumerState<GreenhouseScreen> createState() => _GreenhouseScreenState();
}

class _GreenhouseScreenState extends ConsumerState<GreenhouseScreen> {
  String _gh = 'GH-1';

  @override
  Widget build(BuildContext context) {
    if (ref.watch(brainGreenhouseRepositoryProvider) != null) {
      return RootScreen(
        title: 'Greenhouse',
        subtitle: 'From Lefi Brain',
        onRefresh: () => ref.refresh(brainGreenhouseOverviewProvider.future),
        children: const [BrainGreenhouseView()],
      );
    }
    final user = ref.watch(currentUserProvider);
    final showHealth = user.role.can(Permission.aiInsights);
    final ghs = ref.watch(greenhousesProvider);
    final policy = ref.watch(accessPolicyProvider);

    return RootScreen(
      title: 'Greenhouse',
      subtitle: user.role.can(Permission.allZones) ? 'All zones you can access' : 'Your assigned zones',
      top: const AiOfflineBar(),
      children: [
        AsyncView(
          ghs.whenData((g) => (g, policy.value)),
          data: (d) {
            final (all, pol) = d;
            if (pol == null) return const ScreenSkeleton();
            final zones = pol.visibleZones();
            final allowed = all.where((g) => zones.any((z) => z.greenhouseId == g.id)).toList();
            final sel = allowed.firstWhere((g) => g.id == _gh, orElse: () => allowed.first);
            final gz = zones.where((z) => z.greenhouseId == sel.id).toList();
            double avg(Metric m) => gz.map((z) => z.value(m) ?? 0).reduce((a, b) => a + b) / gz.length;
            final scopeNote = switch (user.role) {
              Role.worker => 'Showing your 2 assigned zones. Other zones are hidden by your access policy.',
              Role.supervisor => 'Showing North & South Range — your assigned greenhouses.',
              _ => null,
            };
            return Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
              child: Gap(
                gap: 12,
                children: [
                  FilterPills(
                    items: allowed,
                    selected: sel,
                    labelOf: (g) => '${g.id} · ${g.name}',
                    onSelected: (g) => setState(() => _gh = g.id),
                    height: 38,
                  ),
                  LefiCard(
                    radius: 20,
                    padding: EdgeInsets.zero,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        SizedBox(
                          height: 120,
                          child: StripedPlaceholder(
                            a: const Color(0xFFE3EEE6),
                            b: const Color(0xFFECF3EE),
                            stripe: 10,
                            radius: 0,
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  ImageLabel('GREENHOUSE PHOTO · ${sel.id}'),
                                  const Spacer(),
                                  if (showHealth)
                                    ToneChip(
                                      'Health ${sel.health}',
                                      tone: Tone.ofHealth(sel.health),
                                      fontSize: 12,
                                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                                    ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.all(14),
                          child: Gap(
                            children: [
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(sel.name, style: LefiText.outfit(20)),
                                  const SizedBox(height: 2),
                                  Text(
                                    '${sel.id} · ${sel.area} · ${sel.system}',
                                    style: LefiText.body(13, color: LefiColors.subtle),
                                  ),
                                ],
                              ),
                              Row(
                                children: [
                                  _stat('${gz.length}', 'Zones'),
                                  _stat(thousands(gz.fold(0, (a, z) => a + z.plantCount)), 'Plants'),
                                  _stat('${avg(Metric.temp).toStringAsFixed(1)}°', 'Avg °C'),
                                  _stat('${avg(Metric.rh).round()} %', 'Avg RH'),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (scopeNote != null)
                    InfoNote(
                      text: scopeNote,
                      icon: Symbols.shield_person_rounded,
                      iconSize: 19,
                      background: Tone.info.bg,
                      foreground: Tone.info.fg,
                    ),
                  const Padding(padding: EdgeInsets.only(top: 4), child: SectionTitle('Zones')),
                  for (final z in gz)
                    _ZoneCard(zone: z, showHealth: showHealth, onTap: () => openTarget(context, ZoneTarget(z.id))),
                ],
              ),
            );
          },
        ),
      ],
    );
  }

  Widget _stat(String v, String k) => Expanded(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(v, style: LefiText.outfit(16)),
        Text(k, style: LefiText.body(12, color: LefiColors.subtle)),
      ],
    ),
  );
}

class _ZoneCard extends StatelessWidget {
  const _ZoneCard({required this.zone, required this.showHealth, required this.onTap});
  final Zone zone;
  final bool showHealth;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final z = zone;
    final t = Tone.ofHealth(z.health);
    final alert = zoneAlert(z);
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
      onTap: onTap,
      borderColor: alert != null && !z.reEntryRestricted ? LefiColors.dangerBorder : LefiColors.border,
      child: Gap(
        gap: 12,
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: t.bg, borderRadius: BorderRadius.circular(14)),
                child: showHealth
                    ? Text('${z.health}', style: LefiText.outfit(18, color: t.fg))
                    : Container(
                        width: 12,
                        height: 12,
                        decoration: BoxDecoration(color: t.dot, shape: BoxShape.circle),
                      ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${z.label} · ${z.crop}', style: LefiText.body(16, weight: 700, color: LefiColors.ink)),
                    const SizedBox(height: 2),
                    Text(
                      '${z.id} · ${thousands(z.plantCount)} plants',
                      style: LefiText.body(12.5, color: LefiColors.subtle),
                    ),
                  ],
                ),
              ),
              const Chevron(size: 22),
            ],
          ),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: LefiColors.surfaceMuted, borderRadius: BorderRadius.circular(12)),
            child: Row(
              children: [
                cell('Temp', '${z.value(Metric.temp)!.toStringAsFixed(1)} °C'),
                const SizedBox(width: 8),
                cell('Humidity', '${z.value(Metric.rh)!.round()} %'),
                const SizedBox(width: 8),
                cell('Moisture', z.value(Metric.moisture) == null ? '—' : '${z.value(Metric.moisture)!.round()} %'),
              ],
            ),
          ),
          if (alert != null)
            Row(
              children: [
                Icon(
                  Symbols.error_rounded,
                  size: 18,
                  color: z.reEntryRestricted ? const Color(0xFF8A5A00) : LefiColors.dangerDeep,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    alert,
                    style: LefiText.body(
                      13,
                      weight: 700,
                      color: z.reEntryRestricted ? const Color(0xFF8A5A00) : LefiColors.dangerDeep,
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
