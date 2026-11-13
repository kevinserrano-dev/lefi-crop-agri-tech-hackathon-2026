import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/router/routes.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/widgets/selectors.dart';
import '../../brain/data/brain_json.dart';
import '../application/brain_tasks.dart';
import '../application/tasks_controller.dart';
import '../domain/brain_task.dart';
import 'brain_task_sheets.dart';
import 'brain_task_style.dart';

enum BrainTaskFilter { todo, awaiting, closed }

/// The Tasks tab on Lefi Brain (ADR-089, 093, 099): the person's own tasks and, with `task.all`,
/// the team's. Nothing here is sample data.
class BrainTasksView extends ConsumerStatefulWidget {
  const BrainTasksView({super.key});

  @override
  ConsumerState<BrainTasksView> createState() => _BrainTasksViewState();
}

class _BrainTasksViewState extends ConsumerState<BrainTasksView> {
  BrainTaskFilter _filter = BrainTaskFilter.todo;

  bool _matches(BrainTask t, BrainTaskFilter f) => switch (f) {
    BrainTaskFilter.todo => t.working,
    BrainTaskFilter.awaiting => t.status == 'awaiting',
    BrainTaskFilter.closed => !t.active,
  };

  @override
  Widget build(BuildContext context) {
    final repo = ref.watch(brainTaskRepositoryProvider)!;
    final async = ref.watch(brainTasksProvider('all'));
    return AsyncView(
      async,
      data: (l) {
        final mine = l.tasks.where((t) => t.isMine(repo.userId, repo.roleId)).toList();
        final team = l.canSeeAll && ref.watch(taskScopeTeamProvider);
        final scoped = team ? l.tasks : mine;
        final shown = scoped.where((t) => _matches(t, _filter)).toList();
        final now = DateTime.now();
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
          child: Gap(
            gap: 12,
            children: [
              if (l.canSeeAll)
                SegmentedTabs<bool>(
                  items: const [false, true],
                  selected: team,
                  labelOf: (t) => t
                      ? 'Team · ${l.tasks.where((x) => x.active).length}'
                      : 'Mine · ${mine.where((x) => x.active).length}',
                  onSelected: ref.read(taskScopeTeamProvider.notifier).set,
                ),
              FilterPills<BrainTaskFilter>(
                items: BrainTaskFilter.values,
                selected: _filter,
                labelOf: (f) =>
                    '${switch (f) {
                      BrainTaskFilter.todo => 'To do',
                      BrainTaskFilter.awaiting => 'Awaiting check',
                      BrainTaskFilter.closed => 'Closed',
                    }} · ${scoped.where((t) => _matches(t, f)).length}',
                onSelected: (f) => setState(() => _filter = f),
              ),
              if (l.canCreate)
                LefiOutlineButton(
                  label: 'New task',
                  icon: Symbols.add_task_rounded,
                  height: 46,
                  onPressed: () => showNewTaskSheet(context, ref, people: l.people),
                ),
              for (final t in shown) BrainTaskCard(task: t, showAssignee: team, now: now),
              if (shown.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 12),
                  child: Column(
                    children: [
                      Image.asset('assets/brand/mascot-sleeping.png', width: 130),
                      const SizedBox(height: 8),
                      Text('All clear', style: LefiText.outfit(18)),
                      const SizedBox(height: 8),
                      Text(
                        switch (_filter) {
                          BrainTaskFilter.todo => 'No tasks to do in this view.',
                          BrainTaskFilter.awaiting => 'No work waiting to be checked.',
                          BrainTaskFilter.closed => 'No closed tasks yet.',
                        },
                        textAlign: TextAlign.center,
                        style: LefiText.body(14, color: LefiColors.subtle),
                      ),
                    ],
                  ),
                ),
              if (l.counts.robot > 0 && l.robotReason.isNotEmpty)
                InfoNote(text: '${plural(l.counts.robot, 'robot task')} waiting: ${l.robotReason}'),
            ],
          ),
        );
      },
    );
  }
}

class BrainTaskCard extends StatelessWidget {
  const BrainTaskCard({super.key, required this.task, required this.showAssignee, required this.now});
  final BrainTask task;
  final bool showAssignee;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final t = task;
    final st = brainStatusTone(t.status);
    final (src, srcTone, srcIcon) = taskSourceTag(t);
    final overdue = t.overdue(now);
    final who = t.robot
        ? 'Robot'
        : t.assignedToName ?? (t.forRole != null ? 'Unassigned · ${roleLabel(t.forRole!)}' : 'Unassigned');
    return LefiCard(
      onTap: () => context.pushDetail<void>('task/${t.id}'),
      borderColor: overdue ? LefiColors.dangerBorder : LefiColors.border,
      child: Gap(
        gap: 9,
        children: [
          Row(
            children: [
              ToneChip(brainPriorityLabel(t.priority), tone: brainPriorityTone(t.priority)),
              const SizedBox(width: 6),
              Flexible(
                child: ToneChip(src, tone: srcTone, icon: srcIcon),
              ),
              if (t.simulated) ...[const SizedBox(width: 6), const SimulationBadge(fontSize: 10)],
              const Spacer(),
              if (t.dueAt != null) ...[
                Icon(Symbols.schedule_rounded, size: 16, color: overdue ? LefiColors.dangerDeep : LefiColors.muted),
                const SizedBox(width: 4),
                Text(
                  overdue ? 'Overdue' : brainWhen(t.dueAt, now: now),
                  style: LefiText.body(12.5, weight: 600, color: overdue ? LefiColors.dangerDeep : LefiColors.muted),
                ),
              ],
            ],
          ),
          Text(t.title, style: LefiText.body(16, weight: 700, color: LefiColors.ink, height: 1.3)),
          Text(
            [
              t.label,
              t.zone ?? 'No zone',
              if (t.alertNumber != null) t.alertNumber!,
              if (showAssignee || t.assignedTo == null) who,
            ].join(' · '),
            style: LefiText.body(13, color: LefiColors.muted),
          ),
          Row(
            children: [
              ToneChip(taskStatusLabel(t.status), tone: st, fontSize: 11.5),
              const SizedBox(width: 8),
              Icon(taskKindIcon(t.kind), size: 16, color: LefiColors.subtle),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  taskKindLabel(t.kind),
                  overflow: TextOverflow.ellipsis,
                  style: LefiText.body(12, color: LefiColors.subtle),
                ),
              ),
              if (t.reviewNote != null && t.status == 'in_progress')
                const ToneChip('Returned', tone: Tone.warn, fontSize: 11),
            ],
          ),
        ],
      ),
    );
  }
}
