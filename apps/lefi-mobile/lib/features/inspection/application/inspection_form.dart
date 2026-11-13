import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../../greenhouse/application/greenhouse_providers.dart';
import '../../greenhouse/domain/greenhouse.dart';

part 'inspection_form.g.dart';

const inspectionSymptoms = [
  'Wilting',
  'Yellowing',
  'Brown leaf edges',
  'Spots or lesions',
  'Curling',
  'Pests visible',
  'Mould or fuzz',
  'Stunted growth',
];
const inspectionColours = [
  ('Pale green', 0xFFC9DFA0),
  ('Yellow', 0xFFE8D35A),
  ('Brown', 0xFF8A5A2B),
  ('Unexpected purple', 0xFF7B3F7A),
  ('Grey cast', 0xFF9AA19C),
];
const inspectionSeverities = ['Mild', 'Moderate', 'Severe'];

enum AssessmentType {
  growerReview('Grower review', 'Sofia Marchetti reviews within 2 h'),
  labSample('Lab sample', 'Bag a sample for the lab courier (16:00)'),
  robotRescan('Robot re-scan', 'Automated re-scan · Phase 4', available: false);

  const AssessmentType(this.label, this.sub, {this.available = true});
  final String label;
  final String sub;
  final bool available;
}

class InspectionDraft {
  const InspectionDraft({
    this.query = '',
    this.plant,
    this.error = '',
    this.photos = const [],
    this.symptoms = const {},
    this.colours = const {},
    this.severity = 'Moderate',
    this.comment = '',
    this.requestAssessment = false,
    this.assessment = AssessmentType.growerReview,
    this.saved = false,
  });

  final String query;
  final Plant? plant;
  final String error;
  final List<String> photos;
  final Set<String> symptoms;
  final Set<String> colours;
  final String severity;
  final String comment;
  final bool requestAssessment;
  final AssessmentType assessment;
  final bool saved;

  InspectionDraft copyWith({
    String? query,
    Plant? plant,
    bool clearPlant = false,
    String? error,
    List<String>? photos,
    Set<String>? symptoms,
    Set<String>? colours,
    String? severity,
    String? comment,
    bool? requestAssessment,
    AssessmentType? assessment,
    bool? saved,
  }) => InspectionDraft(
    query: query ?? this.query,
    plant: clearPlant ? null : (plant ?? this.plant),
    error: error ?? this.error,
    photos: photos ?? this.photos,
    symptoms: symptoms ?? this.symptoms,
    colours: colours ?? this.colours,
    severity: severity ?? this.severity,
    comment: comment ?? this.comment,
    requestAssessment: requestAssessment ?? this.requestAssessment,
    assessment: assessment ?? this.assessment,
    saved: saved ?? this.saved,
  );
}

class InspectionValidation implements Exception {
  const InspectionValidation(this.message);
  final String message;
}

@riverpod
class InspectionForm extends _$InspectionForm {
  @override
  InspectionDraft build(String? initialPlantId) {
    if (initialPlantId == null) return const InspectionDraft();
    final plants = ref.read(plantsProvider).value ?? const [];
    final p = plants.where((x) => x.id == initialPlantId).firstOrNull;
    return InspectionDraft(query: initialPlantId, plant: p);
  }

  void setQuery(String q) => state = state.copyWith(query: q, error: '');

  Future<void> find() async {
    final q = state.query.trim().toUpperCase();
    if (q.isEmpty) {
      state = state.copyWith(error: 'Enter a plant ID such as P-0412 or a position such as B-03.');
      return;
    }
    final plants = await ref.read(plantsProvider.future);
    final policy = await ref.read(accessPolicyProvider.future);
    final f = plants
        .where((x) => (x.id == q || x.position == q || x.id == 'P-${q.padLeft(4, '0')}') && policy.canSeeZone(x.zoneId))
        .firstOrNull;
    state = f == null
        ? state.copyWith(clearPlant: true, error: 'No plant “${state.query}” in your zones.')
        : state.copyWith(plant: f, error: '');
  }

  void addPhoto(String id) => state = state.copyWith(photos: [...state.photos, id]);

  void toggleSymptom(String s) => state = state.copyWith(symptoms: _toggle(state.symptoms, s));
  void toggleColour(String c) => state = state.copyWith(colours: _toggle(state.colours, c));
  void setSeverity(String s) => state = state.copyWith(severity: s);
  void setComment(String c) => state = state.copyWith(comment: c);
  void toggleAssessment() => state = state.copyWith(requestAssessment: !state.requestAssessment);
  void setAssessment(AssessmentType a) => state = state.copyWith(assessment: a);

  /// Saves the inspection as a HUMAN observation (never mixed with AI findings).
  Future<void> submit() async {
    final d = state;
    final p = d.plant;
    if (p == null) {
      state = d.copyWith(error: 'Find the plant first.');
      throw const InspectionValidation('Find the plant first.');
    }
    if (d.photos.isEmpty && d.symptoms.isEmpty) {
      throw const InspectionValidation('Add a photo or at least one symptom.');
    }
    await Future<void>.delayed(const Duration(milliseconds: 900));
    final user = ref.read(currentUserProvider);
    final text = [
      d.symptoms.isNotEmpty ? d.symptoms.join(', ') : 'No visible symptoms',
      if (d.colours.isNotEmpty) 'leaf colour: ${d.colours.join(', ').toLowerCase()}',
      '${d.severity.toLowerCase()} severity',
      if (d.comment.trim().isNotEmpty) d.comment.trim(),
    ].join(' · ');
    ref
        .read(sessionObservationsProvider.notifier)
        .add(
          p.id,
          Observation(
            source: ObservationSource.human,
            author: '${user.name} · ${user.short}',
            time: 'Today · 10:4${ref.read(sessionObservationsProvider).length % 10}',
            text: text,
          ),
        );
    state = d.copyWith(saved: true);
  }

  void reset() => state = const InspectionDraft();

  static Set<String> _toggle(Set<String> s, String v) => s.contains(v) ? ({...s}..remove(v)) : {...s, v};
}
