import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/demo_latency.dart';
import '../../../demo/demo_tasks.dart';
import '../domain/task.dart';
import '../domain/task_repository.dart';

part 'demo_task_repository.g.dart';

class DemoTaskRepository implements TaskRepository {
  final _store = {for (final t in demoTasks) t.id: t};

  @override
  Future<List<FieldTask>> tasks() => demoDelay(() => _store.values.toList());

  @override
  Future<FieldTask> save(FieldTask task) => demoDelay(() => _store[task.id] = task, ms: 500);
}

@Riverpod(keepAlive: true)
TaskRepository taskRepository(Ref ref) => DemoTaskRepository();
