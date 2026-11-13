// The robot screen (ADR-106) draws a TEST robot on the phone's width without overflow: what it does,
// the command it runs, where it is (with the map). The data is a test fixture, not a real robot.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/brain/data/brain_auth_repository.dart';
import 'package:lefi_mobile/features/brain/data/session_store.dart';
import 'package:lefi_mobile/features/brain/domain/brain_pairing.dart';
import 'package:lefi_mobile/features/robot/application/brain_robots.dart';
import 'package:lefi_mobile/features/robot/data/brain_robot_repository.dart';
import 'package:lefi_mobile/features/robot/domain/brain_robot.dart';
import 'package:lefi_mobile/features/robot/presentation/brain_robot_screen.dart';
import 'package:lefi_mobile/features/robot/presentation/robot_map.dart';

const _paired = BrainPairing(
  url: 'https://lefi-main.local:8443',
  deviceId: '11111111-2222-3333-4444-555555555555',
  certPem: 'TEST',
  caPem: 'TEST',
  gatewayCaPem: 'TEST',
  keyPem: 'TEST',
  expiresAt: '2027-11-10T00:00:00Z',
);

final _scene = RobotScene.fromJson({
  'name': 'TEST greenhouse',
  'bounds': {'x_min': -1.5, 'x_max': 6.5, 'y_min': -2.6, 'y_max': 2.6},
  'benches': [
    {'label': 'TEST bench', 'x': 3.0, 'y': 1.25, 'length': 4.4, 'width': 0.8},
  ],
  'stations': [
    {
      'id': 'p2',
      'label': 'TEST Plant 2',
      'kind': 'tomato',
      'x': 3.4,
      'y': 1.25,
      'approach': {'x': 3.4, 'y': 0.5, 'yaw_deg': 90},
    },
  ],
});

final _robot = BrainRobot.fromJson({
  'id': 'mh3-sim',
  'name': 'TEST MH3 (simulated)',
  'model': 'TEST model',
  'origin': 'SIMULATED',
  'connection': 'online',
  'backend': 'lite',
  'state': {
    'pose': {'x': 2.0, 'y': 0.4, 'yaw_deg': 10},
    'phase': 'driving',
    'moving': true,
    'linear_mps': 0.3,
    'head_pitch': 0,
    'odometry_m': 2.1,
    'active_command': {'command_id': 'c1', 'kind': 'go_to', 'state': 'running'},
  },
  'active_mission': {
    'id': 'm1',
    'kind': 'inspect',
    'station_id': 'p2',
    'station_label': 'TEST Plant 2',
    'state': 'NAVIGATING',
    'active': true,
    'created_at': '2026-11-13T10:00:00Z',
    'events': [],
  },
  'power': 'on',
});

final _cmd = RobotCommand.fromJson({
  'id': 'c1',
  'kind': 'go_to',
  'args': {'station_id': 'p2'},
  'state': 'running',
  'actor': 'lefi-brain',
  'sent_at': '2026-11-13T10:00:01Z',
});

void main() {
  testWidgets(
    'the robot screen says what it does, the command it runs and where it is; cancel and safe stop are offered',
    (tester) async {
      tester.view.physicalSize = const Size(390 * 3, 1800 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final brain = BrainAuthRepository(_paired, sessions: MemorySessionStore());
      addTearDown(brain.close);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            brainRobotRepositoryProvider.overrideWithValue(BrainRobotRepository(brain)),
            brainRobotLiveProvider.overrideWith(
              (ref) async => RobotLive(robot: _robot, commands: [_cmd], missions: const [], scene: _scene),
            ),
          ],
          child: const MaterialApp(home: Scaffold(body: BrainRobotScreen())),
        ),
      );
      await tester.pump();
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(find.text('Driving to TEST Plant 2'), findsOneWidget);
      expect(find.text('Go to TEST Plant 2'), findsWidgets);
      expect(find.text('Near TEST Plant 2 · 1.4 m away'), findsOneWidget);
      expect(find.byType(RobotMap), findsOneWidget);
      expect(find.textContaining('SIMULATED robot'), findsOneWidget);
      expect(find.text('Safe stop'), findsOneWidget);
      expect(find.text('Cancel mission'), findsOneWidget);
    },
  );
}
