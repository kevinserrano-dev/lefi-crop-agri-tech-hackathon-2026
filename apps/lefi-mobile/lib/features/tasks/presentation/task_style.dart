import 'package:flutter/painting.dart';

import '../../../core/theme/tone.dart';
import '../domain/task.dart';

Tone priorityTone(TaskPriority p) => switch (p) {
  TaskPriority.critical => Tone.crit,
  TaskPriority.high => Tone.warn,
  TaskPriority.normal => Tone.info,
};

String priorityLabel(TaskPriority p) => switch (p) {
  TaskPriority.critical => 'Critical',
  TaskPriority.high => 'High',
  TaskPriority.normal => 'Normal',
};

String statusLabel(TaskStatus s) => switch (s) {
  TaskStatus.open => 'Open',
  TaskStatus.inProgress => 'In progress',
  TaskStatus.completed => 'Completed',
};

(Color bg, Color fg) statusColors(TaskStatus s) => switch (s) {
  TaskStatus.open => (const Color(0xFFEEF1EE), const Color(0xFF33413B)),
  TaskStatus.inProgress => (const Color(0xFFE3EEF7), const Color(0xFF1E5C8A)),
  TaskStatus.completed => (const Color(0xFFE4F4EA), const Color(0xFF1F7A4D)),
};
