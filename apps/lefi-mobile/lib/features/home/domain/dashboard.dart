import '../../../shared/domain/glyph.dart';

/// Severity used by dashboard rows and chips.
enum Severity { ok, warn, crit, info, ai, off }

/// Where tapping a dashboard element leads.
sealed class AppTarget {
  const AppTarget();
}

class TaskTarget extends AppTarget {
  const TaskTarget(this.id);
  final String id;
}

class ZoneTarget extends AppTarget {
  const ZoneTarget(this.id);
  final String id;
}

class PlantTarget extends AppTarget {
  const PlantTarget(this.id);
  final String id;
}

class InspectTarget extends AppTarget {
  const InspectTarget([this.plantId]);
  final String? plantId;
}

class TabTarget extends AppTarget {
  const TabTarget(this.tab, {this.teamScope = false});
  final String tab;
  final bool teamScope;
}

class HandoverTarget extends AppTarget {
  const HandoverTarget();
}

class ReportTarget extends AppTarget {
  const ReportTarget();
}

/// Screens designed but not built in this iteration (devices, robot, scanner).
class PlannedTarget extends AppTarget {
  const PlannedTarget(this.feature);
  final String feature;
}

class HeroChip {
  const HeroChip(this.label, this.severity);
  final String label;
  final Severity severity;
}

class DashboardHero {
  const DashboardHero({
    required this.label,
    required this.value,
    required this.sub,
    required this.progress,
    this.unit = '',
    this.chips = const [],
  });

  final String label;
  final String value;
  final String unit;
  final String sub;

  /// 0..1
  final double progress;
  final List<HeroChip> chips;
}

class QuickAction {
  const QuickAction(this.label, this.glyph, this.target);
  final String label;
  final Glyph glyph;
  final AppTarget target;
}

class DashboardRow {
  const DashboardRow({
    required this.glyph,
    required this.severity,
    required this.title,
    required this.sub,
    required this.chip,
    required this.chipSeverity,
    required this.target,
  });

  final Glyph glyph;
  final Severity severity;
  final String title;
  final String sub;
  final String chip;
  final Severity chipSeverity;
  final AppTarget target;
}

class DashboardSection {
  const DashboardSection(this.title, this.rows);
  final String title;
  final List<DashboardRow> rows;
}

class Kpi {
  const Kpi(this.value, this.label, this.sub);
  final String value;
  final String label;
  final String sub;
}

class Instruction {
  const Instruction(this.glyph, this.severity, this.text);
  final Glyph glyph;
  final Severity severity;
  final String text;
}

/// Lefi AI as Lefi Brain reports it (ADR-067), shown instead of the demo AI row.
class DashboardAi {
  const DashboardAi({
    required this.available,
    required this.state,
    required this.reason,
    this.model,
    this.stopped = false,
  });
  final bool available;

  /// A person stopped it (the kill switch `lefi ai off` shares, ADR-085).
  final bool stopped;
  final String state;
  final String reason;
  final String? model;
}

/// Where the whole home summary comes from, and when (ADR-012).
class DashboardSource {
  const DashboardSource({required this.label, required this.at});

  /// e.g. "Lefi Brain".
  final String label;

  /// Lefi Brain's clock, local "HH:MM".
  final String at;
}

class Dashboard {
  const Dashboard({
    required this.hero,
    this.quickActions = const [],
    this.sections = const [],
    this.kpis = const [],
    this.instructions = const [],
    this.showRobotCard = false,
    this.showReportIssue = false,
    this.source,
    this.ai,
    this.unavailable = const [],
  });

  /// Set when the summary comes from Lefi Brain; null for demo fixtures.
  final DashboardSource? source;
  final DashboardAi? ai;

  /// What Lefi Brain cannot provide yet, said plainly instead of showing sample data.
  final List<String> unavailable;

  final DashboardHero hero;
  final List<QuickAction> quickActions;
  final List<DashboardSection> sections;
  final List<Kpi> kpis;
  final List<Instruction> instructions;
  final bool showRobotCard;
  final bool showReportIssue;
}
