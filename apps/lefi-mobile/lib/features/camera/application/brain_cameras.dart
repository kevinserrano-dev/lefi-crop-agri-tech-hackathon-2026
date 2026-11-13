import 'dart:async';
import 'dart:typed_data';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../data/brain_camera_repository.dart';
import '../domain/brain_camera.dart';

part 'brain_cameras.g.dart';

/// Zone photos are asked again while the zone is open (scheduled photos keep arriving).
const brainZonePhotosPoll = Duration(seconds: 30);

/// While an analysis is pending, it is asked again.
const brainAnalysisPoll = Duration(seconds: 10);

/// Zone cameras on Lefi Brain for roles with `nav.devices` (administrator, manager, supervisor,
/// maintenance); null otherwise.
@Riverpod(keepAlive: true)
BrainCameraRepository? brainCameraRepository(Ref ref) {
  final auth = ref.watch(activeAuthRepositoryProvider);
  ref.watch(sessionProvider);
  if (auth is! BrainAuthRepository || !auth.can('nav.devices')) return null;
  return BrainCameraRepository(auth);
}

BrainCameraRepository _repo(Ref ref) =>
    ref.watch(brainCameraRepositoryProvider) ?? (throw StateError('Not connected to Lefi Brain.'));

/// The active cameras that look at this zone (ADR-087).
@riverpod
Future<List<BrainCamera>> brainZoneCameras(Ref ref, String zoneId) async {
  final all = await _repo(ref).cameras();
  return [
    for (final c in all)
      if (c.active && c.looksAt(zoneId)) c,
  ];
}

/// The zone's photos with Lefi AI's latest analysis of each (null = never looked at).
@riverpod
Future<List<(BrainCameraPhoto, PhotoAnalysis?)>> brainZonePhotos(Ref ref, String zoneId) async {
  final repo = _repo(ref);
  final photos = await repo.zonePhotos(zoneId);
  final analyses = await repo.analyses([for (final p in photos) p.id]);
  final latest = <String, PhotoAnalysis>{};
  for (final a in analyses) {
    latest.putIfAbsent(a.photoId, () => a); // newest first
  }
  final pending = latest.values.any((a) => a.status == 'pending');
  final timer = Timer(pending ? brainAnalysisPoll : brainZonePhotosPoll, ref.invalidateSelf);
  ref.onDispose(timer.cancel);
  return [for (final p in photos) (p, latest[p.id])];
}

@riverpod
Future<Uint8List> brainCameraPhotoBytes(Ref ref, String photoId) => _repo(ref).photoBytes(photoId);
