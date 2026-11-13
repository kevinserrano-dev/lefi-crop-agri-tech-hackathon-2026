import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../features/ai_control/presentation/brain_ai_control_screen.dart';
import '../../features/alerts/presentation/alerts_screen.dart';
import '../../features/assistant/presentation/brain_chat_screen.dart';
import '../../features/auth/application/session.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/brain/presentation/connect_screen.dart';
import '../../features/camera/presentation/camera_screen.dart';
import '../../features/devices/presentation/devices_screen.dart';
import '../../features/environment/presentation/brain_environment_screen.dart';
import '../../features/greenhouse/presentation/greenhouse_screen.dart';
import '../../features/greenhouse/presentation/plant_screen.dart';
import '../../features/greenhouse/presentation/plant_tag_screen.dart';
import '../../features/greenhouse/presentation/zone_screen.dart';
import '../../features/handover/presentation/handover_screen.dart';
import '../../features/home/presentation/home_screen.dart';
import '../../features/inspection/presentation/inspection_screen.dart';
import '../../features/profile/presentation/notification_prefs_screen.dart';
import '../../features/profile/presentation/profile_screen.dart';
import '../../features/robot/presentation/brain_robot_screen.dart';
import '../../features/tasks/presentation/task_detail_screen.dart';
import '../../features/tasks/presentation/tasks_screen.dart';
import '../shell/app_shell.dart';
import 'routes.dart';

part 'app_router.g.dart';

final _rootKey = GlobalKey<NavigatorState>(debugLabel: 'root');

/// Detail routes available inside every tab.
List<RouteBase> _details({bool withPrefs = false}) => [
  GoRoute(
    path: Routes.task,
    builder: (_, s) => TaskDetailScreen(taskId: s.pathParameters['taskId']!),
  ),
  GoRoute(
    path: Routes.zone,
    builder: (_, s) => ZoneScreen(zoneId: s.pathParameters['zoneId']!),
  ),
  GoRoute(
    path: Routes.plant,
    builder: (_, s) => PlantScreen(plantId: s.pathParameters['plantId']!),
  ),
  GoRoute(
    path: Routes.inspect,
    builder: (_, s) => InspectionScreen(plantId: s.uri.queryParameters['plant']),
  ),
  GoRoute(path: Routes.handover, builder: (_, _) => const HandoverScreen()),
  GoRoute(path: Routes.aiControl, builder: (_, _) => const BrainAiControlScreen()),
  GoRoute(path: Routes.robot, builder: (_, _) => const BrainRobotScreen()),
  GoRoute(path: Routes.chat, builder: (_, _) => const BrainChatScreen()),
  GoRoute(
    path: Routes.environment,
    builder: (_, s) => BrainEnvironmentScreen(zoneId: s.uri.queryParameters['zone']),
  ),
  GoRoute(path: Routes.devices, builder: (_, _) => const DevicesScreen()),
  GoRoute(
    path: Routes.device,
    builder: (_, s) => DeviceScreen(deviceId: s.pathParameters['deviceId']!),
  ),
  if (withPrefs) GoRoute(path: Routes.prefs, builder: (_, _) => const NotificationPrefsScreen()),
];

StatefulShellBranch _branch(String path, Widget screen, {bool withPrefs = false}) => StatefulShellBranch(
  routes: [
    GoRoute(
      path: path,
      pageBuilder: (_, _) => NoTransitionPage(child: screen),
      routes: _details(withPrefs: withPrefs),
    ),
  ],
);

@Riverpod(keepAlive: true)
GoRouter goRouter(Ref ref) {
  final auth = ValueNotifier<bool>(ref.read(sessionProvider) != null);
  ref.listen(sessionProvider, (_, next) => auth.value = next != null);
  ref.onDispose(auth.dispose);

  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: const String.fromEnvironment('LEFI_START', defaultValue: Routes.home),
    refreshListenable: auth,
    redirect: (context, state) {
      final signedIn = auth.value;
      final atLogin = state.matchedLocation == Routes.login;
      final atConnect = state.matchedLocation == Routes.connect;
      // A plant's tag read before signing in opens that plant right after (ADR-109).
      final next = state.uri.queryParameters['next'];
      if (!signedIn) {
        if (atLogin || atConnect) return null;
        final loc = state.uri.path;
        return loc.startsWith('/plant/') ? '${Routes.login}?next=${Uri.encodeQueryComponent(loc)}' : Routes.login;
      }
      if (atLogin || atConnect) return next != null && next.startsWith('/plant/') ? next : Routes.home;
      return null;
    },
    routes: [
      GoRoute(path: Routes.login, builder: (_, _) => const LoginScreen()),
      GoRoute(path: Routes.connect, builder: (_, _) => const ConnectScreen()),
      GoRoute(
        path: Routes.plantTag,
        builder: (_, s) => PlantTagScreen(plantRef: s.pathParameters['plantRef']!),
      ),
      GoRoute(
        path: Routes.camera,
        parentNavigatorKey: _rootKey,
        pageBuilder: (_, s) => MaterialPage(
          fullscreenDialog: true,
          child: CameraScreen(purpose: s.extra as CameraPurpose? ?? CameraPurpose.task),
        ),
      ),
      StatefulShellRoute.indexedStack(
        builder: (_, _, shell) => AppShell(shell: shell),
        branches: [
          _branch(Routes.home, const HomeScreen()),
          _branch(Routes.tasks, const TasksScreen()),
          _branch(Routes.greenhouse, const GreenhouseScreen()),
          _branch(Routes.alerts, const AlertsScreen()),
          _branch(Routes.profile, const ProfileScreen(), withPrefs: true),
        ],
      ),
    ],
  );
}
