import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/router/routes.dart';
import '../../../core/feedback/feedback.dart';
import '../../../core/platform/photo_capture.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/overlays.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../alerts/presentation/brain_alerts_view.dart';
import '../../auth/application/session.dart';
import '../../brain/data/brain_json.dart';
import '../application/brain_tasks.dart';
import '../domain/brain_task.dart';
import 'brain_task_sheets.dart';
import 'brain_task_style.dart';
import 'task_detail_screen.dart' show AddPhotoTile;

/// One Lefi Brain task (ADR-093): do it, show the evidence, and — for who verifies — check it.
class BrainTaskScreen extends ConsumerWidget {
  const BrainTaskScreen({super.key, required this.taskId});
  final String taskId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(brainTaskProvider(taskId));
    final repo = ref.watch(brainTaskRepositoryProvider)!;
    final user = ref.watch(currentUserProvider);
    final t = async.value;

    final mayWork =
        t != null && !t.robot && (repo.can('task.all') || t.assignedTo == null || t.assignedTo == repo.userId);
    final canVerify = repo.can('task.verify');
    final ownWork = t?.completedBy != null && t?.completedBy == user.name && repo.roleId != 'admin';

    Future<void> act(String busy, Future<BrainTask> Function() call, String done) async {
      final ok = await runBrain(ref, busy, call, done: done);
      if (ok) refreshBrainTasks(ref, taskId);
    }

    Future<void> complete() async {
      final note = await showNoteSheet(
        context,
        title: 'Mark ${t!.label} as done',
        body: 'Say what you did and what you found. Someone with verification rights will check the work.',
        hint: 'e.g. Replaced the clogged emitter on row A; flow is back to normal.',
        confirmLabel: 'Mark as done',
      );
      if (note == null) return;
      await act('Sending…', () => repo.complete(t.id, note), '${t.label} sent for verification.');
    }

    Future<void> verify() async {
      final note = await showNoteSheet(
        context,
        title: 'Verify ${t!.label}',
        body: 'The work is checked and the task closes.',
        hint: 'Optional note',
        confirmLabel: 'Verify',
      );
      if (note == null) return;
      await act('Verifying…', () => repo.verify(t.id, note), '${t.label} verified.');
    }

    Future<void> sendBack() async {
      final note = await showNoteSheet(
        context,
        title: 'Return ${t!.label}',
        body: 'It goes back to ${t.assignedToName ?? 'who did it'}, in progress, with what is missing.',
        hint: 'What is missing',
        confirmLabel: 'Return the task',
        required: true,
        confirmColor: LefiColors.amberDeep,
      );
      if (note == null) return;
      await act('Returning…', () => repo.sendBack(t.id, note), '${t.label} returned.');
    }

    Widget? bottom;
    if (t != null) {
      final buttons = <Widget>[
        if (t.status == 'open' && mayWork)
          LefiButton(
            label: 'Start task',
            icon: Symbols.play_arrow_rounded,
            onPressed: () => act('Starting…', () => repo.start(t.id), '${t.label} is now in progress.'),
          ),
        if (t.status == 'in_progress' && mayWork)
          LefiButton(label: 'Mark as done', icon: Symbols.task_alt_rounded, onPressed: complete),
        if (t.status == 'awaiting' && canVerify && !ownWork) ...[
          LefiButton(label: 'Verify', icon: Symbols.verified_rounded, onPressed: verify),
          LefiOutlineButton(label: 'Return with a note', icon: Symbols.undo_rounded, onPressed: sendBack),
        ],
        if (t.status == 'awaiting' && (!canVerify || ownWork))
          DoneBanner(
            label: ownWork ? 'Done · someone else verifies your work' : 'Done · awaiting verification',
            icon: Symbols.hourglass_top_rounded,
          ),
        if (t.status == 'verified' || t.status == 'done')
          const DoneBanner(label: 'Verified and closed', icon: Symbols.verified_rounded),
        if (t.status == 'cancelled') const DoneBanner(label: 'Cancelled', icon: Symbols.block_rounded),
      ];
      if (buttons.isEmpty && t.working && !mayWork) {
        buttons.add(
          InfoNote(
            text: t.robot
                ? 'Robot task · no person does it'
                : 'View only — assigned to ${t.assignedToName ?? 'someone else'}',
          ),
        );
      }
      if (buttons.isNotEmpty) bottom = StickyActionBar(children: buttons);
    }

    return PushedScreen(
      title: 'Task',
      backLabel: 'Back',
      bottom: bottom,
      body: AsyncView(
        async,
        data: (t) => RefreshIndicator(
          onRefresh: () async => refreshBrainTasks(ref, taskId),
          child: _TaskBody(task: t, mayWork: mayWork, canVerify: canVerify),
        ),
      ),
    );
  }
}

class _TaskBody extends ConsumerWidget {
  const _TaskBody({required this.task, required this.mayWork, required this.canVerify});
  final BrainTask task;
  final bool mayWork;
  final bool canVerify;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = task;
    final repo = ref.watch(brainTaskRepositoryProvider)!;
    final now = DateTime.now();
    final (src, srcTone, srcIcon) = taskSourceTag(t);
    final b = LefiText.body(13, weight: 700);
    Widget cell(String k, String v, {Color? color}) => Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(k, style: LefiText.body(12, color: LefiColors.subtle)),
          const SizedBox(height: 2),
          Text(v, style: color == null ? b : b.copyWith(color: color)),
        ],
      ),
    );
    final timeline = [
      ('Made', t.createdBy, t.createdAt),
      if (t.startedAt != null) ('Started', t.startedBy ?? '', t.startedAt),
      if (t.completedAt != null) ('Done', t.completedBy ?? '', t.completedAt),
      if (t.verifiedAt != null) ('Verified', t.verifiedBy ?? '', t.verifiedAt),
      if (t.status == 'cancelled' && t.closedAt != null) ('Cancelled', t.closedBy ?? '', t.closedAt),
    ];

    return ScrollBody(
      children: [
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            ToneChip(brainPriorityLabel(t.priority), tone: brainPriorityTone(t.priority), fontSize: 11.5),
            ToneChip(taskStatusLabel(t.status), tone: brainStatusTone(t.status), fontSize: 11.5),
            ToneChip(src, tone: srcTone, icon: srcIcon, fontSize: 11.5),
            if (t.simulated) const SimulationBadge(fontSize: 10.5),
          ],
        ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(t.title, style: LefiText.outfit(23, height: 1.2)),
            const SizedBox(height: 4),
            Text('${t.label} · ${taskKindLabel(t.kind)}', style: LefiText.mono(12, color: LefiColors.subtle)),
          ],
        ),
        if (t.reviewNote != null && t.status == 'in_progress')
          InfoNote(
            text: 'Returned: ${t.reviewNote}',
            icon: Symbols.undo_rounded,
            background: Tone.warn.bg,
            foreground: LefiColors.amberDeep,
            fontWeight: 600,
          ),
        LefiCard(
          child: Column(
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  cell('Zone', t.zone ?? 'No zone'),
                  const SizedBox(width: 12),
                  cell(
                    'Due',
                    t.dueAt == null
                        ? 'No due time'
                        : (t.overdue(now) ? 'Overdue · ${brainWhen(t.dueAt, now: now)}' : brainWhen(t.dueAt, now: now)),
                    color: t.overdue(now) ? LefiColors.dangerDeep : null,
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  cell(
                    'Assigned to',
                    t.robot
                        ? 'Robot'
                        : t.assignedToName ??
                              (t.forRole == null ? 'Nobody yet' : 'Nobody yet · ${roleLabel(t.forRole!)}'),
                  ),
                  const SizedBox(width: 12),
                  cell('Made by', '${t.createdBy} · ${brainWhen(t.createdAt, now: now)}'),
                ],
              ),
            ],
          ),
        ),
        if (t.alertId != null && repo.can('nav.alerts'))
          _LinkRow(
            icon: Symbols.crisis_alert_rounded,
            text: 'Alert ${t.alertNumber ?? ''} behind this task',
            onTap: () => showBrainAlertSheet(
              context,
              t.alertId!,
              canAcknowledge: repo.can('incident.ack'),
              canResolve: repo.can('incident.resolve'),
            ),
          ),
        if (t.plantId != null)
          _LinkRow(
            icon: Symbols.potted_plant_rounded,
            text: 'Open the plant',
            tone: Tone.ok,
            onTap: () => context.pushDetail<void>('plant/${t.plantId}'),
          ),
        if (t.zoneId != null)
          _LinkRow(
            icon: Symbols.grid_view_rounded,
            text: 'Open ${t.zone ?? 'the zone'}',
            tone: Tone.ok,
            onTap: () => context.pushDetail<void>('zone/${t.zoneId}'),
          ),
        if (t.robotNote != null) InfoNote(text: t.robotNote!, icon: Symbols.smart_toy_rounded),
        if (t.detail.isNotEmpty)
          LefiCard(
            child: Gap(
              gap: 6,
              children: [
                Text('What to do', style: LefiText.outfit(16)),
                Text(t.detail, style: LefiText.body(14, height: 1.5)),
              ],
            ),
          ),
        _Photos(task: t, canAdd: t.active && (mayWork || canVerify)),
        if (t.outcome != null || (t.reviewNote != null && t.status != 'in_progress'))
          LefiCard(
            child: Gap(
              gap: 6,
              children: [
                if (t.outcome != null) ...[
                  // Lefi Brain keeps a cancellation's reason in the same field (ADR-089).
                  Text(
                    t.status == 'cancelled' ? 'Why it was cancelled' : 'Completion notes',
                    style: LefiText.outfit(16),
                  ),
                  Text(t.outcome!, style: LefiText.body(14, height: 1.5)),
                ],
                if (t.reviewNote != null && t.status != 'in_progress') ...[
                  Text('Verifier’s note', style: LefiText.outfit(16)),
                  Text(t.reviewNote!, style: LefiText.body(14, height: 1.5)),
                ],
              ],
            ),
          ),
        LefiCard(
          child: Gap(
            gap: 8,
            children: [
              Text('History', style: LefiText.outfit(16)),
              for (final (what, who, at) in timeline)
                Row(
                  children: [
                    SizedBox(width: 74, child: Text(what, style: LefiText.body(13, weight: 700))),
                    Expanded(
                      child: Text(who, style: LefiText.body(13, color: LefiColors.secondary)),
                    ),
                    Text(
                      brainWhen(at, now: now),
                      style: LefiText.body(12, color: LefiColors.subtle),
                    ),
                  ],
                ),
            ],
          ),
        ),
        if (repo.can('task.assign') && t.active) _ManageCard(task: t),
      ],
    );
  }
}

class _LinkRow extends StatelessWidget {
  const _LinkRow({required this.icon, required this.text, required this.onTap, this.tone = Tone.crit});
  final IconData icon;
  final String text;
  final VoidCallback onTap;
  final Tone tone;

  @override
  Widget build(BuildContext context) => Material(
    color: tone.bg,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    child: InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 52),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            Icon(icon, size: 22, color: tone.fg),
            const SizedBox(width: 10),
            Expanded(
              child: Text(text, style: LefiText.body(13.5, weight: 700, color: tone.fg)),
            ),
            Chevron(color: tone.fg),
          ],
        ),
      ),
    ),
  );
}

/// Photo evidence kept by Lefi Brain (JPEG/PNG ≤ 5 MB, ADR-093).
class _Photos extends ConsumerWidget {
  const _Photos({required this.task, required this.canAdd});
  final BrainTask task;
  final bool canAdd;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final photos = ref.watch(brainTaskPhotosProvider(task.id));
    Future<void> add() async {
      final from = await showLefiSheet<bool>(
        context,
        builder: (ctx) => Gap(
          gap: 10,
          children: [
            Text('Add photo evidence', style: LefiText.outfit(21)),
            LefiButton(
              label: 'Take a photo',
              icon: Symbols.photo_camera_rounded,
              onPressed: () => Navigator.pop(ctx, false),
            ),
            LefiOutlineButton(
              label: 'Choose from the library',
              icon: Symbols.photo_library_rounded,
              onPressed: () => Navigator.pop(ctx, true),
            ),
          ],
        ),
      );
      if (from == null) return;
      final toast = ref.read(toastProvider.notifier);
      final bytes = await capturePhoto(fromLibrary: from).catchError((Object e) {
        toast.show('The camera could not be opened: $e', bad: true);
        return null;
      });
      if (bytes == null) return;
      final ok = await runBrain(
        ref,
        'Uploading photo…',
        () => ref.read(brainTaskRepositoryProvider)!.addPhoto(task.id, bytes),
        done: 'Photo added to ${task.label}.',
      );
      if (ok) ref.invalidate(brainTaskPhotosProvider(task.id));
    }

    return LefiCard(
      child: Gap(
        children: [
          Text('Photo evidence', style: LefiText.outfit(16)),
          AsyncView(
            photos,
            data: (list) => Gap(
              gap: 8,
              children: [
                if (list.isEmpty && !canAdd) Text('No photos.', style: LefiText.body(13, color: LefiColors.faint)),
                GridView.count(
                  crossAxisCount: 3,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  padding: EdgeInsets.zero,
                  mainAxisSpacing: 8,
                  crossAxisSpacing: 8,
                  children: [
                    for (final p in list) _Thumb(photo: p),
                    if (canAdd) AddPhotoTile(label: 'Add photo', onTap: add),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Thumb extends ConsumerWidget {
  const _Thumb({required this.photo});
  final TaskPhoto photo;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bytes = ref.watch(brainTaskPhotoBytesProvider(photo.id));
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Material(
        color: LefiColors.surfaceMuted,
        child: InkWell(
          onTap: bytes.value == null
              ? null
              : () => showDialog<void>(
                  context: context,
                  useRootNavigator: true,
                  builder: (ctx) => Dialog.fullscreen(
                    backgroundColor: Colors.black,
                    child: Stack(
                      children: [
                        Positioned.fill(
                          child: InteractiveViewer(child: Image.memory(bytes.value!, fit: BoxFit.contain)),
                        ),
                        SafeArea(
                          child: Padding(
                            padding: const EdgeInsets.all(8),
                            child: Row(
                              children: [
                                IconButton(
                                  onPressed: () => Navigator.pop(ctx),
                                  icon: const Icon(Symbols.close_rounded, color: Colors.white),
                                ),
                                Expanded(
                                  child: Text(
                                    '${photo.uploadedBy} · ${brainWhen(photo.uploadedAt)}',
                                    style: LefiText.body(13, color: Colors.white),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
          child: switch (bytes) {
            AsyncData(:final value) => Image.memory(value, fit: BoxFit.cover),
            AsyncError() => const Center(child: Icon(Symbols.broken_image_rounded, color: LefiColors.muted)),
            _ => const Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))),
          },
        ),
      ),
    );
  }
}

/// Supervisors, managers and administrators (`task.assign`): assign, priority, due time, cancel.
class _ManageCard extends ConsumerWidget {
  const _ManageCard({required this.task});
  final BrainTask task;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = task;
    final repo = ref.watch(brainTaskRepositoryProvider)!;
    final people = ref.watch(brainTasksProvider('active')).value?.people ?? const <TaskPerson>[];
    Future<void> act(String busy, Future<BrainTask> Function() call, String done) async {
      if (await runBrain(ref, busy, call, done: done)) refreshBrainTasks(ref, t.id);
    }

    return LefiCard(
      child: Gap(
        gap: 10,
        children: [
          Text('Manage this task', style: LefiText.outfit(16)),
          if (t.working && !t.robot)
            LefiOutlineButton(
              label: t.assignedToName == null ? 'Assign to a person' : 'Reassign · ${t.assignedToName}',
              icon: Symbols.person_add_rounded,
              height: 46,
              onPressed: () async {
                final v = await showAssignSheet(context, people: people, current: t.assignedTo);
                if (v == null) return;
                final name = people.where((p) => p.id == v).firstOrNull?.name;
                await act(
                  'Assigning…',
                  () => repo.assign(t.id, v.isEmpty ? null : v),
                  name == null ? 'Back in the queue.' : 'Assigned to $name.',
                );
              },
            ),
          LefiOutlineButton(
            label: 'Priority · ${brainPriorityLabel(t.priority)}',
            icon: Symbols.flag_rounded,
            height: 46,
            onPressed: () async {
              final v = await showPrioritySheet(context, t.priority);
              if (v == null || v == t.priority) return;
              await act('Saving…', () => repo.change(t.id, priority: v), 'Priority set to ${brainPriorityLabel(v)}.');
            },
          ),
          Row(
            children: [
              Expanded(
                child: LefiOutlineButton(
                  label: t.dueAt == null ? 'Set due time' : 'Due · ${brainWhen(t.dueAt)}',
                  icon: Symbols.event_rounded,
                  height: 46,
                  onPressed: () async {
                    final v = await pickDue(context, t.dueAt);
                    if (v == null) return;
                    await act('Saving…', () => repo.change(t.id, dueAt: v), 'Due time set.');
                  },
                ),
              ),
              if (t.dueAt != null) ...[
                const SizedBox(width: 8),
                LefiTextButton(
                  'Clear',
                  onPressed: () => act('Saving…', () => repo.change(t.id, clearDue: true), 'Due time cleared.'),
                ),
              ],
            ],
          ),
          LefiOutlineButton(
            label: 'Cancel task',
            icon: Symbols.block_rounded,
            height: 46,
            borderColor: LefiColors.dangerBorder,
            foreground: LefiColors.dangerDeep,
            onPressed: () async {
              final reason = await showNoteSheet(
                context,
                title: 'Cancel ${t.label}?',
                body: 'It closes without being done. Say why, so the team knows.',
                hint: 'Why it is cancelled',
                confirmLabel: 'Cancel task',
                confirmColor: LefiColors.dangerDeep,
              );
              if (reason == null) return;
              await act('Cancelling…', () => repo.cancel(t.id, reason), '${t.label} cancelled.');
            },
          ),
        ],
      ),
    );
  }
}
