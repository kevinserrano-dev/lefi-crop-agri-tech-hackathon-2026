import 'package:flutter/painting.dart';

import 'lefi_colors.dart';

/// Typography helpers. The bundled fonts are variable fonts, so every style sets
/// the `wght` axis explicitly in addition to [FontWeight].
abstract final class LefiText {
  static const display = 'Outfit';
  static const sans = 'Manrope';
  static const monoFamily = 'JetBrainsMono';

  static TextStyle _s(
    String family,
    double size,
    int weight, {
    Color color = LefiColors.text,
    double? height,
    double? letterSpacing,
  }) => TextStyle(
    fontFamily: family,
    fontSize: size,
    fontWeight: FontWeight.values[(weight ~/ 100) - 1],
    fontVariations: [FontVariation('wght', weight.toDouble())],
    color: color,
    height: height,
    letterSpacing: letterSpacing,
    decorationColor: color,
  );

  /// Headings — Outfit.
  static TextStyle outfit(
    double size, {
    int weight = 600,
    Color color = LefiColors.ink,
    double? height,
    double? letterSpacing,
  }) => _s(display, size, weight, color: color, height: height, letterSpacing: letterSpacing);

  /// Body — Manrope.
  static TextStyle body(
    double size, {
    int weight = 400,
    Color color = LefiColors.text,
    double? height,
    double? letterSpacing,
  }) => _s(sans, size, weight, color: color, height: height, letterSpacing: letterSpacing);

  /// Identifiers, timestamps, image labels — JetBrains Mono.
  static TextStyle mono(double size, {int weight = 500, Color color = LefiColors.ink, double? height}) =>
      _s(monoFamily, size, weight, color: color, height: height);

  /// Uppercase overline ("CURRENT SHIFT", "DEMO ACCOUNTS").
  static TextStyle overline({double size = 11.5, Color color = LefiColors.subtle}) =>
      _s(sans, size, 800, color: color, letterSpacing: size * 0.07);
}
