import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/router/routes.dart';
import '../../../core/feedback/feedback.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/dashed_border.dart';
import '../../../core/widgets/inputs.dart';
import '../../../core/widgets/media.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/widgets/selectors.dart';
import '../../../shared/domain/role.dart';
import '../../auth/application/session.dart';
import '../../camera/presentation/camera_screen.dart';
import '../../greenhouse/application/greenhouse_providers.dart';
import '../../greenhouse/domain/greenhouse.dart';
import '../../tasks/presentation/task_detail_screen.dart';
import '../application/inspection_form.dart';

class InspectionScreen extends ConsumerStatefulWidget {
  const InspectionScreen({super.key, this.plantId});
  final String? plantId;

  @override
  ConsumerState<InspectionScreen> createState() => _InspectionScreenState();
}

class _InspectionScreenState extends ConsumerState<InspectionScreen> {
  late final _query = TextEditingController(text: widget.plantId ?? '');

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final provider = inspectionFormProvider(widget.plantId);
    final d = ref.watch(provider);
    final form = ref.read(provider.notifier);
    final user = ref.watch(currentUserProvider);
    final zones = {for (final z in ref.watch(zonesProvider).value ?? const <Zone>[]) z.id: z};
    final toast = ref.read(toastProvider.notifier);

    Future<void> capture() async {
      final id = await GoRouter.of(context).push<String>(Routes.camera, extra: CameraPurpose.inspection);
      if (id != null) {
        form.addPhoto(id);
        toast.show('Photo $id attached.');
      }
    }

    if (d.saved) {
      final p = d.plant!;
      return PushedScreen(
        title: 'Plant inspection',
        backLabel: 'Back',
        body: ListView(
          padding: const EdgeInsets.fromLTRB(24, 40, 24, 40),
          children: [
            Center(child: Image.asset('assets/brand/mascot-thumbsup.png', width: 150)),
            const SizedBox(height: 12),
            Text('Inspection saved', textAlign: TextAlign.center, style: LefiText.outfit(24)),
            for (final l in [
              '${p.id} · ${p.variety}',
              '${d.photos.length} photo(s) · ${d.symptoms.isEmpty ? 'no' : d.symptoms.length} symptom(s) · ${d.severity}',
              d.requestAssessment ? '${d.assessment.label} requested' : 'No additional assessment',
            ]) ...[
              const SizedBox(height: 12),
              Text(
                l,
                textAlign: TextAlign.center,
                style: LefiText.body(14, color: LefiColors.strong),
              ),
            ],
            const SizedBox(height: 22),
            LefiButton(
              label: 'View plant history',
              height: 52,
              fontSize: 15,
              onPressed: () => context.pushReplacement('${context.currentTabRoot}/plant/${p.id}'),
            ),
            const SizedBox(height: 8),
            LefiOutlineButton(
              label: 'Inspect another plant',
              onPressed: () {
                _query.clear();
                form.reset();
              },
            ),
          ],
        ),
      );
    }

    final p = d.plant;
    final canAi = user.role.can(Permission.aiInsights);
    return PushedScreen(
      title: 'Plant inspection',
      backLabel: 'Back',
      bottom: StickyActionBar(
        children: [
          LefiButton(
            label: 'Submit inspection',
            onPressed: () async {
              try {
                await ref.read(busyProvider.notifier).run('Saving inspection…', form.submit);
                final s = ref.read(provider);
                toast.show(
                  s.requestAssessment
                      ? '${s.assessment.label} requested for ${s.plant!.id}.'
                      : 'Inspection saved to ${s.plant!.id}.',
                );
              } on InspectionValidation catch (e) {
                toast.show(e.message, bad: true);
              }
            },
          ),
        ],
      ),
      body: ScrollBody(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
        children: [
          LefiCard(
            child: Gap(
              gap: 8,
              children: [
                Text('Find plant by ID or position', style: LefiText.body(13, weight: 700, color: LefiColors.strong)),
                Row(
                  children: [
                    Expanded(
                      child: LefiTextField(
                        controller: _query,
                        hint: 'P-0412 or B-03',
                        height: 48,
                        mono: true,
                        textCapitalization: TextCapitalization.characters,
                        onChanged: form.setQuery,
                        onSubmitted: (_) => form.find(),
                      ),
                    ),
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 92,
                      child: LefiButton(
                        label: 'Find',
                        icon: Symbols.search_rounded,
                        iconSize: 20,
                        height: 48,
                        radius: 12,
                        fontSize: 14,
                        onPressed: form.find,
                      ),
                    ),
                  ],
                ),
                if (d.error.isNotEmpty) Text(d.error, style: LefiText.body(13, color: LefiColors.dangerDeep)),
                if (p != null)
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(color: LefiColors.surfaceMuted, borderRadius: BorderRadius.circular(14)),
                    child: Row(
                      children: [
                        const StripedPlaceholder(width: 56, height: 56, stripe: 6),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('${p.id} · ${p.position}', style: LefiText.mono(15, weight: 600)),
                              Text(
                                '${p.variety} · ${p.zoneId} · ${zones[p.zoneId]?.label ?? ''}',
                                style: LefiText.body(12.5, color: LefiColors.muted),
                              ),
                              if (canAi) _AiSummary(plantId: p.id),
                            ],
                          ),
                        ),
                        ToneChip(
                          canAi ? 'AI health ${p.health}' : 'Health hidden',
                          tone: Tone.ofHealth(p.health),
                          fontSize: 11.5,
                          radius: 8,
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          LefiCard(
            child: Gap(
              children: [
                Text('Inspection photo', style: LefiText.outfit(16)),
                if (d.photos.isEmpty)
                  SizedBox(
                    height: 120,
                    child: DashedBorder(
                      color: const Color(0xFF9FC7AF),
                      radius: 16,
                      child: Material(
                        color: const Color(0xFFF4FAF6),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(16),
                          onTap: capture,
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(Symbols.photo_camera_rounded, size: 36, color: LefiColors.brandDark),
                              const SizedBox(height: 6),
                              Text(
                                'Capture inspection photo',
                                style: LefiText.body(15, weight: 800, color: LefiColors.brandDark),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                'Close-up of the affected leaves',
                                style: LefiText.body(12, color: LefiColors.muted),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  )
                else
                  GridView.count(
                    crossAxisCount: 3,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    padding: EdgeInsets.zero,
                    mainAxisSpacing: 8,
                    crossAxisSpacing: 8,
                    children: [
                      for (final ph in d.photos)
                        StripedPlaceholder(
                          child: Align(
                            alignment: Alignment.bottomLeft,
                            child: Padding(
                              padding: const EdgeInsets.all(6),
                              child: Text(ph, style: LefiText.mono(9.5, color: LefiColors.photoLabel)),
                            ),
                          ),
                        ),
                      AddPhotoTile(label: 'Another', onTap: capture),
                    ],
                  ),
              ],
            ),
          ),
          LefiCard(
            child: Gap(
              children: [
                Text('Visible symptoms', style: LefiText.outfit(16)),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final s in inspectionSymptoms)
                      PillButton(
                        label: s,
                        selected: d.symptoms.contains(s),
                        height: 40,
                        fontSize: 13.5,
                        horizontalPadding: 13,
                        onTap: () => form.toggleSymptom(s),
                      ),
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    'Suspicious leaf colour',
                    style: LefiText.body(13, weight: 700, color: LefiColors.strong),
                  ),
                ),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final (label, color) in inspectionColours)
                      PillButton(
                        label: label,
                        selected: d.colours.contains(label),
                        height: 40,
                        horizontalPadding: 10,
                        borderWidth: 1.5,
                        selectedBackground: LefiColors.brandTint,
                        selectedForeground: LefiColors.body,
                        selectedBorder: LefiColors.brand,
                        leading: Container(
                          width: 22,
                          height: 22,
                          decoration: BoxDecoration(
                            color: Color(color),
                            shape: BoxShape.circle,
                            border: Border.all(color: const Color(0x1A000000)),
                          ),
                        ),
                        onTap: () => form.toggleColour(label),
                      ),
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text('Severity', style: LefiText.body(13, weight: 700, color: LefiColors.strong)),
                ),
                SegmentedTabs<String>(
                  items: inspectionSeverities,
                  selected: d.severity,
                  labelOf: (s) => s,
                  onSelected: form.setSeverity,
                ),
              ],
            ),
          ),
          LefiCard(
            child: Gap(
              gap: 8,
              children: [
                Text('Comments', style: LefiText.outfit(16)),
                LefiTextField(
                  initialValue: d.comment,
                  minLines: 4,
                  fontSize: 15,
                  hint: 'What did you see? Where on the plant, how many neighbours affected…',
                  onChanged: form.setComment,
                ),
              ],
            ),
          ),
          LefiCard(
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Request additional assessment', style: LefiText.body(15, weight: 700)),
                          const SizedBox(height: 2),
                          Text(
                            'Ask for a second opinion before treatment',
                            style: LefiText.body(12.5, color: LefiColors.subtle),
                          ),
                        ],
                      ),
                    ),
                    LefiToggle(value: d.requestAssessment, onChanged: form.toggleAssessment),
                  ],
                ),
                if (d.requestAssessment) ...[
                  const SizedBox(height: 10),
                  for (final a in AssessmentType.values)
                    Opacity(
                      opacity: a.available ? 1 : .5,
                      child: InkWell(
                        onTap: () => a.available
                            ? form.setAssessment(a)
                            : toast.show('Robot re-scans from mobile arrive in Phase 4.'),
                        child: Container(
                          constraints: const BoxConstraints(minHeight: 52),
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          decoration: const BoxDecoration(
                            border: Border(top: BorderSide(color: LefiColors.divider)),
                          ),
                          child: Row(
                            children: [
                              RadioDot(selected: d.assessment == a),
                              const SizedBox(width: 12),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(a.label, style: LefiText.body(14, weight: 700)),
                                  Text(a.sub, style: LefiText.body(12, color: LefiColors.subtle)),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                ],
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            decoration: BoxDecoration(color: LefiColors.brandTint, borderRadius: BorderRadius.circular(14)),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Symbols.person_check_rounded, size: 19, color: LefiColors.brandDark),
                const SizedBox(width: 10),
                Expanded(
                  child: Text.rich(
                    TextSpan(
                      children: [
                        const TextSpan(text: 'Saved as a '),
                        TextSpan(
                          text: 'human observation',
                          style: LefiText.body(12.5, weight: 800, color: LefiColors.brandDark),
                        ),
                        TextSpan(
                          text:
                              ' by ${user.name}. It stays separate from AI findings and is never shown as an AI prediction.',
                        ),
                      ],
                    ),
                    style: LefiText.body(12.5, color: LefiColors.brandDark, height: 1.45),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AiSummary extends ConsumerWidget {
  const _AiSummary({required this.plantId});
  final String plantId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final plant = ref.watch(plantsProvider).value?.firstWhere((p) => p.id == plantId);
    final obs = ref.watch(plantObservationsProvider(plantId)).value ?? const [];
    final ai = obs.where((o) => o.isAi).firstOrNull;
    final text = plant?.flag == null || ai == null
        ? 'No AI flags'
        : '${ai.text.split(RegExp('[.—]')).first.trim()} · ${ai.confidence}';
    return Text('AI: $text', style: LefiText.body(12, weight: 700, color: LefiColors.simulation));
  }
}
