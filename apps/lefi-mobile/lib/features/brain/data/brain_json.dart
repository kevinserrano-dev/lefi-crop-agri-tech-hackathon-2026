/// Tolerant readers for Lefi Brain's JSON: a missing or wrongly typed field becomes empty, never
/// an invented value.
library;

String js(Object? v, [String fallback = '']) => v is String ? v : fallback;
String? jsn(Object? v) => v is String && v.isNotEmpty ? v : null;
int ji(Object? v) => v is num ? v.toInt() : 0;
int? jin(Object? v) => v is num ? v.toInt() : null;
double? jd(Object? v) => v is num ? v.toDouble() : null;
bool jb(Object? v) => v == true;
Map<String, dynamic> jm(Object? v) => v is Map<String, dynamic> ? v : const {};
List<Map<String, dynamic>> jl(Object? v) => [
  for (final x in v is List ? v : const [])
    if (x is Map<String, dynamic>) x,
];
List<String> jstrs(Object? v) => [for (final x in v is List ? v : const []) x.toString()];
DateTime? jt(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

String _two(int v) => v.toString().padLeft(2, '0');

/// "14:05" today, "Yesterday 14:05", "3/11 14:05" otherwise.
String brainWhen(DateTime? t, {DateTime? now}) {
  if (t == null) return '—';
  final n = now ?? DateTime.now();
  final hm = '${_two(t.hour)}:${_two(t.minute)}';
  final day = DateTime(t.year, t.month, t.day);
  final today = DateTime(n.year, n.month, n.day);
  final diff = today.difference(day).inDays;
  if (diff == 0) return 'Today $hm';
  if (diff == 1) return 'Yesterday $hm';
  if (diff == -1) return 'Tomorrow $hm';
  return '${t.day}/${t.month} $hm';
}

String brainHm(DateTime? t) => t == null ? '—' : '${_two(t.hour)}:${_two(t.minute)}';

/// "2026-11-13" → "13/11/2026".
String brainDate(String? iso) {
  final d = iso == null ? null : DateTime.tryParse(iso);
  return d == null ? '—' : '${d.day}/${d.month}/${d.year}';
}

String plural(int n, String one, [String? many]) => '$n ${n == 1 ? one : (many ?? '${one}s')}';

/// "in_progress" → "In progress".
String humanize(String s) {
  if (s.isEmpty) return s;
  final t = s.replaceAll('_', ' ');
  return t[0].toUpperCase() + t.substring(1);
}
