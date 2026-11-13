import 'task.dart';

abstract interface class TaskRepository {
  Future<List<FieldTask>> tasks();
  Future<FieldTask> save(FieldTask task);
}
