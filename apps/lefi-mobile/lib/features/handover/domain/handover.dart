import '../../../shared/domain/glyph.dart';
import '../../home/domain/dashboard.dart';

class HandoverItem {
  const HandoverItem(this.severity, this.text, this.meta);
  final Severity severity;
  final String text;
  final String meta;
}

class HandoverSection {
  const HandoverSection(this.title, this.glyph, this.items);
  final String title;
  final Glyph glyph;
  final List<HandoverItem> items;
}

class ShiftHandover {
  const ShiftHandover({
    required this.fromShift,
    required this.fromPerson,
    required this.toShift,
    required this.summary,
    required this.summaryTime,
    required this.sections,
    required this.recommendations,
  });

  final String fromShift;
  final String fromPerson;
  final String toShift;

  /// AI-generated — always labelled as such in the UI.
  final String summary;
  final String summaryTime;
  final List<HandoverSection> sections;
  final List<String> recommendations;
}

abstract interface class HandoverRepository {
  Future<ShiftHandover> current();
  Future<void> acknowledge(String by);
}
