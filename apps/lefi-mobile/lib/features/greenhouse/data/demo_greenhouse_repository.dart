import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/demo_latency.dart';
import '../../../demo/demo_greenhouse.dart';
import '../../../demo/demo_users.dart';
import '../../../shared/domain/role.dart';
import '../domain/greenhouse.dart';
import '../domain/greenhouse_repository.dart';

part 'demo_greenhouse_repository.g.dart';

class DemoGreenhouseRepository implements GreenhouseRepository {
  @override
  Future<List<Greenhouse>> greenhouses() => demoDelay(() => demoGreenhouses);

  @override
  Future<List<Zone>> zones() => demoDelay(() => demoZones);

  @override
  Future<List<Plant>> plants() => demoDelay(() => demoPlants);

  @override
  Future<List<Observation>> observations(String plantId) => demoDelay(() {
    final p = demoPlants.firstWhere((p) => p.id == plantId);
    return demoObservations[p.flag]!;
  }, ms: 120);

  @override
  Future<Set<String>> visibleZoneIds(Role role) => demoDelay(
    () => {
      for (final z in demoZones)
        if (demoZoneInScope(role, z.id, z.greenhouseId)) z.id,
    },
    ms: 50,
  );

  @override
  Future<List<double>> healthHistory(String plantId) =>
      demoDelay(() => demoHealthHistory(demoPlants.firstWhere((p) => p.id == plantId)), ms: 120);
}

@Riverpod(keepAlive: true)
GreenhouseRepository greenhouseRepository(Ref ref) => DemoGreenhouseRepository();
