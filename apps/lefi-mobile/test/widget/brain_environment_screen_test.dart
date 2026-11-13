// The Environmental Monitoring screen (ADR-108) on the phone's width with a TEST zone: values, a chart
// with its stats, the species' range marked illustrative, and why a crop gives none. Fixtures only.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/brain/data/brain_auth_repository.dart';
import 'package:lefi_mobile/features/brain/data/session_store.dart';
import 'package:lefi_mobile/features/brain/domain/brain_pairing.dart';
import 'package:lefi_mobile/features/environment/application/brain_environment.dart';
import 'package:lefi_mobile/features/environment/domain/brain_environment.dart';
import 'package:lefi_mobile/features/environment/presentation/brain_environment_screen.dart';
import 'package:lefi_mobile/features/environment/presentation/env_chart.dart';

import '../unit/brain_environment_test.dart' show fixture;

const _paired = BrainPairing(
  url: 'https://lefi-main.local:8443',
  deviceId: '11111111-2222-3333-4444-555555555555',
  certPem: 'TEST',
  caPem: 'TEST',
  gatewayCaPem: 'TEST',
  keyPem: 'TEST',
  expiresAt: '2027-11-10T00:00:00Z',
);

void main() {
  testWidgets('the zone, its history and its ranges, without overflow', (tester) async {
    tester.view.physicalSize = const Size(390 * 3, 2400 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final brain = BrainAuthRepository(_paired, sessions: MemorySessionStore());
    addTearDown(brain.close);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          brainEnvironmentAuthProvider.overrideWithValue(brain),
          brainEnvironmentProvider('z1', '24h').overrideWith((ref) async => BrainEnvironment.fromJson(fixture())),
        ],
        child: const MaterialApp(
          home: Scaffold(body: BrainEnvironmentScreen(zoneId: 'z1')),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.byType(EnvChart), findsOneWidget);
    expect(find.text('100 %'), findsOneWidget);
    expect(find.textContaining('Illustrative'), findsOneWidget);
    expect(find.textContaining('No profile for this crop'), findsOneWidget);
    expect(find.textContaining('TEST disabled by design'), findsOneWidget);
  });
}
