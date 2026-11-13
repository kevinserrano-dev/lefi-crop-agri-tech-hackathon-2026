import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../../greenhouse/application/greenhouse_providers.dart';
import '../../tasks/application/tasks_controller.dart';
import '../data/brain_dashboard_repository.dart';
import '../data/demo_dashboard_repository.dart';
import '../domain/dashboard.dart';

part 'home_providers.g.dart';

/// How often a phone connected to Lefi Brain refreshes the home summary (no WebSocket yet).
const brainDashboardPoll = Duration(seconds: 30);

@riverpod
Future<Dashboard> dashboard(Ref ref) async {
  final user = ref.watch(currentUserProvider);
  final repo = ref.watch(dashboardRepositoryProvider);
  if (repo is BrainDashboardRepository) {
    // Real data only: the demo tasks and zone scopes are not mixed in.
    final timer = Timer(brainDashboardPoll, ref.invalidateSelf);
    ref.onDispose(timer.cancel);
    return repo.dashboardFor(user, const [], (_) => true);
  }
  final tasks = await ref.watch(tasksControllerProvider.future);
  final policy = await ref.watch(accessPolicyProvider.future);
  return repo.dashboardFor(user, tasks, policy.canSeeZone);
}
