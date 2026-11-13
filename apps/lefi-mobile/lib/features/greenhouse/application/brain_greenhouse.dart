import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../data/brain_greenhouse_repository.dart';
import '../domain/brain_greenhouse.dart';
import '../domain/brain_plant_summary.dart';

part 'brain_greenhouse.g.dart';

/// Readings arrive at 1 Hz; an open zone asks Lefi Brain again this often (no WebSocket yet).
const brainZonePoll = Duration(seconds: 10);
const brainGreenhousePoll = Duration(seconds: 30);

/// Lefi Brain's greenhouses when signed in to it (`nav.greenhouses`: every role); null on demo data.
@Riverpod(keepAlive: true)
BrainGreenhouseRepository? brainGreenhouseRepository(Ref ref) {
  final auth = ref.watch(activeAuthRepositoryProvider);
  ref.watch(sessionProvider);
  if (auth is! BrainAuthRepository || !auth.can('nav.greenhouses')) return null;
  return BrainGreenhouseRepository(auth);
}

BrainGreenhouseRepository _repo(Ref ref) =>
    ref.watch(brainGreenhouseRepositoryProvider) ?? (throw StateError('Not connected to Lefi Brain.'));

void _poll(Ref ref, Duration every) {
  final timer = Timer(every, ref.invalidateSelf);
  ref.onDispose(timer.cancel);
}

/// Everything the Greenhouse tab shows at once.
class GreenhouseOverview {
  const GreenhouseOverview({
    required this.greenhouses,
    required this.zones,
    required this.envZones,
    required this.crops,
  });
  final List<BrainGreenhouse> greenhouses;
  final List<BrainZone> zones;
  final Map<String, EnvZone> envZones;
  final Map<String, CropType> crops;
}

@riverpod
Future<GreenhouseOverview> brainGreenhouseOverview(Ref ref) async {
  final repo = _repo(ref);
  _poll(ref, brainGreenhousePoll);
  final (ghs, zones, crops) = await (repo.greenhouses(), repo.zones(), repo.cropTypes()).wait;
  final env = repo.can('nav.environment') ? await repo.environment() : null;
  return GreenhouseOverview(
    greenhouses: ghs,
    zones: zones,
    envZones: {for (final z in env?.zones ?? const <EnvZone>[]) z.id: z},
    crops: {for (final c in crops) c.id: c},
  );
}

/// One zone with what grows in it and its live readings.
class ZoneDetail {
  const ZoneDetail({
    required this.zone,
    required this.greenhouse,
    required this.environment,
    required this.batches,
    required this.plants,
    required this.locations,
    required this.crops,
    required this.health,
  });
  final BrainZone zone;
  final BrainGreenhouse? greenhouse;
  final ZoneEnvironment? environment;
  final List<CropBatch> batches;
  final List<BrainPlant> plants;
  final Map<String, GrowingLocation> locations;
  final Map<String, CropType> crops;
  final PlantHealthBoard? health;
}

@riverpod
Future<ZoneDetail> brainZoneDetail(Ref ref, String zoneId) async {
  final repo = _repo(ref);
  _poll(ref, brainZonePoll);
  final (ghs, zones, crops) = await (repo.greenhouses(), repo.zones(), repo.cropTypes()).wait;
  final zone = zones.where((z) => z.id == zoneId).firstOrNull ?? (throw StateError('This zone is not in Lefi Brain.'));
  final (env, batches, plants, locations, health) = await (
    repo.can('nav.environment') ? repo.environment(zoneId: zoneId) : Future<ZoneEnvironment?>.value(),
    repo.batches(zoneId),
    repo.plants(zoneId: zoneId),
    repo.locations(zoneId),
    repo.plantHealth(),
  ).wait;
  return ZoneDetail(
    zone: zone,
    greenhouse: ghs.where((g) => g.id == zone.greenhouseId).firstOrNull,
    environment: env,
    batches: batches,
    plants: plants,
    locations: {for (final l in locations) l.id: l},
    crops: {for (final c in crops) c.id: c},
    health: health,
  );
}

class PlantDetail {
  const PlantDetail({
    required this.plant,
    required this.zone,
    required this.crop,
    required this.location,
    required this.batch,
    required this.observations,
    required this.health,
  });
  final BrainPlant plant;
  final BrainZone? zone;
  final CropType? crop;
  final GrowingLocation? location;
  final CropBatch? batch;
  final List<PlantObservation> observations;
  final PlantHealthBoard? health;

  InspectionRequest? get openRequest => health?.rows[plant.id]?.openRequest;
}

@riverpod
Future<PlantDetail> brainPlantDetail(Ref ref, String plantId) async {
  final repo = _repo(ref);
  final plant = await repo.plant(plantId);
  final (zones, crops, locations, batches, observations, health) = await (
    repo.zones(),
    repo.cropTypes(),
    repo.locations(plant.zoneId),
    repo.batches(plant.zoneId),
    repo.observations(plantId),
    repo.plantHealth(),
  ).wait;
  return PlantDetail(
    plant: plant,
    zone: zones.where((z) => z.id == plant.zoneId).firstOrNull,
    crop: crops.where((c) => c.id == plant.cropTypeId).firstOrNull,
    location: locations.where((l) => l.id == plant.containerId).firstOrNull,
    batch: batches.where((b) => b.id == plant.assignmentId).firstOrNull,
    observations: observations,
    health: health,
  );
}

/// Zones for pickers (new task): from the same list the Greenhouse tab shows.
@riverpod
Future<List<BrainZone>> brainZones(Ref ref) => _repo(ref).zones();

/// One plant's summary (ADR-109), by id or code; asked again while open.
@riverpod
Future<PlantSummary> brainPlantSummary(Ref ref, String plantRef) async {
  _poll(ref, brainZonePoll * 3);
  return _repo(ref).plantSummary(plantRef);
}

/// Lefi AI's latest summary of the plant for this person; asked again every 2 s while pending.
@riverpod
Future<PlantAiSummary> brainPlantAiSummary(Ref ref, String plantId) async {
  final s = await _repo(ref).plantAiSummary(plantId);
  if (s.pending) _poll(ref, const Duration(seconds: 2));
  return s;
}

/// The plant a tag names (ADR-109), by id or code (any case), from Lefi Brain's list of plants
/// (every Lefi Brain version has it). Null = Lefi Brain has no such plant.
@riverpod
Future<BrainPlant?> brainPlantByRef(Ref ref, String plantRef) async {
  final key = plantRef.trim().toLowerCase();
  for (final p in await _repo(ref).plants()) {
    if (p.id.toLowerCase() == key || p.code.toLowerCase() == key) return p;
  }
  return null;
}
