import '../../../shared/domain/role.dart';
import 'greenhouse.dart';

/// Read access to the greenhouse structure and plant data.
///
/// Implementations: `DemoGreenhouseRepository` (design fixtures). A Brain API
/// implementation replaces it once `services/brain` exposes the REST contract.
abstract interface class GreenhouseRepository {
  Future<List<Greenhouse>> greenhouses();
  Future<List<Zone>> zones();
  Future<List<Plant>> plants();
  Future<List<Observation>> observations(String plantId);

  /// Zone ids the given role may access (the API's access policy).
  Future<Set<String>> visibleZoneIds(Role role);

  /// 14-day AI health score history, oldest first.
  Future<List<double>> healthHistory(String plantId);
}
