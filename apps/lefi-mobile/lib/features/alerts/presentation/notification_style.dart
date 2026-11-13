import 'package:flutter/widgets.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../core/theme/tone.dart';
import '../domain/app_notification.dart';

IconData categoryIcon(NotificationCategory c) => switch (c) {
  NotificationCategory.critical => Symbols.crisis_alert_rounded,
  NotificationCategory.task => Symbols.task_alt_rounded,
  NotificationCategory.health => Symbols.psychiatry_rounded,
  NotificationCategory.maintenance => Symbols.build_rounded,
  NotificationCategory.robot => Symbols.smart_toy_rounded,
  NotificationCategory.shift => Symbols.event_rounded,
};

Tone categoryTone(NotificationCategory c) => switch (c) {
  NotificationCategory.critical => Tone.crit,
  NotificationCategory.task => Tone.info,
  NotificationCategory.health => Tone.warn,
  NotificationCategory.maintenance => Tone.maint,
  NotificationCategory.robot => Tone.ai,
  NotificationCategory.shift => Tone.brand,
};
