import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../shared/domain/role.dart';
import '../../auth/application/session.dart';
import '../data/demo_greenhouse_repository.dart';
import '../domain/greenhouse.dart';

part 'greenhouse_providers.g.dart';

@Riverpod(keepAlive: true)
Future<List<Greenhouse>> greenhouses(Ref ref) => ref.watch(greenhouseRepositoryProvider).greenhouses();

@Riverpod(keepAlive: true)
Future<List<Zone>> zones(Ref ref) => ref.watch(greenhouseRepositoryProvider).zones();

@Riverpod(keepAlive: true)
Future<List<Plant>> plants(Ref ref) => ref.watch(greenhouseRepositoryProvider).plants();

/// Zone visibility for the signed-in role. Mirrors the API's access policy for UI
/// purposes only; the API remains the authority.
class AccessPolicy {
  AccessPolicy(this.role, this._zones, this._visible);

  final Role role;
  final Map<String, Zone> _zones;
  final Set<String> _visible;

  bool canSeeZone(String zoneId) => _visible.contains(zoneId) && _zones.containsKey(zoneId);

  List<Zone> visibleZones() => _zones.values.where((z) => canSeeZone(z.id)).toList();
}

@Riverpod(keepAlive: true)
Future<AccessPolicy> accessPolicy(Ref ref) async {
  final user = ref.watch(currentUserProvider);
  final zones = await ref.watch(zonesProvider.future);
  final visible = await ref.watch(greenhouseRepositoryProvider).visibleZoneIds(user.role);
  return AccessPolicy(user.role, {for (final z in zones) z.id: z}, visible);
}

@riverpod
Future<List<double>> plantHealthHistory(Ref ref, String plantId) =>
    ref.watch(greenhouseRepositoryProvider).healthHistory(plantId);

/// Human observations saved from inspections during this session (newest first).
@Riverpod(keepAlive: true)
class SessionObservations extends _$SessionObservations {
  @override
  Map<String, List<Observation>> build() => {};

  void add(String plantId, Observation o) => state = {
    ...state,
    plantId: [o, ...?state[plantId]],
  };
}

@riverpod
Future<List<Observation>> plantObservations(Ref ref, String plantId) async {
  final base = await ref.watch(greenhouseRepositoryProvider).observations(plantId);
  final extra = ref.watch(sessionObservationsProvider)[plantId] ?? const [];
  return [...extra, ...base];
}

/// Flagged plants in a zone with their latest AI observation.
@riverpod
Future<List<(Plant, Observation)>> zoneAiFlags(Ref ref, String zoneId) async {
  final repo = ref.watch(greenhouseRepositoryProvider);
  final plants = (await ref.watch(plantsProvider.future)).where((p) => p.zoneId == zoneId && p.flag != null);
  return [for (final p in plants) (p, (await repo.observations(p.id)).firstWhere((o) => o.isAi))];
}
