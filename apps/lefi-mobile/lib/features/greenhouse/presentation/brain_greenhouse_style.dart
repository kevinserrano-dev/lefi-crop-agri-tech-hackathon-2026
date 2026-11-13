import 'package:flutter/widgets.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../core/theme/tone.dart';
import '../../brain/data/brain_json.dart';
import '../domain/brain_greenhouse.dart';

/// Health a person recorded (ADR-070): never a score, never an AI estimate.
(String, Tone) plantHealthTag(String? health) => switch (health) {
  'healthy' => ('Healthy', Tone.ok),
  'watch' => ('Watch', Tone.warn),
  'problem' => ('Problem', Tone.crit),
  _ => ('Not checked', Tone.off),
};

String issueLabel(String i) => switch (i) {
  'pest' => 'Pests',
  'disease' => 'Disease',
  'nutrient' => 'Nutrients',
  'water' => 'Water',
  'environment' => 'Environment',
  'damage' => 'Damage',
  'growth' => 'Growth',
  _ => 'Other',
};

/// A reading's provenance and data state, first (ADR-012, 059).
(String, Tone) readingBadge(EnvValue v) => switch (v.state) {
  'receiving' when v.simulated => ('SIMULATED', Tone.ai),
  'receiving' => ('LIVE', Tone.ok),
  'not_receiving' => ('STALE', Tone.warn),
  'error' => ('ERROR', Tone.crit),
  _ => ('NO DATA', Tone.off),
};

/// Against the zone's range (a person's rule, else the species' optimal range, ADR-097).
(String, Tone) rangeVerdict(EnvValue v) {
  if (v.value == null) return ('No value', Tone.off);
  if (v.range == null) return ('No range set', Tone.neutral);
  return v.inRange == false ? ('Out of range', Tone.crit) : ('In range', Tone.ok);
}

String fmtNum(double x) {
  if (x == x.roundToDouble()) return x.toInt().toString();
  final s = x.abs() >= 100 ? x.toStringAsFixed(0) : (x.abs() >= 10 ? x.toStringAsFixed(1) : x.toStringAsFixed(2));
  return s.contains('.') ? s.replaceFirst(RegExp(r'\.?0+$'), '') : s;
}

String rangeText(EnvRange r) {
  final lo = r.min == null ? null : fmtNum(r.min!);
  final hi = r.max == null ? null : fmtNum(r.max!);
  final span = lo != null && hi != null ? '$lo–$hi' : (lo != null ? '≥ $lo' : (hi != null ? '≤ $hi' : '—'));
  return '$span · ${r.source == 'species' ? 'species profile' : 'rule'}';
}

IconData readingIcon(String variable) => switch (variable) {
  final v when v.contains('temp') => Symbols.thermostat_rounded,
  final v when v.contains('humid') => Symbols.humidity_percentage_rounded,
  final v when v.contains('ec') || v.contains('tds') => Symbols.bolt_rounded,
  final v when v.contains('moist') || v.contains('water') => Symbols.water_drop_rounded,
  final v when v.contains('ph') => Symbols.science_rounded,
  final v when v.contains('light') || v.contains('lux') || v.contains('ppfd') => Symbols.light_mode_rounded,
  final v when v.contains('co2') => Symbols.co2_rounded,
  _ => Symbols.sensors_rounded,
};

String zoneStatusLabel(String s) => humanize(s);

Tone zoneStatusTone(String s) => switch (s) {
  'active' => Tone.ok,
  'maintenance' => Tone.warn,
  _ => Tone.off,
};

String purposeLabel(BrainZone z) => switch (z.purpose) {
  null => 'Purpose not set',
  'other' => z.purposeOther ?? 'Other',
  final p => humanize(p),
};

String systemLabel(String s) => switch (s) {
  'containers' => 'Containers / substrate',
  'nft' => 'NFT',
  'dwc' => 'DWC / floating rafts',
  'soil' => 'Soil / beds',
  'not_configured' => 'Not configured',
  _ => humanize(s),
};
