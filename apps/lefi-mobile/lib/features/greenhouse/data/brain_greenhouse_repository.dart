import '../../brain/data/brain_auth_repository.dart';
import '../domain/brain_greenhouse.dart';
import '../domain/brain_plant_summary.dart';

/// Greenhouses & crops from Lefi Brain through Lefi Gateway (`nav.greenhouses`, every role),
/// environment per zone (`nav.environment`) and plant health recorded by people
/// (`nav.plantHealth`, `plant.observe`, `ai.request`). Lefi Brain checks each one.
class BrainGreenhouseRepository {
  BrainGreenhouseRepository(this.brain);
  final BrainAuthRepository brain;

  bool can(String permission) => brain.can(permission);

  List<Map<String, dynamic>> _list(Object? body) => [
    for (final x in body is List ? body : const [])
      if (x is Map<String, dynamic>) x,
  ];

  Future<List<BrainGreenhouse>> greenhouses() async => [
    for (final g in _list((await brain.api('GET', '/greenhouses')).body)) BrainGreenhouse.fromJson(g),
  ];

  Future<List<BrainZone>> zones() async => [
    for (final z in _list((await brain.api('GET', '/zones')).body)) BrainZone.fromJson(z),
  ];

  /// Without [zoneId]: the zones' alert and sensor counts (and the first zone's values).
  Future<ZoneEnvironment> environment({String? zoneId}) async {
    final q = zoneId == null ? '' : '?zone_id=${Uri.encodeQueryComponent(zoneId)}';
    return ZoneEnvironment.fromJson((await brain.api('GET', '/environment$q')).json);
  }

  Future<List<CropType>> cropTypes() async => [
    for (final c in _list((await brain.api('GET', '/crop-types')).body)) CropType.fromJson(c),
  ];

  Future<List<CropBatch>> batches(String zoneId) async => [
    for (final b in _list((await brain.api('GET', '/crop-assignments?zone_id=$zoneId')).body)) CropBatch.fromJson(b),
  ];

  Future<List<GrowingLocation>> locations(String zoneId) async => [
    for (final c in _list((await brain.api('GET', '/containers?zone_id=$zoneId')).body)) GrowingLocation.fromJson(c),
  ];

  Future<List<BrainPlant>> plants({String? zoneId}) async {
    final q = zoneId == null ? '' : '?zone_id=$zoneId';
    return [for (final p in _list((await brain.api('GET', '/plants$q')).body)) BrainPlant.fromJson(p)];
  }

  Future<BrainPlant> plant(String id) async => BrainPlant.fromJson((await brain.api('GET', '/plants/$id')).json);

  /// Null without `nav.plantHealth` (maintenance, workers): no health is shown, none invented.
  Future<PlantHealthBoard?> plantHealth() async {
    if (!can('nav.plantHealth')) return null;
    return PlantHealthBoard.fromJson((await brain.api('GET', '/plant-health')).json);
  }

  Future<List<PlantObservation>> observations(String plantId) async {
    if (!can('nav.plantHealth')) return const [];
    return [
      for (final o in _list((await brain.api('GET', '/plants/$plantId/observations?limit=50')).body))
        PlantObservation.fromJson(o),
    ];
  }

  /// A person's observation (`plant.observe`); it closes the plant's open inspection requests.
  Future<int> recordObservation(
    String plantId, {
    required String health,
    List<String> issues = const [],
    String? note,
  }) async {
    final a = await brain.api(
      'POST',
      '/plants/$plantId/observations',
      body: {'health': health, 'issues': issues, if (note != null && note.trim().isNotEmpty) 'note': note.trim()},
    );
    return (a.json['requests_done'] as num?)?.toInt() ?? 0;
  }

  Future<InspectionRequest> requestInspection(String plantId, {String? reason}) async => InspectionRequest.fromJson(
    (await brain.api(
      'POST',
      '/plants/$plantId/inspection-requests',
      body: {'reason': reason == null || reason.trim().isEmpty ? null : reason.trim()},
    )).json,
  );

  Future<void> cancelRequest(String requestId) => brain.api('POST', '/inspection-requests/$requestId/cancel');

  /// Everything about one plant for this person, by its id or code (a plant's NFC tag, ADR-109).
  Future<PlantSummary> plantSummary(String ref) async =>
      PlantSummary.fromJson((await brain.api('GET', '/plants/${Uri.encodeComponent(ref)}/summary')).json);

  Future<PlantAiSummary> plantAiSummary(String plantId) async =>
      PlantAiSummary.fromJson((await brain.api('GET', '/plants/$plantId/ai-summary')).json);

  /// Lefi AI writes a short summary of the plant's facts (answers `pending`; read it again).
  Future<PlantAiSummary> askPlantAiSummary(String plantId) async =>
      PlantAiSummary.fromJson((await brain.api('POST', '/plants/$plantId/ai-summary')).json);
}
