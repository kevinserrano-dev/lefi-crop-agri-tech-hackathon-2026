import 'dart:async';
import 'dart:typed_data';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../data/brain_task_repository.dart';
import '../domain/brain_task.dart';

part 'brain_tasks.g.dart';

/// How often an open Tasks screen asks Lefi Brain again (no WebSocket yet).
const brainTasksPoll = Duration(seconds: 20);

/// Lefi Brain's tasks when signed in to it (`nav.tasks`: every role); null on demo data.
@Riverpod(keepAlive: true)
BrainTaskRepository? brainTaskRepository(Ref ref) {
  final auth = ref.watch(activeAuthRepositoryProvider);
  ref.watch(sessionProvider); // permissions change with who is signed in
  if (auth is! BrainAuthRepository || !auth.can('nav.tasks')) return null;
  return BrainTaskRepository(auth);
}

BrainTaskRepository _repo(Ref ref) =>
    ref.watch(brainTaskRepositoryProvider) ?? (throw StateError('Not connected to Lefi Brain.'));

/// [status]: active · closed · all · awaiting… ([BrainTaskRepository.list]).
@riverpod
Future<BrainTaskList> brainTasks(Ref ref, String status) async {
  final repo = _repo(ref);
  final timer = Timer(brainTasksPoll, ref.invalidateSelf);
  ref.onDispose(timer.cancel);
  return repo.list(status: status);
}

/// Active tasks of one zone (zone screen).
@riverpod
Future<BrainTaskList> brainZoneTasks(Ref ref, String zoneId) => _repo(ref).list(zoneId: zoneId);

@riverpod
Future<BrainTask> brainTask(Ref ref, String id) async {
  final repo = _repo(ref);
  final timer = Timer(brainTasksPoll, ref.invalidateSelf);
  ref.onDispose(timer.cancel);
  return repo.detail(id);
}

@riverpod
Future<List<TaskPhoto>> brainTaskPhotos(Ref ref, String taskId) => _repo(ref).photos(taskId);

/// A photo's bytes, kept while the app runs (photos never change).
@Riverpod(keepAlive: true)
Future<Uint8List> brainTaskPhotoBytes(Ref ref, String photoId) => _repo(ref).photoBytes(photoId);
