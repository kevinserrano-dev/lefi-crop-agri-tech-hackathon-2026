import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/inputs.dart';
import '../../../core/widgets/overlays.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/widgets/selectors.dart';
import '../../tasks/presentation/brain_task_sheets.dart';
import '../application/brain_alerts.dart';

/// "Report an issue" on Lefi Brain (`incident.report`, every role): it becomes an alert
/// "reported by a person" that the people who handle alerts see (ADR-071).
Future<void> showBrainReportSheet(BuildContext context, {String? zoneId, String? plantId, String? about}) =>
    showLefiSheet<void>(
      context,
      builder: (_) => _ReportForm(zoneId: zoneId, plantId: plantId, about: about),
    );

class _ReportForm extends ConsumerStatefulWidget {
  const _ReportForm({this.zoneId, this.plantId, this.about});
  final String? zoneId;
  final String? plantId;
  final String? about;

  @override
  ConsumerState<_ReportForm> createState() => _ReportFormState();
}

class _ReportFormState extends ConsumerState<_ReportForm> {
  final _title = TextEditingController();
  final _detail = TextEditingController();
  String _severity = 'warning';

  @override
  void dispose() {
    _title.dispose();
    _detail.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Gap(
    gap: 14,
    children: [
      Text('Report an issue', style: LefiText.outfit(21)),
      if (widget.about != null) Text(widget.about!, style: LefiText.body(13.5, color: LefiColors.subtle)),
      FieldLabel(
        'What is wrong',
        child: LefiTextField(
          controller: _title,
          hint: 'e.g. Water leaking under bench 3',
          textCapitalization: TextCapitalization.sentences,
        ),
      ),
      FieldLabel(
        'Details (optional)',
        child: LefiTextField(
          controller: _detail,
          minLines: 3,
          fontSize: 15,
          textCapitalization: TextCapitalization.sentences,
        ),
      ),
      FieldLabel(
        'How serious',
        child: SegmentedTabs<String>(
          items: const ['info', 'warning', 'critical'],
          selected: _severity,
          labelOf: (s) => switch (s) {
            'critical' => 'Critical',
            'warning' => 'Warning',
            _ => 'Info',
          },
          onSelected: (s) => setState(() => _severity = s),
        ),
      ),
      LefiButton(
        label: 'Send to Lefi Brain',
        onPressed: () async {
          if (_title.text.trim().isEmpty) return;
          final auth = ref.read(brainReporterProvider);
          if (auth == null) return;
          final ok = await runBrain(
            ref,
            'Sending…',
            () => auth.api(
              'POST',
              '/alerts',
              body: {
                'title': _title.text.trim(),
                if (_detail.text.trim().isNotEmpty) 'detail': _detail.text.trim(),
                'severity': _severity,
                'zone_id': ?widget.zoneId,
                'plant_id': ?widget.plantId,
              },
            ),
            done: 'Reported. The people who handle alerts are told.',
          );
          if (!ok || !context.mounted) return;
          ref.invalidate(brainAlertsProvider);
          Navigator.pop(context);
        },
      ),
    ],
  );
}
