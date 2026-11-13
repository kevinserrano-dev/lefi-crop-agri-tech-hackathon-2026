import 'package:flutter/painting.dart';

/// Colour tokens taken 1:1 from the Lefi Crop Mobile App design prototype.
///
/// Keep names semantic; screens must never hard-code hex values.
abstract final class LefiColors {
  // Surfaces
  static const screen = Color(0xFFF7F9F6);
  static const canvas = Color(0xFFE8EEEA);
  static const surface = Color(0xFFFFFFFF);
  static const surfaceMuted = Color(0xFFF6F8F6);
  static const surfaceNeutral = Color(0xFFF1F4F1);
  static const surfaceTint = Color(0xFFF7FAF8);
  static const segmentTrack = Color(0xFFE9EEEA);
  static const progressTrack = Color(0xFFEDF1EE);
  static const skeleton = Color(0xFFE6EBE7);
  static const skeletonSoft = Color(0xFFEDF1EE);
  static const skeletonSofter = Color(0xFFF0F3F0);

  // Brand
  static const brandDark = Color(0xFF163D32);
  static const brandDeep = Color(0xFF0F2A22);
  static const brand = Color(0xFF54B985);
  static const brandTint = Color(0xFFE6F3EB);
  static const brandBorder = Color(0xFFCFE3D6);
  static const brandPill = Color(0xFFCFE8D9);
  static const heroTrack = Color(0xFF2B5A4B);
  static const mint = Color(0xFF9FD7B8);
  static const mintSoft = Color(0xFFC9E3D5);
  static const mintPale = Color(0xFFDCEDE3);
  static const link = Color(0xFF2E8A5C);
  static const leaf = Color(0xFF2E6B57);
  static const success = Color(0xFF2E9A63);

  // Ink (text)
  static const ink = Color(0xFF14231D);
  static const text = Color(0xFF1C2622);
  static const body = Color(0xFF22302A);
  static const strong = Color(0xFF33413B);
  static const secondary = Color(0xFF4C5A54);
  static const muted = Color(0xFF5F6E67);
  static const subtle = Color(0xFF6B7871);
  static const faint = Color(0xFF8A968F);
  static const chevron = Color(0xFFA3AEA8);
  static const tabInactive = Color(0xFF7B8781);

  // Lines
  static const border = Color(0xFFE3E9E4);
  static const divider = Color(0xFFF0F3F0);
  static const chipBorder = Color(0xFFDCE3DE);
  static const inputBorder = Color(0xFFD5DED8);
  static const hairline = Color(0xFFE8EDE9);
  static const checkboxBorder = Color(0xFFB9C6BE);
  static const toggleOff = Color(0xFFDCE3DE);

  // Danger / alerts
  static const danger = Color(0xFFD64545);
  static const dangerDeep = Color(0xFFA12F2F);
  static const dangerStop = Color(0xFFC93A3A);
  static const dangerBorder = Color(0xFFF0CFCB);
  static const dangerWash = Color(0xFFFFF8F7);
  static const dangerWash2 = Color(0xFFFFF6F5);
  static const dangerInk = Color(0xFF7A2525);
  static const toastBad = Color(0xFF5A1E1E);

  // Amber / recommendations
  static const amberWash = Color(0xFFFFF9EC);
  static const amberBorder = Color(0xFFF1DFB4);
  static const amberInk = Color(0xFF3D3215);
  static const amberDeep = Color(0xFF6B4A00);

  // AI (violet)
  static const aiWash = Color(0xFFFAF8FE);
  static const aiDash = Color(0xFFCDBFEA);
  static const aiBorder = Color(0xFFDCD2F0);
  static const aiTint = Color(0xFFF3EFFA);
  static const simulation = Color(0xFF5B3FA0);

  // Placeholder imagery (striped "photo" blocks in the design)
  static const photoA = Color(0xFFDDEBE1);
  static const photoB = Color(0xFFE8F1EB);
  static const photoDarkA = Color(0xFF2B4A3D);
  static const photoDarkB = Color(0xFF305243);
  static const photoLabel = Color(0xFF4F6B5D);
  static const photoBorderDashed = Color(0xFFB9CBBF);
  static const cameraBg = Color(0xFF0B1210);
}
