import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

/// Route names/paths. Detail screens are nested under every tab so that a
/// push keeps the current tab selected (as in the design).
abstract final class Routes {
  static const login = '/login';
  static const connect = '/connect';
  static const home = '/home';
  static const tasks = '/tasks';
  static const greenhouse = '/greenhouse';
  static const alerts = '/alerts';
  static const profile = '/profile';
  static const camera = '/camera';

  /// A plant's NFC tag `leficrop://lefi/plant/<id or code>` arrives as this path (ADR-109).
  static const plantTag = '/plant/:plantRef';

  static const tabRoots = [home, tasks, greenhouse, alerts, profile];

  // Relative detail segments (nested under each tab root).
  static const task = 'task/:taskId';
  static const zone = 'zone/:zoneId';
  static const plant = 'plant/:plantId';
  static const inspect = 'inspect';
  static const handover = 'handover';
  static const aiControl = 'ai-control';
  static const robot = 'robot';
  static const chat = 'ask-lefi';
  static const environment = 'environment';
  static const prefs = 'prefs';
  static const devices = 'devices';
  static const device = 'devices/:deviceId';
}

extension AppNavigation on BuildContext {
  /// Root of the tab the user is currently in (e.g. `/greenhouse`).
  String get currentTabRoot {
    final loc = GoRouterState.of(this).matchedLocation;
    return Routes.tabRoots.firstWhere((r) => loc.startsWith(r), orElse: () => Routes.home);
  }

  Future<T?> pushDetail<T>(String relative, {Object? extra}) => push<T>('$currentTabRoot/$relative', extra: extra);

  void pushTask(String id) => pushDetail<void>('task/$id');
  void pushZone(String id) => pushDetail<void>('zone/$id');
  void pushPlant(String id) => pushDetail<void>('plant/$id');
  void pushInspect([String? plantId]) => pushDetail<void>(plantId == null ? 'inspect' : 'inspect?plant=$plantId');
  void pushHandover() => pushDetail<void>('handover');
  void pushAiControl() => pushDetail<void>(Routes.aiControl);
  void pushRobot() => pushDetail<void>(Routes.robot);
  void pushChat() => pushDetail<void>(Routes.chat);
  void pushEnvironment([String? zoneId]) => pushDetail<void>(
    zoneId == null ? Routes.environment : '${Routes.environment}?zone=${Uri.encodeQueryComponent(zoneId)}',
  );
}
