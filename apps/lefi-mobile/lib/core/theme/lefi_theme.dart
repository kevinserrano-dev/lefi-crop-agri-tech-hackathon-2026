import 'package:flutter/material.dart';

import 'lefi_colors.dart';
import 'lefi_text.dart';

/// Material 3 theme configured with the Lefi Crop tokens.
ThemeData buildLefiTheme({TargetPlatform? platform}) {
  final scheme = ColorScheme.fromSeed(
    seedColor: LefiColors.brandDark,
    primary: LefiColors.brandDark,
    secondary: LefiColors.brand,
    surface: LefiColors.screen,
    error: LefiColors.dangerDeep,
  );
  return ThemeData(
    useMaterial3: true,
    platform: platform,
    colorScheme: scheme,
    scaffoldBackgroundColor: LefiColors.screen,
    fontFamily: LefiText.sans,
    splashFactory: InkSparkle.splashFactory,
    textSelectionTheme: const TextSelectionThemeData(cursorColor: LefiColors.brandDark),
    dividerColor: LefiColors.divider,
    textTheme: TextTheme(bodyMedium: LefiText.body(14), bodyLarge: LefiText.body(16), titleLarge: LefiText.outfit(22)),
  );
}
