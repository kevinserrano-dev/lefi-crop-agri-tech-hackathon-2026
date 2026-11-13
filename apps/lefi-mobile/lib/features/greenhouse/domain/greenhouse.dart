import '../../../shared/domain/provenance.dart';

class Greenhouse {
  const Greenhouse({
    required this.id,
    required this.name,
    required this.system,
    required this.health,
    required this.area,
  });

  final String id;
  final String name;
  final String system;
  final int health;
  final String area;
}

class Zone {
  const Zone({
    required this.id,
    required this.greenhouseId,
    required this.code,
    required this.label,
    required this.crop,
    required this.plantCount,
    required this.health,
    required this.readings,
    this.reEntryRestricted = false,
  });

  final String id;
  final String greenhouseId;
  final String code;
  final String label;
  final String crop;
  final int plantCount;
  final int health;

  /// Latest value per metric; `null` value = no data.
  final Map<Metric, Reading> readings;

  /// Closed for spraying (re-entry interval).
  final bool reEntryRestricted;

  double? value(Metric m) => readings[m]?.value;
}

/// Environmental metrics shown on zone cards. Ranges are placeholders taken from
/// the design until an agronomist provides crop profiles (`is_placeholder`).
enum Metric {
  temp('Air temperature', '°C', 1, 18, 24),
  rh('Humidity', '% RH', 0, 60, 75),
  ppfd('Light', 'µmol/m²/s', 0, 200, 450),
  moisture('Substrate moisture', '% VWC', 0, 45, 65),
  ec('EC', 'mS/cm', 2, 1.2, 1.8),
  ph('pH', '', 2, 5.6, 6.2);

  const Metric(this.label, this.unit, this.decimals, this.low, this.high);

  final String label;
  final String unit;
  final int decimals;
  final double low;
  final double high;

  static const isPlaceholderRange = true;
}

class Reading {
  const Reading(this.value, this.origin);

  final double? value;
  final DataOrigin origin;
}

enum PlantFlag { wilt, tipburn, aphid, rootRot, mildew }

class Plant {
  const Plant({
    required this.id,
    required this.zoneId,
    required this.position,
    required this.health,
    required this.variety,
    required this.stage,
    required this.ageDays,
    this.flag,
  });

  final String id;
  final String zoneId;
  final String position;
  final int health;
  final String variety;
  final String stage;
  final int ageDays;
  final PlantFlag? flag;
}

enum ObservationSource { ai, human }

class Observation {
  const Observation({
    required this.source,
    required this.author,
    required this.time,
    required this.text,
    this.confidence,
    this.simulated = false,
    this.confirmed = false,
  });

  final ObservationSource source;
  final String author;
  final String time;
  final String text;
  final String? confidence;
  final bool simulated;
  final bool confirmed;

  bool get isAi => source == ObservationSource.ai;
}
