import 'package:flutter/widgets.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../features/home/domain/dashboard.dart';
import '../../shared/domain/glyph.dart';
import '../theme/tone.dart';

IconData glyphIcon(Glyph g) => switch (g) {
  Glyph.moisture => Symbols.water_drop_rounded,
  Glyph.ec => Symbols.bolt_rounded,
  Glyph.escalation => Symbols.campaign_rounded,
  Glyph.aiFinding => Symbols.psychiatry_rounded,
  Glyph.task => Symbols.task_alt_rounded,
  Glyph.humidity => Symbols.humidity_percentage_rounded,
  Glyph.plant => Symbols.potted_plant_rounded,
  Glyph.schedule => Symbols.schedule_rounded,
  Glyph.humanCheck => Symbols.person_check_rounded,
  Glyph.valve => Symbols.valve_rounded,
  Glyph.pump => Symbols.water_pump_rounded,
  Glyph.offline => Symbols.wifi_off_rounded,
  Glyph.battery => Symbols.battery_alert_rounded,
  Glyph.lab => Symbols.science_rounded,
  Glyph.warning => Symbols.warning_rounded,
  Glyph.hygiene => Symbols.clean_hands_rounded,
  Glyph.cold => Symbols.ac_unit_rounded,
  Glyph.report => Symbols.report_rounded,
  Glyph.groups => Symbols.groups_rounded,
  Glyph.devices => Symbols.device_hub_rounded,
  Glyph.handover => Symbols.sync_alt_rounded,
  Glyph.notifications => Symbols.notifications_rounded,
  Glyph.search => Symbols.search_rounded,
  Glyph.camera => Symbols.photo_camera_rounded,
  Glyph.qrScan => Symbols.qr_code_scanner_rounded,
  Glyph.history => Symbols.history_rounded,
  Glyph.incident => Symbols.crisis_alert_rounded,
  Glyph.temperature => Symbols.thermostat_rounded,
  Glyph.robot => Symbols.smart_toy_rounded,
};

Tone severityTone(Severity s) => switch (s) {
  Severity.ok => Tone.ok,
  Severity.warn => Tone.warn,
  Severity.crit => Tone.crit,
  Severity.info => Tone.info,
  Severity.ai => Tone.ai,
  Severity.off => Tone.off,
};
