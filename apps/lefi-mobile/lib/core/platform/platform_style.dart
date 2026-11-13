import 'package:flutter/material.dart';

import '../review_flags.dart';

/// The design has two chromes: iOS (centred titles, "‹ Back" labels, tab bar)
/// and Android (left titles, arrow back, Material 3 navigation bar).
extension PlatformStyle on BuildContext {
  bool get isCupertino {
    final p = Theme.of(this).platform;
    return p == TargetPlatform.iOS || p == TargetPlatform.macOS;
  }
}

/// Optional override for design reviews (see [ReviewFlags]).
TargetPlatform? platformOverride() => switch (ReviewFlags.platform) {
  'ios' => TargetPlatform.iOS,
  'android' => TargetPlatform.android,
  _ => null,
};
