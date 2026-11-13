import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/router/routes.dart';
import '../../../core/feedback/feedback.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/dashed_border.dart';
import '../../../core/widgets/inputs.dart';
import '../../../core/widgets/media.dart';
import '../../../core/widgets/overlays.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/widgets/selectors.dart';
import '../../auth/application/session.dart';
import '../../camera/presentation/camera_screen.dart';
import '../../greenhouse/application/greenhouse_providers.dart';

const _issues = [
  ('Leak or irrigation', Symbols.water_drop_rounded),
  ('Damaged plants', Symbols.potted_plant_rounded),
  ('Pests seen', Symbols.pest_control_rounded),
  ('Equipment fault', Symbols.build_rounded),
  ('Safety hazard', Symbols.warning_rounded),
  ('Other', Symbols.more_horiz_rounded),
];

class ReportDraft {
  String? category;
  String? zone;
  String note = '';
  String? photo;
}

/// "Report an issue" bottom sheet. Re-opens itself after the camera returns,
/// keeping the draft (as in the design).
Future<void> showReportSheet(BuildContext context, [ReportDraft? draft]) async {
  final d = draft ?? ReportDraft();
  final wantsPhoto = await showLefiSheet<bool>(context, builder: (_) => _ReportSheet(d));
  if (wantsPhoto == true && context.mounted) {
    final id = await GoRouter.of(context).push<String>(Routes.camera, extra: CameraPurpose.report);
    if (id != null) d.photo = id;
    if (context.mounted) await showReportSheet(context, d);
  }
}

class _ReportSheet extends ConsumerStatefulWidget {
  const _ReportSheet(this.d);
  final ReportDraft d;

  @override
  ConsumerState<_ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends ConsumerState<_ReportSheet> {
  ReportDraft get d => widget.d;

  Future<void> _submit() async {
    final toast = ref.read(toastProvider.notifier);
    if (d.category == null) return toast.show('Choose what kind of issue it is.', bad: true);
    if (d.note.trim().length < 5 && d.photo == null) return toast.show('Add a short note or a photo.', bad: true);
    final sup = ref.read(currentUserProvider).reportsTo;
    Navigator.pop(context);
    await ref
        .read(busyProvider.notifier)
        .run('Sending report…', () => Future<void>.delayed(const Duration(milliseconds: 800)));
    toast.show('INC-0188 reported · ${sup.isEmpty || sup == '—' ? 'Your supervisor' : sup} notified.');
  }

  @override
  Widget build(BuildContext context) {
    final zones = ref.watch(accessPolicyProvider).value?.visibleZones() ?? const [];
    d.zone ??= zones.firstOrNull?.id;
    return Gap(
      gap: 14,
      children: [
        Text('Report an issue', style: LefiText.outfit(21)),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          padding: EdgeInsets.zero,
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          childAspectRatio: 173 / 56,
          children: [
            for (final (label, icon) in _issues)
              Material(
                color: d.category == label ? LefiColors.brandDark : Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                  side: BorderSide(color: d.category == label ? LefiColors.brandDark : LefiColors.chipBorder),
                ),
                child: InkWell(
                  borderRadius: BorderRadius.circular(14),
                  onTap: () => setState(() => d.category = label),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    child: Row(
                      children: [
                        Icon(icon, size: 21, color: d.category == label ? Colors.white : LefiColors.strong),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            label,
                            style: LefiText.body(
                              13.5,
                              weight: 700,
                              color: d.category == label ? Colors.white : LefiColors.strong,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
        Text('Where?', style: LefiText.body(13, weight: 700, color: LefiColors.strong)),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final z in zones)
              PillButton(
                label: z.id,
                mono: true,
                selected: d.zone == z.id,
                height: 40,
                radius: 10,
                horizontalPadding: 12,
                borderWidth: 1.5,
                selectedBackground: LefiColors.brandTint,
                selectedForeground: LefiColors.brandDark,
                selectedBorder: LefiColors.brand,
                onTap: () => setState(() => d.zone = z.id),
              ),
          ],
        ),
        LefiTextField(
          initialValue: d.note,
          minLines: 3,
          fontSize: 15,
          hint: 'What did you see?',
          onChanged: (v) => d.note = v,
        ),
        if (d.photo == null)
          SizedBox(
            height: 50,
            child: DashedBorder(
              color: const Color(0xFF9FC7AF),
              radius: 14,
              child: Material(
                color: const Color(0xFFF4FAF6),
                child: InkWell(
                  borderRadius: BorderRadius.circular(14),
                  onTap: () => Navigator.pop(context, true),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Symbols.add_a_photo_rounded, size: 22, color: LefiColors.brandDark),
                      const SizedBox(width: 8),
                      Text('Add a photo', style: LefiText.body(14.5, weight: 700, color: LefiColors.brandDark)),
                    ],
                  ),
                ),
              ),
            ),
          )
        else
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: LefiColors.surfaceMuted, borderRadius: BorderRadius.circular(12)),
            child: Row(
              children: [
                const StripedPlaceholder(width: 48, height: 48, stripe: 6, radius: 10),
                const SizedBox(width: 10),
                Expanded(child: Text(d.photo!, style: LefiText.mono(13))),
                const Icon(Symbols.check_circle_rounded, size: 20, color: LefiColors.success),
              ],
            ),
          ),
        LefiButton(label: 'Send report', onPressed: _submit),
      ],
    );
  }
}
