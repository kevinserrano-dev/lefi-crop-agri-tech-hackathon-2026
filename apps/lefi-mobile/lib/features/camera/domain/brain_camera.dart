import '../../brain/data/brain_json.dart';

/// A USB camera on Lefi Brain's PC (ADR-073, 087): the zones it looks at and whether it is plugged in.
class BrainCamera {
  const BrainCamera({
    required this.id,
    required this.name,
    required this.zoneIds,
    required this.connection,
    required this.origin,
    required this.active,
    required this.aiVision,
    this.modelName,
  });
  factory BrainCamera.fromJson(Map<String, dynamic> j) => BrainCamera(
    id: js(j['id']),
    name: js(j['name'], 'Camera'),
    modelName: jsn(j['model_name']),
    zoneIds: jstrs(j['zone_ids']),
    connection: js(j['connection'], 'unknown'),
    origin: js(j['origin'], 'LIVE'),
    active: j['status'] != 'RETIRED',
    aiVision: jb(j['ai_vision']),
  );
  final String id;
  final String name;
  final String? modelName;
  final List<String> zoneIds;

  /// connected · not_connected · unknown
  final String connection;
  final String origin;
  final bool active;

  /// A person allowed Lefi AI to look at its scheduled photos (ADR-088).
  final bool aiVision;

  bool get connected => connection == 'connected';
  bool looksAt(String zoneId) => zoneIds.any((z) => z.toLowerCase() == zoneId.toLowerCase());
}

/// A photo Lefi Brain keeps, with the zones its camera looked at when it was taken (ADR-087).
class BrainCameraPhoto {
  const BrainCameraPhoto({
    required this.id,
    required this.cameraId,
    required this.takenBy,
    required this.byAi,
    required this.origin,
    required this.zoneIds,
    this.takenAt,
    this.note,
  });
  factory BrainCameraPhoto.fromJson(Map<String, dynamic> j) => BrainCameraPhoto(
    id: js(j['id']),
    cameraId: js(j['camera_id']),
    takenAt: jt(j['taken_at']),
    takenBy: js(j['taken_by']),
    byAi: jb(j['by_ai']),
    origin: js(j['origin'], 'LIVE'),
    note: jsn(j['note']),
    zoneIds: jstrs(j['zone_ids']),
  );
  final String id;
  final String cameraId;
  final DateTime? takenAt;

  /// Who took it, as Lefi Brain names them ("Lefi Brain (schedule)" for scheduled zone photos).
  final String takenBy;

  /// Taken by Lefi AI for the person in [takenBy].
  final bool byAi;
  final String origin;
  final String? note;
  final List<String> zoneIds;
}

class VisionFinding {
  const VisionFinding({
    required this.label,
    required this.severity,
    required this.confidence,
    required this.description,
  });
  factory VisionFinding.fromJson(Map<String, dynamic> j) => VisionFinding(
    label: js(j['label'], humanize(js(j['kind']))),
    severity: js(j['severity'], 'low'),
    confidence: jd(j['confidence']) ?? 0,
    description: js(j['description']),
  );
  final String label;

  /// low · medium · high
  final String severity;

  /// As the model said it, not a measured accuracy.
  final double confidence;
  final String description;
}

/// Lefi AI's look at a photo (ADR-088). Only `done` carries a report the schema accepted.
class PhotoAnalysis {
  const PhotoAnalysis({
    required this.photoId,
    required this.status,
    required this.findings,
    required this.alerts,
    this.model,
    this.summary,
    this.imageUsable = true,
    this.plantsVisible = true,
    this.error,
    this.at,
    this.verdict,
    this.verdictBy,
  });
  factory PhotoAnalysis.fromJson(Map<String, dynamic> j) {
    final r = j['report'] is Map<String, dynamic> ? j['report'] as Map<String, dynamic> : null;
    return PhotoAnalysis(
      photoId: js(j['photo_id']),
      status: js(j['status'], 'unavailable'),
      model: jsn(j['model']),
      summary: r == null ? null : jsn(r['summary']),
      imageUsable: r == null || jb(r['image_usable']),
      plantsVisible: r == null || jb(r['plants_visible']),
      findings: [for (final f in jl(r?['findings'])) VisionFinding.fromJson(f)],
      alerts: jstrs(j['alerts']),
      error: jsn(j['error']),
      at: jt(j['finished_at']) ?? jt(j['requested_at']),
      verdict: jsn(j['verdict']),
      verdictBy: jsn(j['verdict_by']),
    );
  }

  final String photoId;

  /// pending · done · invalid · unavailable · failed
  final String status;
  final String? model;
  final String? summary;
  final bool imageUsable;
  final bool plantsVisible;
  final List<VisionFinding> findings;

  /// Kinds of findings that raised an alert "Lefi AI · to confirm".
  final List<String> alerts;
  final String? error;
  final DateTime? at;

  /// A person's judgement in Lefi Desktop: correct · wrong.
  final String? verdict;
  final String? verdictBy;

  bool get done => status == 'done';
}

String analysisStatusLabel(String s) => switch (s) {
  'pending' => 'Lefi AI is looking…',
  'done' => 'Looked at by Lefi AI',
  'invalid' => 'Lefi AI’s answer did not fit the expected form; nothing is shown',
  'unavailable' => 'Lefi AI could not look (no model that sees images)',
  'failed' => 'Lefi AI could not finish',
  _ => humanize(s),
};
