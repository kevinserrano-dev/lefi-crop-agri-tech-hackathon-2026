import 'package:flutter/painting.dart';

/// Status tone (foreground / background / dot) used by chips, icons and badges.
///
/// Mirrors the `T` palette of the design prototype.
enum Tone {
  ok(Color(0xFF1F7A4D), Color(0xFFE4F4EA), Color(0xFF54B985), 'Healthy'),
  warn(Color(0xFF8A5A00), Color(0xFFFCF0D6), Color(0xFFE0A21B), 'Warning'),
  crit(Color(0xFFA12F2F), Color(0xFFFBE4E2), Color(0xFFD64545), 'Critical'),
  info(Color(0xFF1E5C8A), Color(0xFFE3EEF7), Color(0xFF3C84C0), 'Info'),
  off(Color(0xFF5E6B65), Color(0xFFEEF1EE), Color(0xFF9AA6A0), 'Offline'),
  ai(Color(0xFF5B3FA0), Color(0xFFEDE7F6), Color(0xFF8A6CD0), 'AI'),
  brand(Color(0xFF163D32), Color(0xFFE6F3EB), Color(0xFF54B985), ''),
  maint(Color(0xFF7A4A22), Color(0xFFF4EBDF), Color(0xFFA87A4A), 'Maintenance'),
  neutral(Color(0xFF4C5A54), Color(0xFFF1F4F1), Color(0xFF9AA6A0), '');

  const Tone(this.fg, this.bg, this.dot, this.label);

  final Color fg;
  final Color bg;
  final Color dot;
  final String label;

  /// Health score → tone (design rule: ≥85 ok, ≥70 warn, else critical).
  static Tone ofHealth(num health) => health >= 85 ? Tone.ok : (health >= 70 ? Tone.warn : Tone.crit);
}
