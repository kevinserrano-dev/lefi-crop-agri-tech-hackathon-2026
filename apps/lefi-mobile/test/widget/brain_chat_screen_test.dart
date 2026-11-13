// The chat screen (ADR-107) on the phone's width: a TEST answer is labelled as AI with its model and
// what it read; while Lefi AI is stopped the composer is gone. Fixtures only, no model.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/assistant/application/brain_chat.dart';
import 'package:lefi_mobile/features/assistant/data/brain_chat_repository.dart';
import 'package:lefi_mobile/features/assistant/domain/brain_chat.dart';
import 'package:lefi_mobile/features/assistant/presentation/brain_chat_screen.dart';
import 'package:lefi_mobile/features/brain/data/brain_auth_repository.dart';
import 'package:lefi_mobile/features/brain/data/session_store.dart';
import 'package:lefi_mobile/features/brain/domain/brain_pairing.dart';

const _paired = BrainPairing(
  url: 'https://lefi-main.local:8443',
  deviceId: '11111111-2222-3333-4444-555555555555',
  certPem: 'TEST',
  caPem: 'TEST',
  gatewayCaPem: 'TEST',
  keyPem: 'TEST',
  expiresAt: '2027-11-10T00:00:00Z',
);

ChatStatus _status({bool stopped = false}) => ChatStatus.fromJson({
  'state': stopped ? 'stopped' : 'available',
  'reason': stopped ? 'TEST stop' : '',
  'model': 'TEST-model:1b',
  'kill_switch': stopped,
  'tools': [
    {'name': 'greenhouse_overview', 'label': 'TEST overview'},
  ],
});

Future<void> _pump(WidgetTester tester, ChatStatus status) async {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final brain = BrainAuthRepository(_paired, sessions: MemorySessionStore());
  addTearDown(brain.close);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        brainChatRepositoryProvider.overrideWithValue(BrainChatRepository(brain)),
        brainChatStatusProvider.overrideWith((ref) async => status),
        brainChatConversationsProvider.overrideWith(
          (ref) async => [
            ChatConversationSummary.fromJson({'id': 'c1', 'title': 'TEST earlier'}),
          ],
        ),
      ],
      child: const MaterialApp(home: Scaffold(body: BrainChatScreen())),
    ),
  );
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets('available: hint, what Lefi may read, earlier conversations and the composer', (tester) async {
    await _pump(tester, _status());
    expect(tester.takeException(), isNull);
    expect(find.textContaining('Available · TEST-model:1b'), findsOneWidget);
    expect(find.textContaining('cannot change anything'), findsOneWidget);
    expect(find.text('TEST overview'), findsOneWidget);
    expect(find.text('TEST earlier'), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);
  });

  testWidgets('stopped: says so and offers no composer', (tester) async {
    await _pump(tester, _status(stopped: true));
    expect(tester.takeException(), isNull);
    expect(find.textContaining('Stopped · TEST stop'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);
  });
}
