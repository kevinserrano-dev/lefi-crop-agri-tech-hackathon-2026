import 'dart:convert';
import 'dart:typed_data';

import '../../brain/data/brain_auth_repository.dart';
import '../domain/brain_task.dart';

/// Lefi Brain's tasks through Lefi Gateway (ADR-089, 093). Lefi Brain decides who sees, does,
/// verifies and assigns each task (`nav.tasks`, `task.all`, `task.assign`, `task.verify`); the
/// phone only asks.
class BrainTaskRepository {
  BrainTaskRepository(this.brain);
  final BrainAuthRepository brain;

  String get userId => brain.userId;
  String get roleId => brain.roleId;
  bool can(String permission) => brain.can(permission);

  String _q(Map<String, String?> q) {
    final parts = [
      for (final e in q.entries)
        if (e.value != null) '${e.key}=${Uri.encodeQueryComponent(e.value!)}',
    ];
    return parts.isEmpty ? '' : '?${parts.join('&')}';
  }

  /// [status]: active · closed · all · open · in_progress · awaiting · verified
  Future<BrainTaskList> list({String status = 'active', String? zoneId, String? alertId}) async {
    final a = await brain.api('GET', '/tasks${_q({'status': status, 'zone_id': zoneId, 'alert_id': alertId})}');
    return BrainTaskList.fromJson(a.json);
  }

  Future<BrainTask> detail(String id) async => BrainTask.fromJson((await brain.api('GET', '/tasks/$id')).json);

  Future<BrainTask> _act(String id, String action, [Object? body]) async =>
      BrainTask.fromJson((await brain.api('POST', '/tasks/$id/$action', body: body)).json);

  Map<String, dynamic> _note(String? note) => {'note': note == null || note.trim().isEmpty ? null : note.trim()};

  Future<BrainTask> start(String id) => _act(id, 'start');
  Future<BrainTask> complete(String id, String? note) => _act(id, 'complete', _note(note));
  Future<BrainTask> verify(String id, String? note) => _act(id, 'verify', _note(note));
  Future<BrainTask> sendBack(String id, String note) => _act(id, 'return', _note(note));
  Future<BrainTask> cancel(String id, String? reason) => _act(id, 'cancel', _note(reason));
  Future<BrainTask> assign(String id, String? userId) => _act(id, 'assign', {'user_id': userId});

  Future<BrainTask> change(String id, {String? priority, DateTime? dueAt, bool clearDue = false}) async =>
      BrainTask.fromJson(
        (await brain.api(
          'PATCH',
          '/tasks/$id',
          body: {
            'priority': ?priority,
            if (dueAt != null) 'due_at': dueAt.toUtc().toIso8601String(),
            'clear_due': clearDue,
          },
        )).json,
      );

  Future<BrainTask> create(NewTask t) async =>
      BrainTask.fromJson((await brain.api('POST', '/tasks', body: t.toJson())).json);

  Future<List<TaskPhoto>> photos(String taskId) async {
    final a = await brain.api('GET', '/tasks/$taskId/photos');
    final list = a.body is List ? a.body! as List : const [];
    return [
      for (final p in list)
        if (p is Map<String, dynamic>) TaskPhoto.fromJson(p),
    ];
  }

  Future<Uint8List> photoBytes(String photoId) async {
    final a = await brain.api('GET', '/task-photos/$photoId');
    return base64Decode(a.json['image_base64'] as String? ?? '');
  }

  /// JPEG or PNG, at most 5 MB (Lefi Brain checks both).
  Future<TaskPhoto> addPhoto(String taskId, Uint8List bytes, {String? note}) async {
    final a = await brain.api(
      'POST',
      '/tasks/$taskId/photos',
      body: {'image_base64': base64Encode(bytes), if (note != null && note.trim().isNotEmpty) 'note': note.trim()},
    );
    return TaskPhoto.fromJson(a.json);
  }
}
