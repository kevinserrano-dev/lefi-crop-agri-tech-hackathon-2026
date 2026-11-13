import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/navigation/open_target.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/widgets/selectors.dart';
import '../../../core/theme/tone.dart';
import '../../../shared/domain/role.dart';
import '../../ai_control/presentation/ai_widgets.dart';
import '../../auth/application/session.dart';
import '../../auth/data/demo_auth_repository.dart';
import '../../greenhouse/application/greenhouse_providers.dart';
import '../../greenhouse/domain/greenhouse.dart';
import '../../home/domain/dashboard.dart';
import '../application/brain_tasks.dart';
import '../application/tasks_controller.dart';
import '../domain/task.dart';
import 'brain_tasks_view.dart';
import 'task_style.dart';

enum _Filter { active, completed, all }

class TasksScreen extends ConsumerStatefulWidget {
  const TasksScreen({super.key});

  @override
  ConsumerState<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends ConsumerState<TasksScreen> {
  _Filter _filter = _Filter.active;

  bool _matches(FieldTask t, _Filter f) => switch (f) {
    _Filter.active => t.isActive,
    _Filter.completed => !t.isActive,
    _Filter.all => true,
  };

  @override
  Widget build(BuildContext context) {
    if (ref.watch(brainTaskRepositoryProvider) != null) {
      return RootScreen(
        title: 'Tasks',
        subtitle: 'From Lefi Brain',
        onRefresh: () => ref.refresh(brainTasksProvider('all').future),
        children: const [BrainTasksView()],
      );
    }
    final user = ref.watch(currentUserProvider);
    final canTeam = user.role.can(Permission.team);
    final team = canTeam && ref.watch(taskScopeTeamProvider);
    final tasks = ref.watch(tasksControllerProvider);
    final policy = ref.watch(accessPolicyProvider).value;
    final colors = {for (final u in ref.read(authRepositoryProvider).demoAccounts()) u.name: u.colorValue};
    final zones = {for (final z in ref.watch(zonesProvider).value ?? const <Zone>[]) z.id: z};

    return RootScreen(
      title: 'Tasks',
      subtitle: canTeam ? 'My work and team assignments' : 'Work assigned to you',
      top: const AiOfflineBar(),
      children: [
        AsyncView(
          tasks,
          data: (all) {
            final mine = all.where((t) => t.assignee == user.name).toList();
            final teamT = all.where((t) => policy?.canSeeZone(t.zoneId) ?? false).toList();
            final scoped = team ? teamT : mine;
            final shown = scoped.where((t) => _matches(t, _filter)).toList();
            return Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
              child: Gap(
                gap: 12,
                children: [
                  if (canTeam)
                    SegmentedTabs<bool>(
                      items: const [false, true],
                      selected: team,
                      labelOf: (t) => t
                          ? 'Team tasks · ${teamT.where((x) => x.isActive).length}'
                          : 'My tasks · ${mine.where((x) => x.isActive).length}',
                      onSelected: ref.read(taskScopeTeamProvider.notifier).set,
                    ),
                  FilterPills<_Filter>(
                    items: _Filter.values,
                    selected: _filter,
                    labelOf: (f) =>
                        '${switch (f) {
                          _Filter.active => 'Active',
                          _Filter.completed => 'Completed',
                          _Filter.all => 'All',
                        }} · ${scoped.where((t) => _matches(t, f)).length}',
                    onSelected: (f) => setState(() => _filter = f),
                  ),
                  for (final t in shown)
                    _TaskCard(
                      task: t,
                      zoneLabel: zones[t.zoneId]?.label ?? '',
                      showAssignee: team,
                      assigneeColor: colors[t.assignee] ?? 0xFF5E6B65,
                      onTap: () => openTarget(context, TaskTarget(t.id)),
                    ),
                  if (shown.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 12),
                      child: Column(
                        children: [
                          Image.asset('assets/brand/mascot-sleeping.png', width: 130),
                          const SizedBox(height: 8),
                          Text('All clear', style: LefiText.outfit(18)),
                          const SizedBox(height: 8),
                          Text('No tasks in this view.', style: LefiText.body(14, color: LefiColors.subtle)),
                        ],
                      ),
                    ),
                ],
              ),
            );
          },
        ),
      ],
    );
  }
}

class _TaskCard extends StatelessWidget {
  const _TaskCard({
    required this.task,
    required this.zoneLabel,
    required this.showAssignee,
    required this.assigneeColor,
    required this.onTap,
  });
  final FieldTask task;
  final String zoneLabel;
  final bool showAssignee;
  final int assigneeColor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = task;
    final (sbg, sfg) = statusColors(t.status);
    return LefiCard(
      onTap: onTap,
      child: Gap(
        gap: 9,
        children: [
          Row(
            children: [
              ToneChip(priorityLabel(t.priority), tone: priorityTone(t.priority)),
              if (t.origin == TaskOrigin.ai) ...[
                const SizedBox(width: 6),
                const ToneChip(
                  'AI-generated',
                  tone: Tone.ai,
                  icon: Symbols.psychiatry_rounded,
                  padding: EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                ),
              ],
              const Spacer(),
              const Icon(Symbols.schedule_rounded, size: 16, color: LefiColors.muted),
              const SizedBox(width: 4),
              Text(t.due, style: LefiText.body(12.5, weight: 600, color: LefiColors.muted)),
            ],
          ),
          Text(t.title, style: LefiText.body(16, weight: 700, color: LefiColors.ink, height: 1.3)),
          Text(
            '${t.zoneId} · $zoneLabel${showAssignee ? ' · ${t.assignee}' : ''}',
            style: LefiText.body(13, color: LefiColors.muted),
          ),
          Row(
            children: [
              ToneChip(statusLabel(t.status), fontSize: 11.5, background: sbg, foreground: sfg),
              const SizedBox(width: 10),
              Expanded(child: LefiProgress(value: t.doneSteps.length / t.steps.length, height: 6)),
              const SizedBox(width: 10),
              Text('${t.doneSteps.length}/${t.steps.length} steps', style: LefiText.body(12, color: LefiColors.subtle)),
              if (showAssignee) ...[
                const SizedBox(width: 10),
                Avatar(initials: _initials(t.assignee), color: Color(assigneeColor), size: 28, fontSize: 10.5),
              ],
            ],
          ),
        ],
      ),
    );
  }

  static String _initials(String n) => n.split(' ').take(2).map((w) => w[0]).join().toUpperCase();
}
