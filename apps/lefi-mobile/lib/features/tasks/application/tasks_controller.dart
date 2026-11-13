import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../data/demo_task_repository.dart';
import '../domain/task.dart';

part 'tasks_controller.g.dart';

@Riverpod(keepAlive: true)
class TasksController extends _$TasksController {
  @override
  Future<List<FieldTask>> build() => ref.watch(taskRepositoryProvider).tasks();

  FieldTask byId(String id) => state.requireValue.firstWhere((t) => t.id == id);

  Future<void> _save(FieldTask t) async {
    final saved = await ref.read(taskRepositoryProvider).save(t);
    state = AsyncData([for (final x in state.requireValue) x.id == saved.id ? saved : x]);
  }

  /// Optimistic local change for instant feedback (step checkboxes).
  void _local(FieldTask t) => state = AsyncData([for (final x in state.requireValue) x.id == t.id ? t : x]);

  Future<void> start(String id) => _save(byId(id).copyWith(status: TaskStatus.inProgress));

  Future<void> complete(String id) => _save(byId(id).copyWith(status: TaskStatus.completed));

  void toggleStep(String id, int step) {
    final t = byId(id);
    final done = {...t.doneSteps};
    done.contains(step) ? done.remove(step) : done.add(step);
    _local(t.copyWith(doneSteps: done));
  }

  void addPhoto(String id, String photoId) {
    final t = byId(id);
    _local(t.copyWith(photos: [...t.photos, photoId]));
  }

  void addNote(String id, String text) {
    final t = byId(id);
    final who = ref.read(currentUserProvider).name;
    _local(
      t.copyWith(
        notes: [
          TaskNote(author: who, time: 'Today · 10:4${t.notes.length}', text: text),
          ...t.notes,
        ],
      ),
    );
  }
}

/// Generates demo photo ids (IMG-4910, IMG-4911…). Real capture comes with the camera plugin.
@Riverpod(keepAlive: true)
class PhotoSequence extends _$PhotoSequence {
  @override
  int build() => 4910;

  String next() => 'IMG-${state++}';
}

/// Tasks tab scope: false = "My tasks", true = "Team tasks".
@Riverpod(keepAlive: true)
class TaskScopeTeam extends _$TaskScopeTeam {
  @override
  bool build() {
    ref.watch(sessionProvider);
    return false;
  }

  void set(bool team) => state = team;
}
