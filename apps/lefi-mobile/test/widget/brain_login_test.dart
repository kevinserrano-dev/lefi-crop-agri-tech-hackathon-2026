import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/app/app.dart';
import 'package:lefi_mobile/features/brain/application/brain_connection.dart';
import 'package:lefi_mobile/features/brain/data/pairing_store.dart';
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

Future<void> _pump(WidgetTester tester, PairingStore store) async {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        pairingStoreProvider.overrideWithValue(store),
        sessionStoreProvider.overrideWithValue(MemorySessionStore()),
      ],
      child: const LefiApp(),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('paired with Lefi Brain: username sign-in, no demo accounts, forget is offered', (tester) async {
    final store = MemoryPairingStore(_paired);
    await _pump(tester, store);
    expect(find.text('Username'), findsOneWidget);
    expect(find.text('Work email'), findsNothing);
    expect(find.text('Demo accounts'), findsNothing);
    expect(find.text('https://lefi-main.local:8443'), findsOneWidget);
    expect(find.text('Forget this Lefi Brain'), findsOneWidget);

    // Empty fields are refused before anything is sent.
    await tester.ensureVisible(find.text('Sign in'));
    await tester.tap(find.text('Sign in'));
    await tester.pump();
    expect(find.text('Enter your username.'), findsOneWidget);

    await tester.ensureVisible(find.text('Forget this Lefi Brain'));
    await tester.tap(find.text('Forget this Lefi Brain'));
    await tester.pumpAndSettle();
    expect(find.text('Work email'), findsOneWidget);
    expect(await store.load(), isNull, reason: 'the pairing and its key are deleted');
  });

  testWidgets('not paired: demo accounts and a way to connect to Lefi Brain', (tester) async {
    await _pump(tester, MemoryPairingStore());
    expect(find.text('Work email'), findsOneWidget);
    await tester.ensureVisible(find.text('Connect to Lefi Brain'));
    await tester.tap(find.text('Connect to Lefi Brain'));
    await tester.pumpAndSettle();
    expect(find.text('Pairing code'), findsOneWidget);
    await tester.enterText(find.byType(TextField).at(1), 'ABCD');
    await tester.tap(find.text('Pair'));
    await tester.pumpAndSettle();
    expect(find.textContaining('That code is not complete'), findsOneWidget);
  });

  test('addresses are read as a person types them', () {
    expect(parseBrainOrigin('lefi-main.local'), 'https://lefi-main.local:8443');
    expect(parseBrainOrigin(' 192.168.8.10 '), 'https://192.168.8.10:8443');
    expect(parseBrainOrigin('https://lefi-main.local:9443/'), 'https://lefi-main.local:9443');
    expect(() => parseBrainOrigin('http://lefi-main.local'), throwsA(isA<BrainException>()));
    expect(() => parseBrainOrigin('lefi-main.local/api'), throwsA(isA<BrainException>()));
  });
}
