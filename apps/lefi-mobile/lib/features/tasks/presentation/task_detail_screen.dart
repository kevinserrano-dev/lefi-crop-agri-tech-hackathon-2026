import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/router/routes.dart';
import '../../../core/feedback/feedback.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/dashed_border.dart';
import '../../../core/widgets/inputs.dart';
import '../../../core/widgets/media.dart';
import '../../../core/widgets/overlays.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/widgets/selectors.dart';
import '../../../shared/domain/role.dart';
import '../../alerts/application/notifications_controller.dart';
import '../../alerts/presentation/notification_sheet.dart';
import '../../auth/application/session.dart';
import '../../camera/presentation/camera_screen.dart';
import '../../greenhouse/application/greenhouse_providers.dart';
import '../application/brain_tasks.dart';
import '../application/tasks_controller.dart';
import '../domain/task.dart';
import 'brain_task_screen.dart';
import 'task_style.dart';

class TaskDetailScreen extends ConsumerWidget {
  const TaskDetailScreen({super.key, required this.taskId});
  final String taskId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(brainTaskRepositoryProvider) != null) return BrainTaskScreen(taskId: taskId);
    final tasks = ref.watch(tasksControllerProvider);
    final user = ref.watch(currentUserProvider);
    final zones = ref.watch(zonesProvider).value ?? const [];
    final ghs = ref.watch(greenhousesProvider).value ?? const [];
    final ctl = ref.read(tasksControllerProvider.notifier);
    final toast = ref.read(toastProvider.notifier);

    final t = tasks.value?.where((x) => x.id == taskId).firstOrNull;
    final canAct = t != null && (t.assignee == user.name || user.role.can(Permission.team));
    final started = t?.status == TaskStatus.inProgress;

    Future<void> addPhoto() async {
      if (!canAct) return toast.show('Only the assignee can add evidence.', bad: true);
      if (t.status == TaskStatus.completed) return toast.show('Task already completed.', bad: true);
      final id = await GoRouter.of(context).push<String>(Routes.camera, extra: CameraPurpose.task);
      if (id != null) {
        ctl.addPhoto(t.id, id);
        toast.show('Photo $id attached.');
      }
    }

    Future<void> complete() async {
      if (t!.photoRequired && t.photos.isEmpty) return toast.show('Add a photo of the finished work first.', bad: true);
      final miss = t.steps.length - t.doneSteps.length;
      final ok = await showLefiConfirm(
        context,
        title: 'Complete ${t.id}?',
        body:
            '${miss > 0 ? '$miss step(s) are not checked off. ' : 'All steps checked. '}${t.photos.length} photo(s) attached. Your supervisor will verify the work.',
        confirmLabel: 'Complete task',
      );
      if (!ok) return;
      await ref.read(busyProvider.notifier).run('Completing…', () => ctl.complete(t.id));
      toast.show('${t.id} completed and sent for verification.');
    }

    Widget? bottom;
    if (t != null) {
      bottom = StickyActionBar(
        children: [
          if (canAct && t.status == TaskStatus.open)
            LefiButton(
              label: 'Start task',
              icon: Symbols.play_arrow_rounded,
              onPressed: () async {
                await ref.read(busyProvider.notifier).run('Updating…', () => ctl.start(t.id));
                toast.show('${t.id} is now in progress.');
              },
            ),
          if (canAct && started)
            LefiButton(label: 'Mark as completed', icon: Symbols.task_alt_rounded, onPressed: complete),
          if (t.status == TaskStatus.completed)
            const DoneBanner(label: 'Completed · awaiting supervisor verification', icon: Symbols.verified_rounded),
          if (!canAct)
            Container(
              height: 48,
              decoration: BoxDecoration(color: LefiColors.surfaceNeutral, borderRadius: BorderRadius.circular(14)),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Symbols.visibility_rounded, size: 19, color: LefiColors.muted),
                  const SizedBox(width: 6),
                  Text('View only', style: LefiText.body(14, weight: 700, color: LefiColors.muted)),
                ],
              ),
            ),
        ],
      );
    }

    return PushedScreen(
      title: 'Task',
      backLabel: 'Tasks',
      bottom: bottom,
      body: AsyncView(
        tasks,
        data: (_) {
          if (t == null) return const SizedBox.shrink();
          final z = zones.where((z) => z.id == t.zoneId).firstOrNull;
          final ghName = ghs.where((g) => g.id == z?.greenhouseId).firstOrNull?.name ?? '';
          final (sbg, sfg) = statusColors(t.status);
          Widget cell(String k, Widget v) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(k, style: LefiText.body(12, color: LefiColors.subtle)),
              const SizedBox(height: 2),
              v,
            ],
          );
          final b = LefiText.body(13, weight: 700);
          return ScrollBody(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
            children: [
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  ToneChip(
                    priorityLabel(t.priority),
                    tone: priorityTone(t.priority),
                    fontSize: 11.5,
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  ),
                  ToneChip(
                    statusLabel(t.status),
                    fontSize: 11.5,
                    background: sbg,
                    foreground: sfg,
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  ),
                  ToneChip(
                    t.origin == TaskOrigin.ai ? 'AI-generated' : 'Assigned by a person',
                    fontSize: 11.5,
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  ),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(t.title, style: LefiText.outfit(23, height: 1.2)),
                  const SizedBox(height: 4),
                  Text(t.id, style: LefiText.mono(12, color: LefiColors.subtle)),
                ],
              ),
              LefiCard(
                child: Column(
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: cell(
                            'Location',
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('${t.zoneId} · ${z?.label ?? ''}', style: b),
                                Text(ghName, style: LefiText.body(12, color: LefiColors.subtle)),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(child: cell('Due', Text(t.due, style: b))),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: cell('Assigned to', Text(t.assignee, style: b))),
                        const SizedBox(width: 12),
                        Expanded(
                          child: cell('Source', Text(t.source, style: LefiText.body(13, weight: 600, height: 1.35))),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              if (t.incident != null)
                Material(
                  color: LefiColors.dangerWash,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                    side: const BorderSide(color: LefiColors.dangerBorder),
                  ),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(14),
                    onTap: () {
                      final n = ref
                          .read(notificationsControllerProvider)
                          .value
                          ?.items
                          .where((x) => x.incident == t.incident)
                          .firstOrNull;
                      n != null
                          ? showNotificationSheet(context, n.id)
                          : toast.show('${t.incident} details are on the web Alert Center for your role.');
                    },
                    child: Container(
                      constraints: const BoxConstraints(minHeight: 52),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      child: Row(
                        children: [
                          const Icon(Symbols.crisis_alert_rounded, size: 22, color: LefiColors.dangerDeep),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Related incident ${t.incident}',
                              style: LefiText.body(13.5, weight: 700, color: LefiColors.dangerDeep),
                            ),
                          ),
                          const Chevron(color: LefiColors.dangerDeep),
                        ],
                      ),
                    ),
                  ),
                ),
              if (!canAct) InfoNote(text: 'View only — assigned to ${t.assignee}'),
              LefiCard(
                padding: const EdgeInsets.fromLTRB(14, 6, 14, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Row(
                        children: [
                          Expanded(child: Text('Instructions', style: LefiText.outfit(16))),
                          Text(
                            '${t.doneSteps.length}/${t.steps.length} done',
                            style: LefiText.body(12.5, weight: 700, color: LefiColors.subtle),
                          ),
                        ],
                      ),
                    ),
                    for (final (i, st) in t.steps.indexed)
                      InkWell(
                        onTap: () {
                          if (!canAct) {
                            return toast.show('View only — this task is assigned to ${t.assignee}.', bad: true);
                          }
                          if (!started) return toast.show('Start the task before checking off steps.', bad: true);
                          ctl.toggleStep(t.id, i);
                        },
                        child: Container(
                          constraints: const BoxConstraints(minHeight: 52),
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          decoration: const BoxDecoration(
                            border: Border(top: BorderSide(color: LefiColors.divider)),
                          ),
                          child: Row(
                            children: [
                              CheckSquare(checked: t.doneSteps.contains(i)),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Text(
                                  st,
                                  style: LefiText.body(
                                    14,
                                    color: t.doneSteps.contains(i) ? LefiColors.faint : LefiColors.body,
                                    height: 1.4,
                                  ).copyWith(decoration: t.doneSteps.contains(i) ? TextDecoration.lineThrough : null),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    if (t.status == TaskStatus.open)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          'Start the task to check off steps.',
                          style: LefiText.body(12, color: LefiColors.faint),
                        ),
                      ),
                  ],
                ),
              ),
              LefiCard(
                child: Gap(
                  children: [
                    Row(
                      children: [
                        Expanded(child: Text('Photo evidence', style: LefiText.outfit(16))),
                        if (t.photoRequired) const ToneChip('Required', tone: Tone.warn),
                      ],
                    ),
                    GridView.count(
                      crossAxisCount: 3,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      padding: EdgeInsets.zero,
                      mainAxisSpacing: 8,
                      crossAxisSpacing: 8,
                      children: [
                        for (final p in t.photos)
                          StripedPlaceholder(
                            child: Align(
                              alignment: Alignment.bottomLeft,
                              child: Padding(
                                padding: const EdgeInsets.all(6),
                                child: Text(p, style: LefiText.mono(9.5, color: LefiColors.photoLabel)),
                              ),
                            ),
                          ),
                        AddPhotoTile(label: 'Add photo', onTap: addPhoto),
                      ],
                    ),
                  ],
                ),
              ),
              LefiCard(
                child: Gap(
                  children: [
                    Row(
                      children: [
                        Expanded(child: Text('Observations', style: LefiText.outfit(16))),
                        LefiTextButton(
                          '+ Add',
                          height: 36,
                          onPressed: () {
                            if (!canAct) return toast.show('Only the assignee can add observations.', bad: true);
                            showObservationSheet(context, ref, t.id);
                          },
                        ),
                      ],
                    ),
                    if (t.notes.isEmpty)
                      Text('No observations yet.', style: LefiText.body(13, color: LefiColors.faint)),
                    for (final o in t.notes)
                      Container(
                        padding: const EdgeInsets.only(top: 8),
                        decoration: const BoxDecoration(
                          border: Border(top: BorderSide(color: LefiColors.divider)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text.rich(
                              TextSpan(
                                children: [
                                  TextSpan(
                                    text: o.author,
                                    style: LefiText.body(12, weight: 700, color: LefiColors.body),
                                  ),
                                  TextSpan(text: ' · ${o.time}'),
                                ],
                              ),
                              style: LefiText.body(12, color: LefiColors.subtle),
                            ),
                            const SizedBox(height: 3),
                            Text(o.text, style: LefiText.body(14, height: 1.45)),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// Dashed 'add photo' tile used in photo grids.
class AddPhotoTile extends StatelessWidget {
  const AddPhotoTile({super.key, required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => DashedBorder(
    color: LefiColors.photoBorderDashed,
    child: Material(
      color: LefiColors.surfaceTint,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Symbols.add_a_photo_rounded, size: 26, color: LefiColors.leaf),
            const SizedBox(height: 4),
            Text(label, style: LefiText.body(12, weight: 700, color: LefiColors.leaf)),
          ],
        ),
      ),
    ),
  );
}

Future<void> showObservationSheet(BuildContext context, WidgetRef ref, String taskId) {
  var draft = '';
  return showLefiSheet<void>(
    context,
    builder: (ctx) => Gap(
      gap: 14,
      children: [
        Text('Add observation', style: LefiText.outfit(21)),
        LefiTextField(
          minLines: 4,
          fontSize: 15,
          hint: 'e.g. Emitters on B-3 dripping again after valve swap',
          onChanged: (v) => draft = v,
        ),
        LefiButton(
          label: 'Save observation',
          onPressed: () {
            final txt = draft.trim();
            if (txt.length < 3) return ref.read(toastProvider.notifier).show('Write an observation first.', bad: true);
            ref.read(tasksControllerProvider.notifier).addNote(taskId, txt);
            Navigator.pop(ctx);
            ref.read(toastProvider.notifier).show('Observation added.');
          },
        ),
      ],
    ),
  );
}
