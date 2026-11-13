import '../../brain/data/brain_json.dart';

/// Greenhouses, zones, growing locations, crop batches and registered plants as Lefi Brain keeps
/// them (ADR-064, 066, 080, 082). Health is only what people recorded (ADR-070); readings come
/// with their provenance and the range a person or the species' profile gives (ADR-084, 097).
class BrainGreenhouse {
  const BrainGreenhouse(this.id, this.name);
  factory BrainGreenhouse.fromJson(Map<String, dynamic> j) => BrainGreenhouse(js(j['id']), js(j['name']));
  final String id;
  final String name;
}

class BrainZone {
  const BrainZone({
    required this.id,
    required this.greenhouseId,
    required this.name,
    this.code,
    this.purpose,
    this.purposeOther,
    this.growingSystems = const [],
    this.notes,
    this.areaM2,
    this.physicalRef,
    this.climateControl = 'not_configured',
    this.status = 'active',
    this.plants = 0,
    this.batchPlants = 0,
    this.activeCrops = 0,
    this.locationsByKind = const {},
  });

  factory BrainZone.fromJson(Map<String, dynamic> j) {
    final s = jm(j['summary']);
    return BrainZone(
      id: js(j['id']),
      greenhouseId: js(j['greenhouse_id']),
      name: js(j['name'], 'Zone'),
      code: jsn(j['code']),
      purpose: jsn(j['purpose']),
      purposeOther: jsn(j['purpose_other']),
      growingSystems: jstrs(j['growing_systems']),
      notes: jsn(j['notes']),
      areaM2: jd(j['area_m2']),
      physicalRef: jsn(j['physical_ref']),
      climateControl: js(j['climate_control'], 'not_configured'),
      status: js(j['status'], 'active'),
      plants: ji(s['plants']),
      batchPlants: ji(s['batch_plants']),
      activeCrops: ji(s['active_crops']),
      locationsByKind: {for (final e in jm(s['locations_by_kind']).entries) e.key: ji(e.value)},
    );
  }

  final String id;
  final String greenhouseId;
  final String name;
  final String? code;
  final String? purpose;
  final String? purposeOther;
  final List<String> growingSystems;
  final String? notes;
  final double? areaM2;
  final String? physicalRef;
  final String climateControl;

  /// active · maintenance · inactive
  final String status;
  final int plants;
  final int batchPlants;
  final int activeCrops;
  final Map<String, int> locationsByKind;

  String get title => code == null ? name : '$name · $code';
  int get locations => locationsByKind.values.fold(0, (a, b) => a + b);
}

/// A zone as Environmental Monitoring sees it: active alerts and sensors measuring in it.
class EnvZone {
  const EnvZone({required this.id, this.sensors = 0, this.alertsCritical = 0, this.alertsWarning = 0});
  factory EnvZone.fromJson(Map<String, dynamic> j) => EnvZone(
    id: js(j['id']),
    sensors: ji(j['sensors']),
    alertsCritical: ji(j['alerts_critical']),
    alertsWarning: ji(j['alerts_warning']),
  );
  final String id;
  final int sensors;
  final int alertsCritical;
  final int alertsWarning;
  int get alerts => alertsCritical + alertsWarning;
}

class EnvRange {
  const EnvRange({this.min, this.max, required this.rule, required this.source});
  factory EnvRange.fromJson(Map<String, dynamic> j) =>
      EnvRange(min: jd(j['min']), max: jd(j['max']), rule: js(j['rule']), source: js(j['source'], 'rule'));
  final double? min;
  final double? max;
  final String rule;

  /// rule = a person's alert rule · species = the crop's published profile
  final String source;
}

/// One value of one sensor measuring in the zone.
class EnvValue {
  const EnvValue({
    required this.sensorId,
    required this.sensor,
    required this.device,
    required this.origin,
    required this.state,
    required this.variable,
    required this.label,
    this.place,
    this.unit,
    this.value,
    this.receivedAt,
    this.range,
    this.inRange,
  });

  factory EnvValue.fromJson(Map<String, dynamic> j) => EnvValue(
    sensorId: js(j['sensor_id']),
    sensor: js(j['sensor']),
    device: js(j['device']),
    place: jsn(j['place']),
    origin: js(j['origin'], 'LIVE'),
    state: js(j['state'], 'no_data'),
    variable: js(j['variable']),
    label: js(j['label'], js(j['variable'])),
    unit: jsn(j['unit']),
    value: jd(j['value']),
    receivedAt: jt(j['received_at']),
    range: j['range'] is Map<String, dynamic> ? EnvRange.fromJson(j['range'] as Map<String, dynamic>) : null,
    inRange: j['in_range'] is bool ? j['in_range'] as bool : null,
  );

  final String sensorId;
  final String sensor;
  final String device;
  final String? place;
  final String origin;

  /// receiving · not_receiving · no_data · error · …
  final String state;
  final String variable;
  final String label;
  final String? unit;

  /// Only while the sensor is receiving; else null.
  final double? value;
  final DateTime? receivedAt;
  final EnvRange? range;
  final bool? inRange;

  bool get simulated => origin == 'SIMULATED';
}

class EnvCrop {
  const EnvCrop({required this.crop, required this.batch, required this.knowledge, this.plants, this.profile});
  factory EnvCrop.fromJson(Map<String, dynamic> j) => EnvCrop(
    crop: js(j['crop']),
    batch: jb(j['batch']),
    knowledge: js(j['knowledge']),
    plants: jin(j['plants']),
    profile: jsn(j['profile']),
  );
  final String crop;
  final bool batch;

  /// ranges · no_parameters · no_profile · draft_only · several_profiles
  final String knowledge;
  final int? plants;
  final String? profile;
}

class ZoneEnvironment {
  const ZoneEnvironment({
    required this.zones,
    required this.values,
    required this.crops,
    this.zoneId,
    this.brainTime,
    this.irrigation = '',
  });

  factory ZoneEnvironment.fromJson(Map<String, dynamic> j) => ZoneEnvironment(
    zones: [for (final z in jl(j['zones'])) EnvZone.fromJson(z)],
    values: [for (final v in jl(j['values'])) EnvValue.fromJson(v)],
    crops: [for (final c in jl(j['crops'])) EnvCrop.fromJson(c)],
    zoneId: jsn(j['zone_id']),
    brainTime: jt(j['brain_time']),
    irrigation: js(jm(j['irrigation'])['reason']),
  );

  final List<EnvZone> zones;
  final List<EnvValue> values;
  final List<EnvCrop> crops;
  final String? zoneId;
  final DateTime? brainTime;
  final String irrigation;
}

class CropType {
  const CropType({required this.id, required this.name, this.variety, this.isPlaceholder = false});
  factory CropType.fromJson(Map<String, dynamic> j) => CropType(
    id: js(j['id']),
    name: js(j['name'], 'Crop'),
    variety: jsn(j['variety']),
    isPlaceholder: jb(j['is_placeholder']),
  );
  final String id;
  final String name;
  final String? variety;
  final bool isPlaceholder;
  String get label => variety == null ? name : '$name · $variety';
}

/// A crop batch: an active crop assignment made of registered plants (ADR-066, 082).
class CropBatch {
  const CropBatch({
    required this.id,
    required this.locationId,
    required this.zoneId,
    required this.cropTypeId,
    required this.plantQuantity,
    required this.status,
    this.variety,
    this.batchCode,
    this.startedOn,
    this.startEvent,
    this.growthStage,
    this.expectedHarvestOn,
    this.notes,
  });

  factory CropBatch.fromJson(Map<String, dynamic> j) => CropBatch(
    id: js(j['id']),
    locationId: js(j['location_id']),
    zoneId: js(j['zone_id']),
    cropTypeId: js(j['crop_type_id']),
    plantQuantity: ji(j['plant_quantity']),
    status: js(j['status'], 'active'),
    variety: jsn(j['variety']),
    batchCode: jsn(j['batch_code']),
    startedOn: jsn(j['started_on']),
    startEvent: jsn(j['start_event']),
    growthStage: jsn(j['growth_stage']),
    expectedHarvestOn: jsn(j['expected_harvest_on']),
    notes: jsn(j['notes']),
  );

  final String id;
  final String locationId;
  final String zoneId;
  final String cropTypeId;
  final int plantQuantity;
  final String status;
  final String? variety;
  final String? batchCode;
  final String? startedOn;
  final String? startEvent;
  final String? growthStage;
  final String? expectedHarvestOn;
  final String? notes;

  /// Days since it started, from Lefi Brain's date (never estimated otherwise).
  int? daysSinceStart(DateTime now) {
    final d = startedOn == null ? null : DateTime.tryParse(startedOn!);
    return d == null ? null : DateTime(now.year, now.month, now.day).difference(d).inDays;
  }
}

/// A growing location (bench, row, bucket…), for plant addresses.
class GrowingLocation {
  const GrowingLocation({
    required this.id,
    required this.code,
    required this.kind,
    this.name,
    this.spot,
    this.parentId,
  });
  factory GrowingLocation.fromJson(Map<String, dynamic> j) => GrowingLocation(
    id: js(j['id']),
    code: js(j['code']),
    kind: js(j['kind']),
    name: jsn(j['name']),
    spot: jsn(j['spot']),
    parentId: jsn(j['parent_id']),
  );
  final String id;
  final String code;
  final String kind;
  final String? name;
  final String? spot;
  final String? parentId;
  String get label => [name ?? code, ?spot].join(' · ');
}

class BrainPlant {
  const BrainPlant({
    required this.id,
    required this.code,
    required this.cropTypeId,
    required this.zoneId,
    required this.status,
    this.name,
    this.containerId,
    this.nfcUid,
    this.plantedOn,
    this.notes,
    this.assignmentId,
  });

  factory BrainPlant.fromJson(Map<String, dynamic> j) => BrainPlant(
    id: js(j['id']),
    code: js(j['code']),
    cropTypeId: js(j['crop_type_id']),
    zoneId: js(j['zone_id']),
    status: js(j['status'], 'active'),
    name: jsn(j['name']),
    containerId: jsn(j['container_id']),
    nfcUid: jsn(j['nfc_uid']),
    plantedOn: jsn(j['planted_on']),
    notes: jsn(j['notes']),
    assignmentId: jsn(j['assignment_id']),
  );

  final String id;
  final String code;
  final String cropTypeId;
  final String zoneId;
  final String status;
  final String? name;
  final String? containerId;
  final String? nfcUid;
  final String? plantedOn;
  final String? notes;
  final String? assignmentId;

  String get title => name == null ? code : '$code · $name';
}

/// A person's look at a plant (every observation is a person's: no AI detection exists).
class PlantObservation {
  const PlantObservation({
    required this.id,
    required this.plantId,
    required this.health,
    required this.issues,
    required this.observedBy,
    this.note,
    this.observedAt,
  });

  factory PlantObservation.fromJson(Map<String, dynamic> j) => PlantObservation(
    id: js(j['id']),
    plantId: js(j['plant_id']),
    health: js(j['health']),
    issues: jstrs(j['issues']),
    observedBy: js(j['observed_by'], 'unknown person'),
    note: jsn(j['note']),
    observedAt: jt(j['observed_at']),
  );

  final String id;
  final String plantId;

  /// healthy · watch · problem
  final String health;
  final List<String> issues;
  final String observedBy;
  final String? note;
  final DateTime? observedAt;
}

class InspectionRequest {
  const InspectionRequest({
    required this.id,
    required this.plantId,
    required this.requestedBy,
    required this.status,
    this.reason,
    this.requestedAt,
  });

  factory InspectionRequest.fromJson(Map<String, dynamic> j) => InspectionRequest(
    id: js(j['id']),
    plantId: js(j['plant_id']),
    requestedBy: js(j['requested_by'], 'unknown person'),
    status: js(j['status'], 'open'),
    reason: jsn(j['reason']),
    requestedAt: jt(j['requested_at']),
  );

  final String id;
  final String plantId;
  final String requestedBy;
  final String status;
  final String? reason;
  final DateTime? requestedAt;
}

class PlantHealthRow {
  const PlantHealthRow({required this.plantId, this.latest, this.openRequest});
  final String plantId;
  final PlantObservation? latest;
  final InspectionRequest? openRequest;
}

/// `/plant-health` (`nav.plantHealth`): the latest observation and open request of each plant.
class PlantHealthBoard {
  const PlantHealthBoard({
    required this.rows,
    this.issues = const [],
    this.canObserve = false,
    this.canRequest = false,
    this.visionReason = '',
  });

  factory PlantHealthBoard.fromJson(Map<String, dynamic> j) => PlantHealthBoard(
    rows: {
      for (final r in jl(j['plants']))
        js(r['plant_id']): PlantHealthRow(
          plantId: js(r['plant_id']),
          latest: r['latest'] is Map<String, dynamic>
              ? PlantObservation.fromJson(r['latest'] as Map<String, dynamic>)
              : null,
          openRequest: r['open_request'] is Map<String, dynamic>
              ? InspectionRequest.fromJson(r['open_request'] as Map<String, dynamic>)
              : null,
        ),
    },
    issues: jstrs(j['issues']),
    canObserve: jb(j['can_observe']),
    canRequest: jb(j['can_request']),
    visionReason: js(jm(j['vision'])['reason']),
  );

  final Map<String, PlantHealthRow> rows;
  final List<String> issues;
  final bool canObserve;
  final bool canRequest;
  final String visionReason;
}

const plantHealthStates = ['healthy', 'watch', 'problem'];
const plantIssues = ['pest', 'disease', 'nutrient', 'water', 'environment', 'damage', 'growth', 'other'];
