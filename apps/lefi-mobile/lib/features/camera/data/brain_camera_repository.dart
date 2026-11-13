import 'dart:convert';
import 'dart:typed_data';

import '../../brain/data/brain_auth_repository.dart';
import '../domain/brain_camera.dart';

/// One frame of a camera's live view, as Lefi Brain read it.
class CameraFrame {
  const CameraFrame(this.jpeg, this.capturedAt);
  final Uint8List jpeg;
  final DateTime? capturedAt;
}

/// Zone cameras through Lefi Gateway, read only on the phone (ADR-103): cameras, zone photos, Lefi
/// AI's findings and the live view (`nav.devices`). Photos, commands, analyses and verdicts are
/// made in Lefi Desktop.
class BrainCameraRepository {
  BrainCameraRepository(this.brain);
  final BrainAuthRepository brain;

  Future<List<BrainCamera>> cameras() async {
    final body = (await brain.api('GET', '/cameras')).body;
    return [
      for (final c in body is List ? body : const [])
        if (c is Map<String, dynamic>) BrainCamera.fromJson(c),
    ];
  }

  Future<List<BrainCameraPhoto>> zonePhotos(String zoneId, {int limit = 24}) async {
    final body = (await brain.api(
      'GET',
      '/camera-photos?zone_id=${Uri.encodeQueryComponent(zoneId)}&limit=$limit',
    )).body;
    return [
      for (final p in body is List ? body : const [])
        if (p is Map<String, dynamic>) BrainCameraPhoto.fromJson(p),
    ];
  }

  Future<Uint8List> photoBytes(String photoId) async {
    final a = await brain.api('GET', '/camera-photos/$photoId');
    return base64Decode(a.json['jpeg_base64'] as String? ?? '');
  }

  /// Lefi AI's analyses of these photos, newest first (at most 100 ids).
  Future<List<PhotoAnalysis>> analyses(List<String> photoIds) async {
    if (photoIds.isEmpty) return const [];
    final ids = photoIds.take(100).join(',');
    final body = (await brain.api('GET', '/photo-analyses?photo_ids=$ids')).body;
    return [
      for (final a in body is List ? body : const [])
        if (a is Map<String, dynamic>) PhotoAnalysis.fromJson(a),
    ];
  }

  Future<CameraFrame> frame(String cameraId) async {
    final j = (await brain.api('GET', '/cameras/$cameraId/frame')).json;
    return CameraFrame(
      base64Decode(j['jpeg_base64'] as String? ?? ''),
      DateTime.tryParse('${j['captured_at']}')?.toLocal(),
    );
  }
}
