// Lefi Brain's zone cameras, photos and Lefi AI's looks (ADR-087, 088) → the phone, read only (ADR-103).
import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/camera/domain/brain_camera.dart';

void main() {
  test('a camera looks at its zones (ids compared without case), retired is not active', () {
    final c = BrainCamera.fromJson({
      'id': 'c1',
      'name': 'TEST cam',
      'model_name': null,
      'zone_ids': ['AB-1', 'z2'],
      'status': 'RETIRED',
      'origin': 'LIVE',
      'connection': 'not_connected',
      'ai_vision': true,
    });
    expect(c.looksAt('ab-1'), isTrue);
    expect(c.looksAt('z3'), isFalse);
    expect(c.active, isFalse);
    expect(c.connected, isFalse);
    expect(c.aiVision, isTrue);
  });

  test('a photo keeps who took it, whether Lefi AI did, and its origin', () {
    final p = BrainCameraPhoto.fromJson({
      'id': 'p1',
      'camera_id': 'c1',
      'taken_at': '2026-11-13T10:00:00Z',
      'taken_by': 'Lefi AI for TEST',
      'by_ai': true,
      'origin': 'SIMULATED',
      'note': null,
      'zone_ids': ['z1'],
    });
    expect(p.byAi, isTrue);
    expect(p.origin, 'SIMULATED');
    expect(p.takenAt, isNotNull);
  });

  test('only a done analysis has findings; invalid shows nothing', () {
    final done = PhotoAnalysis.fromJson({
      'photo_id': 'p1',
      'status': 'done',
      'model': 'TEST-vision',
      'report': {
        'image_usable': true,
        'plants_visible': true,
        'summary': 'TEST summary',
        'findings': [
          {'kind': 'leaf_spots', 'label': 'Leaf spots', 'severity': 'medium', 'confidence': 0.7, 'description': 'TEST'},
        ],
      },
      'alerts': ['leaf_spots'],
      'verdict': null,
      'requested_at': '2026-11-13T10:00:00Z',
    });
    expect(done.done, isTrue);
    expect(done.findings.single.label, 'Leaf spots');
    expect(done.findings.single.confidence, 0.7);
    expect(done.alerts, ['leaf_spots']);
    final invalid = PhotoAnalysis.fromJson({'photo_id': 'p1', 'status': 'invalid', 'report': null, 'error': 'TEST'});
    expect(invalid.done, isFalse);
    expect(invalid.findings, isEmpty);
    expect(analysisStatusLabel('invalid'), contains('nothing is shown'));
  });
}
