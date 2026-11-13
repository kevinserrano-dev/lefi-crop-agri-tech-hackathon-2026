import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../demo/demo_dashboards.dart';
import '../../../shared/domain/role.dart';
import '../../auth/application/session.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../../tasks/domain/task.dart';
import '../domain/dashboard.dart';
import '../domain/dashboard_repository.dart';
import 'brain_dashboard_repository.dart';

part 'demo_dashboard_repository.g.dart';

class DemoDashboardRepository implements DashboardRepository {
  @override
  Future<Dashboard> dashboardFor(UserProfile user, List<FieldTask> tasks, bool Function(String zoneId) inScope) async =>
      demoDashboard(user, tasks, inScope);
}

/// Lefi Brain's overview when this phone is connected to one (ADR-070), else the demo's.
@Riverpod(keepAlive: true)
DashboardRepository dashboardRepository(Ref ref) {
  final auth = ref.watch(activeAuthRepositoryProvider);
  if (auth is BrainAuthRepository) return BrainDashboardRepository(auth);
  return DemoDashboardRepository();
}
