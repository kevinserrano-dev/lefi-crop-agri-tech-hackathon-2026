import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/router/routes.dart';
import '../../../core/feedback/feedback.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/inputs.dart';
import '../../../core/widgets/overlays.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/widgets/selectors.dart';
import '../../auth/domain/auth_repository.dart';
import '../../greenhouse/application/brain_greenhouse.dart';
import '../../greenhouse/domain/brain_greenhouse.dart';
import '../application/brain_tasks.dart';
import '../domain/brain_task.dart';
import 'brain_task_style.dart';

/// The words Lefi Brain gave when it refused (its own message), else a generic one.
String brainError(Object e) => e is AuthException ? e.message : 'Lefi Brain could not do it: $e';

/// After a change: the lists and this task ask Lefi Brain again.
void refreshBrainTasks(WidgetRef ref, [String? taskId]) {
  ref.invalidate(brainTasksProvider);
  ref.invalidate(brainZoneTasksProvider);
  if (taskId != null) {
    ref.invalidate(brainTaskProvider(taskId));
    ref.invalidate(brainTaskPhotosProvider(taskId));
  }
}

/// Runs a Lefi Brain change behind the busy overlay; toasts the outcome. True when it worked.
Future<bool> runBrain(WidgetRef ref, String busy, Future<void> Function() action, {required String done}) async {
  final toast = ref.read(toastProvider.notifier);
  try {
    await ref.read(busyProvider.notifier).run(busy, action);
    toast.show(done);
    return true;
  } on Object catch (e) {
    toast.show(brainError(e), bad: true);
    return false;
  }
}

/// A text note (completion notes, verifier's note, why it goes back, why it is cancelled).
/// Null = cancelled by the person; "" = no note.
Future<String?> showNoteSheet(
  BuildContext context, {
  required String title,
  required String body,
  required String confirmLabel,
  String hint = '',
  bool required = false,
  Color confirmColor = LefiColors.brandDark,
}) {
  final ctl = TextEditingController();
  return showLefiSheet<String>(
    context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, set) => Gap(
        gap: 14,
        children: [
          Text(title, style: LefiText.outfit(21)),
          Text(body, style: LefiText.body(14, color: LefiColors.secondary, height: 1.45)),
          LefiTextField(
            controller: ctl,
            minLines: 4,
            fontSize: 15,
            hint: hint,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) => set(() {}),
          ),
          LefiButton(
            label: confirmLabel,
            background: confirmColor,
            opacity: required && ctl.text.trim().isEmpty ? .5 : 1,
            onPressed: () {
              if (required && ctl.text.trim().isEmpty) return;
              Navigator.pop(ctx, ctl.text.trim());
            },
          ),
        ],
      ),
    ),
  );
}

/// Who does the task: a person, or nobody (back to the role's queue). Returns the choice, or
/// null when cancelled. The value of a choice is the person's id, or "" for nobody.
Future<String?> showAssignSheet(BuildContext context, {required List<TaskPerson> people, String? current}) =>
    showLefiSheet<String>(
      context,
      builder: (ctx) => Gap(
        gap: 6,
        children: [
          Text('Assign to', style: LefiText.outfit(21)),
          const SizedBox(height: 4),
          for (final p in [const TaskPerson('', 'Nobody · back to the queue', ''), ...people])
            InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: () => Navigator.pop(ctx, p.id),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
                child: Row(
                  children: [
                    RadioDot(selected: (current ?? '') == p.id),
                    const SizedBox(width: 12),
                    Expanded(child: Text(p.name, style: LefiText.body(15, weight: 700))),
                    if (p.role.isNotEmpty)
                      Text(roleLabel(p.role), style: LefiText.body(12.5, color: LefiColors.subtle)),
                  ],
                ),
              ),
            ),
        ],
      ),
    );

Future<String?> showPrioritySheet(BuildContext context, String current) => showLefiSheet<String>(
  context,
  builder: (ctx) => Gap(
    gap: 6,
    children: [
      Text('Priority', style: LefiText.outfit(21)),
      const SizedBox(height: 4),
      for (final p in taskPriorities)
        InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () => Navigator.pop(ctx, p),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
            child: Row(
              children: [
                RadioDot(selected: current == p),
                const SizedBox(width: 12),
                ToneChip(brainPriorityLabel(p), tone: brainPriorityTone(p), fontSize: 13),
              ],
            ),
          ),
        ),
    ],
  ),
);

/// Due date and time picked by the person (Lefi Brain never invents one). Null = cancelled.
Future<DateTime?> pickDue(BuildContext context, DateTime? current) async {
  final now = DateTime.now();
  final start = current ?? now.add(const Duration(hours: 2));
  final day = await showDatePicker(
    context: context,
    initialDate: start.isBefore(now) ? now : start,
    firstDate: DateTime(now.year, now.month, now.day),
    lastDate: now.add(const Duration(days: 365)),
  );
  if (day == null || !context.mounted) return null;
  final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(start));
  if (time == null) return null;
  return DateTime(day.year, day.month, day.day, time.hour, time.minute);
}

/// A new task, made by a person with `task.assign` (supervisors, managers, administrators).
/// Opens the new task once Lefi Brain made it.
Future<void> showNewTaskSheet(
  BuildContext context,
  WidgetRef ref, {
  required List<TaskPerson> people,
  String? zoneId,
}) async {
  final id = await showLefiSheet<String>(
    context,
    builder: (ctx) => _NewTaskForm(people: people, zoneId: zoneId),
  );
  if (id != null && context.mounted) await context.pushDetail<void>('task/$id');
}

class _NewTaskForm extends ConsumerStatefulWidget {
  const _NewTaskForm({required this.people, this.zoneId});
  final List<TaskPerson> people;
  final String? zoneId;

  @override
  ConsumerState<_NewTaskForm> createState() => _NewTaskFormState();
}

class _NewTaskFormState extends ConsumerState<_NewTaskForm> {
  final _title = TextEditingController();
  final _detail = TextEditingController();
  String _kind = 'other';
  String _priority = 'normal';
  late String? _zone = widget.zoneId;
  String? _person;
  DateTime? _due;

  @override
  void dispose() {
    _title.dispose();
    _detail.dispose();
    super.dispose();
  }

  Future<T?> _pick<T>(String title, List<(T, String)> options, T? current) => showLefiSheet<T>(
    context,
    builder: (ctx) => Gap(
      gap: 4,
      children: [
        Text(title, style: LefiText.outfit(21)),
        const SizedBox(height: 4),
        for (final (v, label) in options)
          InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () => Navigator.pop(ctx, v),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
              child: Row(
                children: [
                  RadioDot(selected: v == current),
                  const SizedBox(width: 12),
                  Expanded(child: Text(label, style: LefiText.body(15, weight: 700))),
                ],
              ),
            ),
          ),
      ],
    ),
  );

  Widget _choice(String label, String value, VoidCallback onTap) => FieldLabel(
    label,
    child: Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: LefiColors.inputBorder),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          height: 50,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          alignment: Alignment.centerLeft,
          child: Text(value, style: LefiText.body(15, weight: 600)),
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final zones = ref.watch(brainZonesProvider).value ?? const <BrainZone>[];
    final zone = zones.where((z) => z.id == _zone).firstOrNull;
    final person = widget.people.where((p) => p.id == _person).firstOrNull;
    return Gap(
      gap: 14,
      children: [
        Text('New task', style: LefiText.outfit(21)),
        FieldLabel(
          'What needs doing',
          child: LefiTextField(
            controller: _title,
            hint: 'e.g. Check the drip line in Zone A',
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
        _choice('Kind', taskKindLabel(_kind), () async {
          final v = await _pick('Kind', [for (final k in taskKinds) (k, taskKindLabel(k))], _kind);
          if (v != null) setState(() => _kind = v);
        }),
        _choice('Priority', brainPriorityLabel(_priority), () async {
          final v = await showPrioritySheet(context, _priority);
          if (v != null) setState(() => _priority = v);
        }),
        _choice('Zone', zone?.title ?? 'No zone', () async {
          final v = await _pick('Zone', [('', 'No zone'), for (final z in zones) (z.id, z.title)], _zone ?? '');
          if (v != null) setState(() => _zone = v.isEmpty ? null : v);
        }),
        _choice('Assign to', person?.name ?? 'Nobody yet', () async {
          final v = await showAssignSheet(context, people: widget.people, current: _person);
          if (v != null) setState(() => _person = v.isEmpty ? null : v);
        }),
        _choice(
          'Due',
          _due == null ? 'No due time' : '${_due!.day}/${_due!.month} ${TimeOfDay.fromDateTime(_due!).format(context)}',
          () async {
            final v = await pickDue(context, _due);
            if (v != null) setState(() => _due = v);
          },
        ),
        LefiButton(
          label: 'Create task',
          onPressed: () async {
            if (_title.text.trim().isEmpty) {
              return ref.read(toastProvider.notifier).show('Say what needs doing.', bad: true);
            }
            final repo = ref.read(brainTaskRepositoryProvider)!;
            BrainTask? made;
            final ok = await runBrain(
              ref,
              'Creating…',
              () async => made = await repo.create(
                NewTask(
                  title: _title.text,
                  detail: _detail.text,
                  kind: _kind,
                  priority: _priority,
                  zoneId: _zone,
                  assignedTo: _person,
                  dueAt: _due,
                ),
              ),
              done: 'Task created.',
            );
            if (!ok || !context.mounted) return;
            refreshBrainTasks(ref);
            Navigator.pop(context, made?.id);
          },
        ),
      ],
    );
  }
}
