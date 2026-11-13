// Lefi Brain's AI Control & Safety (ADR-085) → what the phone shows (ADR-102). Fixture values are TEST.
import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/ai_control/domain/brain_ai_control.dart';
import 'package:lefi_mobile/features/ai_control/presentation/brain_ai_control_screen.dart';

Map<String, dynamic> control({bool kill = false, String state = 'available', String? note}) => {
  'state': state,
  'reason': 'TEST reason',
  'model': 'TEST-model',
  'kill_switch': kill,
  'stopped_note': note,
  'busy': 0,
  'parts': [
    {'name': 'Lefi AI assistant (chat)', 'kind': 'ai', 'state': kill ? 'stopped' : 'online', 'detail': ''},
    {'name': 'Rules engine and alerts', 'kind': 'no_ai', 'state': 'online', 'detail': 'watching'},
  ],
  'actions': [
    {
      'name': 'Aim, zoom or photograph a camera',
      'area': 'Cameras',
      'mode': 'allowed_per_camera',
      'detail': 'TEST',
      'cameras': ['TEST cam'],
    },
    {'name': 'Apply pesticide', 'area': 'Crop protection', 'mode': 'not_available', 'detail': 'Not allowed'},
  ],
  'settings': [
    {'name': 'Model', 'value': 'TEST-model'},
  ],
  'tools': ['list_zones'],
  'can_stop': true,
  'can_resume': false,
};

void main() {
  test('available, parts split by whether they need Lefi AI, allowlist per camera', () {
    final c = BrainAiControl.fromJson(control());
    expect(c.available, isTrue);
    expect(c.stopped, isFalse);
    expect(c.parts.where((p) => p.needsAi).single.name, 'Lefi AI assistant (chat)');
    expect(c.parts.where((p) => !p.needsAi).single.state, 'online');
    expect(c.actions.first.allowed, isTrue);
    expect(c.actions.first.cameras, ['TEST cam']);
    expect(c.actions.last.allowed, isFalse);
    expect(c.settings.single, ('Model', 'TEST-model'));
    expect(c.canStop && !c.canResume, isTrue);
  });

  test('a stop is never shown as available, even if the AI node answers', () {
    final c = BrainAiControl.fromJson(
      control(kill: true, note: 'stopped by TEST (t) at 2026-11-13T10:00:00+00:00: TEST why'),
    );
    expect(c.available, isFalse);
    expect(c.stopped, isTrue);
    final shown = humanizeStopNote(c.stoppedNote!);
    expect(shown, startsWith('Stopped by TEST (t) · '));
    expect(shown, endsWith('“TEST why”'));
  });

  test('an unknown note is shown as Lefi Brain wrote it; unreachable is not available', () {
    expect(humanizeStopNote('stopped from the CLI'), 'stopped from the CLI');
    expect(BrainAiControl.fromJson(control(state: 'unreachable')).available, isFalse);
    expect(aiPartStateLabel('not_built'), 'Not built yet');
  });
}
