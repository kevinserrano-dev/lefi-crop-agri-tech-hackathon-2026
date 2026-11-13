import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/router/routes.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/rows.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../brain/data/brain_json.dart';
import '../../camera/application/brain_cameras.dart';
import '../../camera/presentation/brain_zone_cameras.dart';
import '../../tasks/application/brain_tasks.dart';
import '../../tasks/presentation/brain_tasks_view.dart';
import '../application/brain_greenhouse.dart';
import '../domain/brain_greenhouse.dart';
import 'brain_greenhouse_style.dart';

/// One zone on Lefi Brain: what it is, its live readings with their ranges, what grows in it,
/// its open tasks and its registered plants (ADR-066, 080, 082, 084, 097).
class BrainZoneScreen extends ConsumerWidget {
  const BrainZoneScreen({super.key, required this.zoneId});
  final String zoneId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(brainZoneDetailProvider(zoneId));
    return PushedScreen(
      title: 'Zone',
      backLabel: 'Back',
      body: AsyncView(
        async,
        data: (d) => RefreshIndicator(
          color: LefiColors.brandDark,
          onRefresh: () {
            ref.invalidate(brainZoneCamerasProvider(zoneId));
            ref.invalidate(brainZonePhotosProvider(zoneId));
            return ref.refresh(brainZoneDetailProvider(zoneId).future);
          },
          child: _ZoneBody(d),
        ),
      ),
    );
  }
}

class _ZoneBody extends ConsumerWidget {
  const _ZoneBody(this.d);
  final ZoneDetail d;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final z = d.zone;
    final env = d.environment;
    final now = DateTime.now();
    final tasks = ref.watch(brainZoneTasksProvider(z.id)).value;
    final activeTasks = tasks?.tasks.where((t) => t.active).toList() ?? const [];
    final cropsWithoutBatch = env?.crops.where((c) => !c.batch).toList() ?? const <EnvCrop>[];
    final health = d.health;
    final plants = [...d.plants]..sort((a, b) => a.code.compareTo(b.code));

    return ScrollBody(
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(z.title, style: LefiText.outfit(24)),
                  const SizedBox(height: 3),
                  Text(
                    [?d.greenhouse?.name, purposeLabel(z)].join(' · '),
                    style: LefiText.body(13, color: LefiColors.subtle),
                  ),
                ],
              ),
            ),
            ToneChip(zoneStatusLabel(z.status), tone: zoneStatusTone(z.status), fontSize: 12),
          ],
        ),
        LefiCard(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
          child: Column(
            children: [
              KeyValueRow('Registered plants', '${z.plants} · ${z.batchPlants} in batches'),
              KeyValueRow('Growing locations', '${z.locations}'),
              KeyValueRow(
                'Growing systems',
                z.growingSystems.isEmpty ? 'Not set' : z.growingSystems.map(systemLabel).join(', '),
              ),
              if (z.areaM2 != null) KeyValueRow('Area', '${fmtNum(z.areaM2!)} m²'),
              if (z.physicalRef != null) KeyValueRow('Where', z.physicalRef!),
              KeyValueRow('Climate control', humanize(z.climateControl), last: z.notes == null),
              if (z.notes != null) KeyValueRow('Notes', z.notes!, last: true),
            ],
          ),
        ),
        SectionTitle(
          'Readings',
          trailing: env == null
              ? null
              : Text('Lefi Brain · ${brainHm(env.brainTime)}', style: LefiText.body(12, color: LefiColors.subtle)),
        ),
        if (env == null)
          const InfoNote(text: 'Your role does not see environmental readings.')
        else if (env.values.isEmpty)
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
            children: [for (final v in env.values) ZoneReadingCard(v)],
          ),
        if (env != null)
          CardList(
            children: [
              NavRow(
                icon: Symbols.monitoring_rounded,
                tone: Tone.info,
                title: 'Environmental monitoring',
                subtitle: 'History over 24 h, 7 or 30 days, ranges and the species’ knowledge',
                onTap: () => context.pushEnvironment(z.id),
              ),
            ],
          ),
        if (env != null && env.irrigation.isNotEmpty)
          InfoNote(text: 'Irrigation: ${env.irrigation}', icon: Symbols.water_drop_rounded),
        const SectionTitle('Crops'),
        if (d.batches.isEmpty && cropsWithoutBatch.isEmpty)
          const InfoNote(text: 'Nothing is growing here in Lefi Brain yet.', icon: Symbols.info_rounded),
        for (final b in d.batches)
          _BatchCard(batch: b, crop: d.crops[b.cropTypeId], location: d.locations[b.locationId], now: now),
        for (final c in cropsWithoutBatch)
          LefiCard(
            child: Row(
              children: [
                IconTile(Symbols.potted_plant_rounded, size: 40),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(c.crop, style: LefiText.body(15, weight: 700)),
                      Text(
                        '${plural(c.plants ?? 0, 'registered plant')} · no crop batch',
                        style: LefiText.body(12.5, color: LefiColors.subtle),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ZoneCamerasSection(zoneId: z.id, zoneName: z.title),
        SectionTitle(
          'Open tasks',
          trailing: Text('${activeTasks.length}', style: LefiText.body(13, color: LefiColors.subtle)),
        ),
        if (tasks == null)
          const SizedBox(height: 40, child: Center(child: CircularProgressIndicator(strokeWidth: 2)))
        else if (activeTasks.isEmpty)
          Text('No open tasks in this zone.', style: LefiText.body(13.5, color: LefiColors.muted))
        else
          for (final t in activeTasks) BrainTaskCard(task: t, showAssignee: true, now: now),
        SectionTitle(
          'Registered plants',
          trailing: Text('${plants.length}', style: LefiText.body(13, color: LefiColors.subtle)),
        ),
        if (health == null && plants.isNotEmpty)
          const InfoNote(text: 'Plant health is shared with growers, scouts, supervisors and managers.'),
        if (health != null && health.visionReason.isNotEmpty)
          InfoNote(
            text: 'AI vision per plant: ${health.visionReason}',
            icon: Symbols.psychiatry_rounded,
            background: Tone.ai.bg,
            foreground: Tone.ai.fg,
          ),
        if (plants.isEmpty)
          Text('No plants registered in this zone.', style: LefiText.body(13.5, color: LefiColors.muted))
        else
          CardList(
            children: [
              for (final p in plants)
                _PlantRow(
                  plant: p,
                  crop: d.crops[p.cropTypeId],
                  location: d.locations[p.containerId],
                  row: health?.rows[p.id],
                  showHealth: health != null,
                ),
            ],
          ),
      ],
    );
  }
}

/// One sensor's current value with its provenance and the range that applies (also in Environmental Monitoring).
class ZoneReadingCard extends StatelessWidget {
  const ZoneReadingCard(this.v, {super.key});
  final EnvValue v;

  @override
  Widget build(BuildContext context) {
    final (badge, badgeTone) = readingBadge(v);
    final (verdict, verdictTone) = rangeVerdict(v);
    return LefiCard(
      radius: 16,
      padding: const EdgeInsets.all(12),
      borderColor: v.inRange == false ? LefiColors.dangerBorder : LefiColors.border,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(readingIcon(v.variable), size: 20, color: verdictTone.fg),
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
          const SizedBox(height: 4),
          Text(
            v.label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: LefiText.body(12, weight: 600, color: LefiColors.muted),
          ),
          const SizedBox(height: 3),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(v.value == null ? '—' : fmtNum(v.value!), style: LefiText.outfit(22)),
              const SizedBox(width: 4),
              Flexible(
                child: Text(v.unit ?? '', style: LefiText.body(11.5, color: LefiColors.subtle)),
              ),
            ],
          ),
          const SizedBox(height: 3),
          Text(
            v.range == null ? verdict : '$verdict · ${rangeText(v.range!)}',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: LefiText.body(11, weight: 700, color: verdictTone.fg),
          ),
          const Spacer(),
          Text(
            v.sensor,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: LefiText.body(10.5, color: LefiColors.faint),
          ),
        ],
      ),
    );
  }
}

class _BatchCard extends StatelessWidget {
  const _BatchCard({required this.batch, required this.crop, required this.location, required this.now});
  final CropBatch batch;
  final CropType? crop;
  final GrowingLocation? location;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final b = batch;
    final days = b.daysSinceStart(now);
    return LefiCard(
      child: Gap(
        gap: 8,
        children: [
          Row(
            children: [
              IconTile(Symbols.potted_plant_rounded, size: 40),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      [crop?.name ?? 'Crop', ?(b.variety ?? crop?.variety)].join(' · '),
                      style: LefiText.body(15, weight: 700),
                    ),
                    Text(
                      [?b.batchCode, ?location?.label].join(' · ').ifEmpty('Crop batch'),
                      style: LefiText.body(12.5, color: LefiColors.subtle),
                    ),
                  ],
                ),
              ),
              ToneChip(plural(b.plantQuantity, 'plant'), tone: Tone.info),
            ],
          ),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              if (b.growthStage != null) ToneChip(humanize(b.growthStage!), tone: Tone.ok),
              if (b.startedOn != null)
                ToneChip(
                  '${humanize(b.startEvent ?? 'started')} ${brainDate(b.startedOn)}${days == null ? '' : ' · day $days'}',
                ),
              if (b.expectedHarvestOn != null) ToneChip('Harvest ~${brainDate(b.expectedHarvestOn)}'),
              if (crop?.isPlaceholder ?? false) const ToneChip('Placeholder crop', tone: Tone.warn),
            ],
          ),
          if (b.notes != null) Text(b.notes!, style: LefiText.body(13, color: LefiColors.secondary, height: 1.4)),
        ],
      ),
    );
  }
}

class _PlantRow extends StatelessWidget {
  const _PlantRow({
    required this.plant,
    required this.crop,
    required this.location,
    required this.row,
    required this.showHealth,
  });
  final BrainPlant plant;
  final CropType? crop;
  final GrowingLocation? location;
  final PlantHealthRow? row;
  final bool showHealth;

  @override
  Widget build(BuildContext context) {
    final (label, tone) = plantHealthTag(row?.latest?.health);
    return NavRow(
      icon: Symbols.potted_plant_rounded,
      tone: showHealth ? tone : Tone.ok,
      minHeight: 62,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      title: plant.title,
      titleMono: plant.name == null,
      subtitle: [
        crop?.name ?? 'Crop',
        ?location?.label,
        if (row?.openRequest != null) 'inspection requested',
      ].join(' · '),
      trailing: showHealth ? ToneChip(label, tone: tone, fontSize: 11.5) : null,
      onTap: () => context.pushDetail<void>('plant/${plant.id}'),
    );
  }
}

extension on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}
