import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/rows.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../brain/data/brain_json.dart';
import '../../tasks/presentation/brain_task_sheets.dart' show brainError;
import '../application/brain_cameras.dart';
import '../data/brain_camera_repository.dart';
import '../domain/brain_camera.dart';

Tone _originTone(String origin) => origin == 'SIMULATED' ? Tone.ai : Tone.ok;

Tone _severityTone(String s) => switch (s) {
  'high' => Tone.crit,
  'medium' => Tone.warn,
  _ => Tone.info,
};

/// Visual monitoring of a zone on the phone, read only (ADR-087, 088, 103): the cameras that look
/// at it, its photos and what Lefi AI saw in them; the live view while a camera is plugged in.
/// Photos, aiming and Lefi AI's analyses are asked for in Lefi Desktop.
class ZoneCamerasSection extends ConsumerWidget {
  const ZoneCamerasSection({super.key, required this.zoneId, required this.zoneName});
  final String zoneId;
  final String zoneName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(brainCameraRepositoryProvider) == null) return const SizedBox.shrink();
    final cams = ref.watch(brainZoneCamerasProvider(zoneId));
    final photos = ref.watch(brainZonePhotosProvider(zoneId));
    final names = {for (final c in cams.value ?? const <BrainCamera>[]) c.id: c.name};
    return Gap(
      gap: 10,
      children: [
        const SectionTitle('Visual monitoring'),
        switch (cams) {
          AsyncData(:final value) when value.isEmpty => const InfoNote(
            text: 'No camera looks at this zone. Cameras are added and pointed at zones in Lefi Desktop.',
            icon: Symbols.videocam_off_rounded,
          ),
          AsyncData(:final value) => CardList(
            children: [
              for (final (i, c) in value.indexed)
                _CameraRow(camera: c, zoneName: zoneName, last: i == value.length - 1),
            ],
          ),
          AsyncError(:final error) => InfoNote(text: 'Cameras could not be read: ${brainError(error)}'),
          _ => const SizedBox(height: 40, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
        },
        switch (photos) {
          AsyncData(:final value) when value.isEmpty =>
            (cams.value?.isEmpty ?? true)
                ? const SizedBox.shrink()
                : Text('No photos of this zone yet.', style: LefiText.body(13.5, color: LefiColors.muted)),
          AsyncData(:final value) => GridView.count(
            crossAxisCount: 3,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            padding: EdgeInsets.zero,
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
            children: [
              for (final (p, a) in value)
                _Thumb(photo: p, analysis: a, cameraName: names[p.cameraId] ?? 'Camera', zoneName: zoneName),
            ],
          ),
          AsyncError(:final error) => InfoNote(text: 'Photos could not be read: ${brainError(error)}'),
          _ => const SizedBox.shrink(),
        },
      ],
    );
  }
}

class _CameraRow extends StatelessWidget {
  const _CameraRow({required this.camera, required this.zoneName, required this.last});
  final BrainCamera camera;
  final String zoneName;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final c = camera;
    return InkWell(
      onTap: c.connected
          ? () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => BrainLiveViewScreen(camera: c)))
          : null,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          border: last ? null : const Border(bottom: BorderSide(color: LefiColors.border)),
        ),
        child: Row(
          children: [
            IconTile.tone(
              c.connected ? Symbols.videocam_rounded : Symbols.videocam_off_rounded,
              c.connected ? Tone.ok : Tone.off,
              size: 38,
              radius: 11,
              iconSize: 21,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(c.name, style: LefiText.body(14.5, weight: 700)),
                  Text(
                    [
                      c.modelName ?? 'USB camera',
                      if (c.zoneIds.length > 1) 'looks at ${plural(c.zoneIds.length, 'zone')}',
                      if (c.aiVision) 'Lefi AI looks at its photos',
                    ].join(' · '),
                    style: LefiText.body(12.5, color: LefiColors.subtle),
                  ),
                ],
              ),
            ),
            if (c.origin == 'SIMULATED') const ToneChip('SIMULATED', tone: Tone.ai),
            const SizedBox(width: 6),
            c.connected
                ? const ToneChip('Live view', tone: Tone.ok, icon: Symbols.play_arrow_rounded)
                : const ToneChip('Not plugged in', tone: Tone.off),
          ],
        ),
      ),
    );
  }
}

class _Thumb extends ConsumerWidget {
  const _Thumb({required this.photo, required this.analysis, required this.cameraName, required this.zoneName});
  final BrainCameraPhoto photo;
  final PhotoAnalysis? analysis;
  final String cameraName;
  final String zoneName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bytes = ref.watch(brainCameraPhotoBytesProvider(photo.id));
    final a = analysis;
    final findings = a != null && a.done ? a.findings.length : 0;
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Material(
        color: LefiColors.surfaceMuted,
        child: InkWell(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) =>
                  BrainCameraPhotoScreen(photo: photo, analysis: a, cameraName: cameraName, zoneName: zoneName),
            ),
          ),
          child: Stack(
            fit: StackFit.expand,
            children: [
              switch (bytes) {
                AsyncData(:final value) => Image.memory(value, fit: BoxFit.cover),
                AsyncError() => const Center(child: Icon(Symbols.broken_image_rounded, color: LefiColors.muted)),
                _ => const Center(
                  child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                ),
              },
              Positioned(left: 4, bottom: 4, child: _Label(brainWhen(photo.takenAt), Colors.black54, Colors.white)),
              if (a != null && a.done)
                Positioned(
                  right: 4,
                  top: 4,
                  child: _Label(
                    findings == 0 ? 'AI · nothing seen' : 'AI · ${plural(findings, 'finding')}',
                    findings == 0 ? Tone.ai.bg : Tone.warn.bg,
                    findings == 0 ? Tone.ai.fg : Tone.warn.fg,
                  ),
                ),
              if (photo.origin == 'SIMULATED')
                Positioned(left: 4, top: 4, child: _Label('SIMULATED', Tone.ai.bg, Tone.ai.fg)),
            ],
          ),
        ),
      ),
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text, this.bg, this.fg);
  final String text;
  final Color bg;
  final Color fg;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
    decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6)),
    child: Text(text, style: LefiText.body(10, weight: 700, color: fg)),
  );
}

/// One zone photo with what Lefi AI saw in it (always labelled as Lefi AI's, with its model).
class BrainCameraPhotoScreen extends ConsumerWidget {
  const BrainCameraPhotoScreen({
    super.key,
    required this.photo,
    required this.analysis,
    required this.cameraName,
    required this.zoneName,
  });
  final BrainCameraPhoto photo;
  final PhotoAnalysis? analysis;
  final String cameraName;
  final String zoneName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bytes = ref.watch(brainCameraPhotoBytesProvider(photo.id));
    final p = photo;
    return PushedScreen(
      title: 'Zone photo',
      backLabel: 'Back',
      body: ScrollBody(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: ColoredBox(
              color: Colors.black,
              child: AspectRatio(
                aspectRatio: 4 / 3,
                child: AsyncView(
                  bytes,
                  data: (b) => InteractiveViewer(child: Image.memory(b, fit: BoxFit.contain)),
                ),
              ),
            ),
          ),
          LefiCard(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
            child: Column(
              children: [
                KeyValueRow('Zone', zoneName),
                KeyValueRow('Camera', cameraName),
                KeyValueRow('Taken', brainWhen(p.takenAt)),
                KeyValueRow('By', p.byAi ? 'Lefi AI, for ${p.takenBy}' : p.takenBy),
                KeyValueRow(
                  'Origin',
                  '',
                  last: p.note == null,
                  valueWidget: Align(
                    alignment: Alignment.centerRight,
                    child: ToneChip(p.origin, tone: _originTone(p.origin)),
                  ),
                ),
                if (p.note != null) KeyValueRow('Note', p.note!, last: true),
              ],
            ),
          ),
          _AnalysisCard(analysis),
        ],
      ),
    );
  }
}

class _AnalysisCard extends StatelessWidget {
  const _AnalysisCard(this.a);
  final PhotoAnalysis? a;

  @override
  Widget build(BuildContext context) {
    final a = this.a;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: LefiColors.aiWash,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: LefiColors.aiBorder),
      ),
      child: Gap(
        gap: 10,
        children: [
          Row(
            children: [
              IconTile.tone(Symbols.psychiatry_rounded, Tone.ai, size: 34, radius: 10, iconSize: 19),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('What Lefi AI saw', style: LefiText.body(14.5, weight: 800, color: Tone.ai.fg)),
                    Text(
                      a == null
                          ? 'Not looked at'
                          : [analysisStatusLabel(a.status), ?a.model, if (a.at != null) brainWhen(a.at)].join(' · '),
                      style: LefiText.body(12, color: LefiColors.muted),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (a == null)
            Text(
              'Lefi AI has not looked at this photo. Lefi AI looks at scheduled photos of cameras a person '
              'allowed, when its model sees images; others are asked for in Lefi Desktop.',
              style: LefiText.body(13, color: LefiColors.secondary, height: 1.45),
            )
          else if (a.done) ...[
            if (!a.imageUsable || !a.plantsVisible)
              InfoNote(
                text: !a.imageUsable ? 'Lefi AI found the image not usable.' : 'Lefi AI saw no plants in it.',
                icon: Symbols.visibility_off_rounded,
              ),
            if (a.summary != null) Text(a.summary!, style: LefiText.body(13.5, color: LefiColors.strong, height: 1.45)),
            if (a.findings.isEmpty)
              Text('No problem seen.', style: LefiText.body(13, color: LefiColors.muted))
            else
              for (final f in a.findings)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ToneChip(humanize(f.severity), tone: _severityTone(f.severity)),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${f.label} · ${(f.confidence * 100).round()} % as the model said',
                            style: LefiText.body(13.5, weight: 700),
                          ),
                          if (f.description.isNotEmpty)
                            Text(f.description, style: LefiText.body(12.5, color: LefiColors.secondary, height: 1.4)),
                        ],
                      ),
                    ),
                  ],
                ),
            if (a.alerts.isNotEmpty)
              Text(
                '${plural(a.alerts.length, 'finding')} became an alert “Lefi AI · to confirm”.',
                style: LefiText.body(12.5, weight: 600, color: Tone.warn.fg),
              ),
            if (a.verdict != null)
              Text(
                'Judged ${a.verdict} by ${a.verdictBy ?? 'a person'}.',
                style: LefiText.body(12.5, weight: 600, color: LefiColors.strong),
              ),
          ] else if (a.error != null)
            Text(a.error!, style: LefiText.body(12.5, color: LefiColors.muted)),
          Text(
            'A draft to check by eye: Lefi AI never acts on what it sees.',
            style: LefiText.body(11.5, color: LefiColors.subtle),
          ),
        ],
      ),
    );
  }
}

/// A camera's live view, read frame by frame from Lefi Brain (`/cameras/{id}/frame`) about once a
/// second while open. Lefi Brain does not count this as watching live (only Lefi Desktop's stream),
/// so a scheduled zone photo may still aim the camera meanwhile, and the screen says so.
class BrainLiveViewScreen extends ConsumerStatefulWidget {
  const BrainLiveViewScreen({super.key, required this.camera});
  final BrainCamera camera;

  @override
  ConsumerState<BrainLiveViewScreen> createState() => _BrainLiveViewScreenState();
}

class _BrainLiveViewScreenState extends ConsumerState<BrainLiveViewScreen> {
  static const _every = Duration(milliseconds: 900);
  CameraFrame? _frame;
  String? _error;
  Timer? _timer;
  bool _busy = false;
  late final BrainCameraRepository? _repo = ref.read(brainCameraRepositoryProvider);

  @override
  void initState() {
    super.initState();
    _next();
    _timer = Timer.periodic(_every, (_) => _next());
  }

  Future<void> _next() async {
    final repo = _repo;
    if (_busy || repo == null) return;
    _busy = true;
    try {
      final f = await repo.frame(widget.camera.id);
      if (mounted) setState(() => (_frame = f, _error = null));
    } on Object catch (e) {
      if (mounted) setState(() => _error = brainError(e));
    } finally {
      _busy = false;
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final f = _frame;
    return PushedScreen(
      title: widget.camera.name,
      backLabel: 'Back',
      body: ScrollBody(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: ColoredBox(
              color: Colors.black,
              child: AspectRatio(
                aspectRatio: 16 / 9,
                child: f == null
                    ? Center(
                        child: _error == null
                            ? const CircularProgressIndicator(strokeWidth: 2, color: Colors.white)
                            : const Icon(Symbols.videocam_off_rounded, color: Colors.white54, size: 36),
                      )
                    : Stack(
                        fit: StackFit.expand,
                        children: [
                          Image.memory(f.jpeg, fit: BoxFit.contain, gaplessPlayback: true),
                          Positioned(
                            left: 8,
                            top: 8,
                            child: ToneChip(widget.camera.origin, tone: _originTone(widget.camera.origin)),
                          ),
                          Positioned(
                            right: 8,
                            bottom: 8,
                            child: _Label(brainHm(f.capturedAt), Colors.black54, Colors.white),
                          ),
                        ],
                      ),
              ),
            ),
          ),
          if (_error != null) InfoNote(text: _error!, icon: Symbols.videocam_off_rounded),
          const InfoNote(
            text:
                'View only, about one picture a second. Aiming, zoom and photos are done in Lefi Desktop; '
                'a scheduled zone photo may move the camera while you watch here.',
            icon: Symbols.visibility_rounded,
          ),
        ],
      ),
    );
  }
}
