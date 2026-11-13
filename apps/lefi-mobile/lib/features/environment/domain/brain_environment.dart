import '../../brain/data/brain_json.dart';
import '../../greenhouse/domain/brain_greenhouse.dart';

/// The windows Lefi Brain keeps history for (`/environment?range=`).
const envRanges = ['24h', '7d', '30d'];

String envRangeLabel(String r) => switch (r) {
  '24h' => '24 h',
  '7d' => '7 days',
  '30d' => '30 days',
  _ => r,
};

/// A zone in Environmental Monitoring's list (`EnvZoneOut`).
class EnvZoneItem {
  const EnvZoneItem({
    required this.id,
    required this.name,
    required this.greenhouse,
    required this.status,
    required this.sensors,
    required this.alertsCritical,
    required this.alertsWarning,
    this.code,
  });
  factory EnvZoneItem.fromJson(Map<String, dynamic> j) => EnvZoneItem(
    id: js(j['id']),
    name: js(j['name'], 'Zone'),
    code: jsn(j['code']),
    greenhouse: js(j['greenhouse']),
    status: js(j['status'], 'active'),
    sensors: ji(j['sensors']),
    alertsCritical: ji(j['alerts_critical']),
    alertsWarning: ji(j['alerts_warning']),
  );
  final String id;
  final String name;
  final String? code;
  final String greenhouse;
  final String status;
  final int sensors;
  final int alertsCritical;
  final int alertsWarning;

  String get title => code == null ? name : '$name · $code';
}

/// Average, minimum, maximum and time in range over the window, from stored readings only.
class EnvStats {
  const EnvStats({required this.readings, this.current, this.average, this.min, this.max, this.timeInRange});
  factory EnvStats.fromJson(Map<String, dynamic> j) => EnvStats(
    current: jd(j['current']),
    average: jd(j['average']),
    min: jd(j['min']),
    max: jd(j['max']),
    timeInRange: jd(j['time_in_range']),
    readings: ji(j['readings']),
  );
  final double? current;
  final double? average;
  final double? min;
  final double? max;

  /// 0–1; null without a range or without data.
  final double? timeInRange;
  final int readings;
}

/// One variable's history in the zone: bucket averages, oldest first (null = no reading in that bucket).
class EnvSeries {
  const EnvSeries({
    required this.variable,
    required this.label,
    required this.sensors,
    required this.origins,
    required this.values,
    required this.stats,
    this.unit,
    this.range,
  });
  factory EnvSeries.fromJson(Map<String, dynamic> j) => EnvSeries(
    variable: js(j['variable']),
    label: js(j['label'], js(j['variable'])),
    unit: jsn(j['unit']),
    sensors: ji(j['sensors']),
    origins: jstrs(j['origins']),
    values: [for (final v in j['values'] is List ? j['values'] as List : const []) jd(v)],
    range: j['range'] is Map<String, dynamic> ? EnvRange.fromJson(j['range'] as Map<String, dynamic>) : null,
    stats: EnvStats.fromJson(jm(j['stats'])),
  );
  final String variable;
  final String label;
  final String? unit;
  final int sensors;
  final List<String> origins;
  final List<double?> values;
  final EnvRange? range;
  final EnvStats stats;

  bool get simulated => origins.contains('SIMULATED');
  bool get empty => values.every((v) => v == null);
}

/// A range a person set (alert rule) that applies in the zone.
class EnvRule {
  const EnvRule({
    required this.name,
    required this.label,
    required this.appliesTo,
    required this.severity,
    this.unit,
    this.min,
    this.max,
  });
  factory EnvRule.fromJson(Map<String, dynamic> j) => EnvRule(
    name: js(j['name']),
    label: js(j['label'], js(j['variable'])),
    unit: jsn(j['unit']),
    min: jd(j['min']),
    max: jd(j['max']),
    appliesTo: js(j['applies_to'], 'zone'),
    severity: js(j['severity'], 'warning'),
  );
  final String name;
  final String label;
  final String? unit;
  final double? min;
  final double? max;

  /// all · zone · sensor
  final String appliesTo;
  final String severity;
}

/// One parameter of a species growing in the zone, from its published profile (ADR-086, 097).
class EnvCropRange {
  const EnvCropRange({
    required this.crop,
    required this.profile,
    required this.label,
    required this.unit,
    required this.optimal,
    required this.warning,
    required this.critical,
    required this.verification,
    this.stage,
  });
  factory EnvCropRange.fromJson(Map<String, dynamic> j) {
    List<double?> pair(Object? v) {
      final l = v is List ? v : const [];
      return [l.isNotEmpty ? jd(l[0]) : null, l.length > 1 ? jd(l[1]) : null];
    }

    return EnvCropRange(
      crop: js(j['crop']),
      profile: js(j['profile']),
      label: js(j['label'], js(j['measurement'])),
      unit: js(j['unit']),
      optimal: pair(j['optimal']),
      warning: pair(j['warning']),
      critical: pair(j['critical']),
      verification: js(j['verification'], 'illustrative'),
      stage: jsn(j['stage']),
    );
  }
  final String crop;
  final String profile;
  final String label;
  final String unit;
  final List<double?> optimal;
  final List<double?> warning;
  final List<double?> critical;

  /// illustrative · unverified · verified — as people marked it in the Knowledge Center.
  final String verification;
  final String? stage;
}

/// Environmental Monitoring for one zone and window (`EnvironmentOut`).
class BrainEnvironment {
  const BrainEnvironment({
    required this.zones,
    required this.range,
    required this.stepS,
    required this.values,
    required this.series,
    required this.rules,
    required this.cropRanges,
    required this.crops,
    required this.irrigation,
    this.zoneId,
    this.brainTime,
    this.since,
  });
  factory BrainEnvironment.fromJson(Map<String, dynamic> j) {
    final w = jm(j['window']);
    return BrainEnvironment(
      zones: [for (final z in jl(j['zones'])) EnvZoneItem.fromJson(z)],
      zoneId: jsn(j['zone_id']),
      brainTime: jt(j['brain_time']),
      range: js(w['range'], '24h'),
      since: jt(w['since']),
      stepS: ji(w['step_s']),
      values: [for (final v in jl(j['values'])) EnvValue.fromJson(v)],
      series: [for (final s in jl(j['series'])) EnvSeries.fromJson(s)],
      rules: [for (final r in jl(j['rules'])) EnvRule.fromJson(r)],
      cropRanges: [for (final r in jl(j['crop_ranges'])) EnvCropRange.fromJson(r)],
      crops: [for (final c in jl(j['crops'])) EnvCrop.fromJson(c)],
      irrigation: js(jm(j['irrigation'])['reason']),
    );
  }
  final List<EnvZoneItem> zones;
  final String? zoneId;
  final DateTime? brainTime;
  final String range;
  final DateTime? since;
  final int stepS;
  final List<EnvValue> values;
  final List<EnvSeries> series;
  final List<EnvRule> rules;
  final List<EnvCropRange> cropRanges;
  final List<EnvCrop> crops;
  final String irrigation;

  EnvZoneItem? get zone {
    for (final z in zones) {
      if (z.id == zoneId) return z;
    }
    return null;
  }
}

/// Why a crop of the zone gives (or does not give) its species' ranges — Lefi Desktop's words.
String cropKnowledgeLabel(String k) => switch (k) {
  'ranges' => 'Its species’ values apply here.',
  'no_parameters' =>
    'Its published profile has no parameters yet: no species range applies. Values typed for one plant only apply '
        'to that plant.',
  'no_profile' => 'No profile for this crop yet in the AI Knowledge Center.',
  'draft_only' => 'Its profile is being prepared (draft or in review): nothing applies until it is published.',
  'several_profiles' => 'Several published profiles exist for this crop: none is chosen.',
  _ => humanize(k),
};

String verificationLabel(String v) => switch (v) {
  'verified' => 'Verified',
  'unverified' => 'Not verified',
  'illustrative' => 'Illustrative · not agronomic advice',
  _ => humanize(v),
};

/// "18 – 26" · "≥ 18" · "≤ 26" · "—"; numbers without trailing zeros.
String fmtEnvRange(double? min, double? max, [String? unit]) {
  String n(double v) => v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(v.abs() < 10 ? 2 : 1);
  final u = unit == null || unit.isEmpty ? '' : ' $unit';
  if (min == null && max == null) return '—';
  if (min == null) return '≤ ${n(max!)}$u';
  if (max == null) return '≥ ${n(min)}$u';
  return '${n(min)} – ${n(max)}$u';
}

String fmtEnvValue(double? v, [String? unit]) {
  if (v == null) return '—';
  final s = v.abs() >= 100 ? v.toStringAsFixed(0) : v.toStringAsFixed(1);
  return unit == null || unit.isEmpty ? s : '$s $unit';
}
