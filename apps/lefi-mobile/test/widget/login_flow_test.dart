import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/app/app.dart';
import 'package:lefi_mobile/features/brain/application/brain_connection.dart';
import 'package:lefi_mobile/features/brain/data/pairing_store.dart';

void main() {
  testWidgets('signed-out users land on login; a demo worker reaches Home', (tester) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(overrides: [pairingStoreProvider.overrideWithValue(MemoryPairingStore())], child: const LefiApp()),
    );
    await tester.pumpAndSettle();
    expect(find.text('Sign in to your shift'), findsOneWidget);
    expect(
      find.byWidgetPredicate((w) => w is Banner && w.message == 'DEMO DATA'),
      findsOneWidget,
      reason: 'fixture data must be labelled',
    );

    await tester.ensureVisible(find.text('Amrit Gill'));
    await tester.tap(find.text('Amrit Gill'));
    await tester.pump();
    await tester.ensureVisible(find.text('Sign in'));
    await tester.tap(find.text('Sign in'));
    // Demo repositories simulate network latency.
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 500));
    }

    expect(find.text('Good morning, Amrit'), findsOneWidget);
    expect(find.text('Report an issue'), findsOneWidget);
    // Workers cannot trigger the AI kill switch.
    expect(find.text('Stop AI'), findsNothing);
  });
}
