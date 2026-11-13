import '../domain/greenhouse.dart';

String thousands(int n) => n.toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');

/// Short out-of-range summary shown on zone cards. Ranges are placeholder crop
/// profile values (see [Metric]); the Brain's rules engine is authoritative.
String? zoneAlert(Zone z) {
  final m = z.value(Metric.moisture), ec = z.value(Metric.ec)!, rh = z.value(Metric.rh)!;
  if (m != null && m < Metric.moisture.low) return 'Moisture ${m.round()} % · critical';
  if (ec > Metric.ec.high) return 'EC ${ec.toStringAsFixed(2)} mS/cm · above range';
  if (rh > Metric.rh.high) return 'Humidity ${rh.round()} % · above range';
  if (z.reEntryRestricted) return 'Closed for spraying until 14:00';
  return null;
}
