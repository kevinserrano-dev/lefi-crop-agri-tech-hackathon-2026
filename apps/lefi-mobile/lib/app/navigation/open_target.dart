import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/feedback/feedback.dart';
import '../../features/alerts/presentation/brain_report_sheet.dart';
import '../../features/auth/application/session.dart';
import '../../features/handover/application/brain_handover.dart';
import '../../features/greenhouse/application/greenhouse_providers.dart';
import '../../features/home/domain/dashboard.dart';
import '../../features/report/presentation/report_sheet.dart';
import '../../features/tasks/application/tasks_controller.dart';
import '../../shared/domain/role.dart';
import '../router/routes.dart';

/// Single entry point for in-app navigation from data (dashboard rows,
/// notification actions…). Applies the same visibility checks as the design and
/// explains with a toast when something is out of scope.
Future<void> openTarget(BuildContext context, AppTarget target) async {
  final ref = ProviderScope.containerOf(context, listen: false);
  final toast = ref.read(toastProvider.notifier);
  final user = ref.read(currentUserProvider);
  if (user.fromBrain) return _openOnBrain(context, ref, target);
  final policy = await ref.read(accessPolicyProvider.future);
  if (!context.mounted) return;

  switch (target) {
    case TaskTarget(:final id):
      final tasks = ref.read(tasksControllerProvider).value ?? const [];
      final t = tasks.where((x) => x.id == id).firstOrNull;
      if (t == null) return;
      final visible = t.assignee == user.name || (user.role.can(Permission.team) && policy.canSeeZone(t.zoneId));
      if (!visible) return toast.show('This task isn’t assigned to you.', bad: true);
      context.pushTask(id);
    case ZoneTarget(:final id):
      if (!policy.canSeeZone(id)) return toast.show('$id isn’t in your assigned zones.', bad: true);
      context.pushZone(id);
    case PlantTarget(:final id):
      final plants = await ref.read(plantsProvider.future);
      final p = plants.where((x) => x.id == id).firstOrNull;
      if (p == null || !context.mounted) return;
      if (!policy.canSeeZone(p.zoneId)) return toast.show('Plant $id is outside your assigned zones.', bad: true);
      context.pushPlant(id);
    case InspectTarget(:final plantId):
      if (!user.role.can(Permission.inspect)) {
        return toast.show('Plant inspection isn’t available for your role. Use “Report an issue”.', bad: true);
      }
      context.pushInspect(plantId);
    case TabTarget(:final tab, :final teamScope):
      if (teamScope) ref.read(taskScopeTeamProvider.notifier).set(true);
      context.go('/$tab');
    case HandoverTarget():
      context.pushHandover();
    case ReportTarget():
      await showReportSheet(context);
    case PlannedTarget(:final feature):
      toast.show('$feature is designed and arrives in the next iteration of the app.');
  }
}

/// On Lefi Brain the screens ask Lefi Brain themselves and it refuses what the person may not see:
/// no demo scope checks here (ADR-100).
Future<void> _openOnBrain(BuildContext context, ProviderContainer ref, AppTarget target) async {
  switch (target) {
    case TaskTarget(:final id):
      context.pushTask(id);
    case ZoneTarget(:final id):
      context.pushZone(id);
    case PlantTarget(:final id) || InspectTarget(plantId: final id?):
      context.pushPlant(id);
    case InspectTarget():
      context.go(Routes.greenhouse);
    case TabTarget(:final tab, :final teamScope):
      if (teamScope) ref.read(taskScopeTeamProvider.notifier).set(true);
      context.go('/$tab');
    case ReportTarget():
      await showBrainReportSheet(context);
    case HandoverTarget():
      if (ref.read(brainHandoverRepositoryProvider) == null) {
        return ref.read(toastProvider.notifier).show('The shift handover is not for your role.');
      }
      context.pushHandover();
    case PlannedTarget(:final feature):
      ref.read(toastProvider.notifier).show('$feature is not on the phone yet.');
  }
}
