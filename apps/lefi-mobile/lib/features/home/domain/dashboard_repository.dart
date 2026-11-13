import '../../../shared/domain/role.dart';
import '../../tasks/domain/task.dart';
import 'dashboard.dart';

abstract interface class DashboardRepository {
  /// Role-specific home summary. [tasks] lets the summary list live task state.
  Future<Dashboard> dashboardFor(UserProfile user, List<FieldTask> tasks, bool Function(String zoneId) inScope);
}
