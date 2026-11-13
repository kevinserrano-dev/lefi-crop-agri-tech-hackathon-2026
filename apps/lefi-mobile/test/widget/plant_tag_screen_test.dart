// A plant's NFC tag (ADR-109): a tag whose id Lefi Brain does not know, or Lefi Brain not answering,
// shows one plain "can't find this plant right now" screen — never an error text or a made-up plant.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/brain/data/brain_auth_repository.dart';
import 'package:lefi_mobile/features/brain/data/session_store.dart';
import 'package:lefi_mobile/features/brain/domain/brain_pairing.dart';
import 'package:lefi_mobile/features/greenhouse/application/brain_greenhouse.dart';
import 'package:lefi_mobile/features/greenhouse/data/brain_greenhouse_repository.dart';
import 'package:lefi_mobile/features/greenhouse/presentation/plant_tag_screen.dart';

const _paired = BrainPairing(
  url: 'https://lefi-main.local:8443',
  deviceId: '11111111-2222-3333-4444-555555555555',
  certPem: 'TEST',
  caPem: 'TEST',
  gatewayCaPem: 'TEST',
  keyPem: 'TEST',
  expiresAt: '2027-11-10T00:00:00Z',
);

Future<void> _pump(WidgetTester tester, Override lookup) async {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final brain = BrainAuthRepository(_paired, sessions: MemorySessionStore());
  addTearDown(brain.close);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [brainGreenhouseRepositoryProvider.overrideWithValue(BrainGreenhouseRepository(brain)), lookup],
      child: const MaterialApp(home: PlantTagScreen(plantRef: 'ggggfgd9gfd')),
    ),
  );
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets('an id Lefi Brain does not know: the plant cannot be found right now', (tester) async {
    await _pump(tester, brainPlantByRefProvider('ggggfgd9gfd').overrideWith((ref) async => null));
    expect(tester.takeException(), isNull);
    expect(find.text('We can’t find this plant right now'), findsOneWidget);
    expect(find.text('Please try again later.'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
  });

  testWidgets('Lefi Brain not answering: the same screen, no error text', (tester) async {
    await _pump(
      tester,
      brainPlantByRefProvider('ggggfgd9gfd').overrideWith((ref) async => throw Exception('TEST unreachable')),
    );
    expect(tester.takeException(), isNull);
    expect(find.text('We can’t find this plant right now'), findsOneWidget);
    expect(find.textContaining('TEST unreachable'), findsNothing);
  });
}
