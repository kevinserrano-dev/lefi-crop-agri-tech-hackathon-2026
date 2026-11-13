import 'package:flutter/widgets.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../core/theme/tone.dart';
import '../domain/brain_task.dart';

Tone brainPriorityTone(String p) => switch (p) {
  'urgent' => Tone.crit,
  'high' => Tone.warn,
  'normal' => Tone.info,
  _ => Tone.neutral,
};

String brainPriorityLabel(String p) => switch (p) {
  'urgent' => 'Urgent',
  'high' => 'High',
  'normal' => 'Normal',
  'low' => 'Low',
  _ => p,
};

Tone brainStatusTone(String s) => switch (s) {
  'open' => Tone.neutral,
  'in_progress' => Tone.info,
  'awaiting' => Tone.warn,
  'verified' || 'done' => Tone.ok,
  _ => Tone.off,
};

/// Where a task comes from: Lefi Brain's rules engine, a Lefi AI finding to confirm, or a person.
(String, Tone, IconData) taskSourceTag(BrainTask t) => switch (t.source) {
  'rule' => ('From an alert', Tone.neutral, Symbols.rule_rounded),
  'ai' => ('Lefi AI · to confirm', Tone.ai, Symbols.psychiatry_rounded),
  _ => ('By ${t.createdBy}', Tone.neutral, Symbols.person_rounded),
};

IconData taskKindIcon(String k) => switch (k) {
  'inspect_plants' => Symbols.potted_plant_rounded,
  'check_environment' => Symbols.thermostat_rounded,
  'check_sensor' => Symbols.sensors_rounded,
  'check_device' => Symbols.memory_rounded,
  'check_system' => Symbols.dns_rounded,
  'robot_inspection' => Symbols.smart_toy_rounded,
  _ => Symbols.task_alt_rounded,
};
