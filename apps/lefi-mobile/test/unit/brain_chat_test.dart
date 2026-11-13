// Lefi AI's chat (ADR-067) → the phone (ADR-107). The JSON is a test fixture shaped like Lefi Brain's
// `ConversationOut` and `AssistantStatusOut`; it is not an answer from a model.
import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/assistant/domain/brain_chat.dart';

void main() {
  test('status: available only when the state is available and the emergency stop is off', () {
    final s = ChatStatus.fromJson({
      'state': 'available',
      'reason': '',
      'model': 'TEST-model:1b',
      'kill_switch': false,
      'busy': 0,
      'tools': [
        {'name': 'greenhouse_overview', 'label': 'TEST overview'},
        {'name': 'cameras', 'label': 'TEST cameras'},
      ],
      'can_write': false,
    });
    expect(s.available, isTrue);
    expect(s.has('cameras'), isTrue);
    expect(s.has('camera_photo'), isFalse);
    expect(ChatStatus.fromJson({'state': 'available', 'kill_switch': true}).available, isFalse);
    expect(ChatStatus.fromJson({'state': 'unavailable', 'kill_switch': false}).available, isFalse);
  });

  test('an answer keeps its model, what it read, what the role did not allow, photos and camera moves', () {
    final c = ChatConversation.fromJson({
      'id': 'c1',
      'title': 'TEST',
      'created_at': '2026-11-13T10:00:00+00:00',
      'updated_at': '2026-11-13T10:00:05+00:00',
      'messages': [
        {
          'id': 'm1',
          'role': 'user',
          'content': 'TEST question',
          'state': 'done',
          'created_at': '2026-11-13T10:00:00+00:00',
          'tools': [],
        },
        {
          'id': 'm2',
          'role': 'assistant',
          'content': 'TEST answer',
          'state': 'done',
          'created_at': '2026-11-13T10:00:01+00:00',
          'model': 'TEST-model:1b',
          'tools': [
            {'name': 'zones', 'label': 'Zones', 'outcome': 'ok', 'arguments': {}, 'detail': null},
            {'name': 'zones', 'label': 'Zones', 'outcome': 'ok', 'arguments': {}, 'detail': null},
            {'name': 'field_devices', 'label': 'Devices', 'outcome': 'denied', 'arguments': {}, 'detail': null},
            {'name': 'camera_photo', 'label': 'Photo', 'outcome': 'ok', 'arguments': {}, 'detail': 'photo:p9'},
            {'name': 'camera_control', 'label': 'Aim', 'outcome': 'ok', 'arguments': {}, 'detail': null},
          ],
        },
      ],
    });
    expect(c.thinking, isFalse);
    expect(c.messages.first.fromPerson, isTrue);
    final a = c.messages.last;
    expect(a.fromPerson, isFalse);
    expect(a.model, 'TEST-model:1b');
    expect(a.read, ['Zones', 'Photo', 'Aim']);
    expect(a.denied, ['Devices']);
    expect(a.photoIds, ['p9']);
    expect(a.movedCamera, isTrue);
  });

  test('a thinking answer makes the conversation thinking', () {
    final c = ChatConversation.fromJson({
      'id': 'c1',
      'messages': [
        {'id': 'm2', 'role': 'assistant', 'content': '', 'state': 'thinking', 'tools': []},
      ],
    });
    expect(c.thinking, isTrue);
  });

  test('answer text: bullets, numbers, bold and headings; nothing else is interpreted', () {
    final l = chatLines('# Zone A\n\nAll **fine** here.\n- one\n* two\n2. three\n<b>x</b>');
    expect(l.length, 6);
    expect(l[0].spans.single.text, 'Zone A');
    expect(l[1].spans.map((s) => (s.text, s.bold)).toList(), [('All ', false), ('fine', true), (' here.', false)]);
    expect((l[2].bullet, l[2].marker, l[2].spans.single.text), (true, '•', 'one'));
    expect((l[3].bullet, l[3].marker), (true, '•'));
    expect((l[4].bullet, l[4].marker, l[4].spans.single.text), (true, '2.', 'three'));
    expect((l[5].bullet, l[5].spans.single.text), (false, '<b>x</b>')); // shown as text, never as HTML
    expect(chatLines('an **unclosed bold').single.spans.every((s) => !s.bold), isTrue);
  });
}
