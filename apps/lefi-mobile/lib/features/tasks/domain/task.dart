enum TaskPriority { critical, high, normal }

enum TaskStatus { open, inProgress, completed }

enum TaskOrigin { human, ai }

class TaskNote {
  const TaskNote({required this.author, required this.time, required this.text});

  final String author;
  final String time;
  final String text;
}

class FieldTask {
  const FieldTask({
    required this.id,
    required this.title,
    required this.zoneId,
    required this.assignee,
    required this.due,
    required this.priority,
    required this.status,
    required this.origin,
    required this.source,
    required this.steps,
    this.doneSteps = const {},
    this.photoRequired = false,
    this.incident,
    this.photos = const [],
    this.notes = const [],
  });

  final String id;
  final String title;
  final String zoneId;
  final String assignee;
  final String due;
  final TaskPriority priority;
  final TaskStatus status;
  final TaskOrigin origin;
  final String source;
  final List<String> steps;
  final Set<int> doneSteps;
  final bool photoRequired;
  final String? incident;
  final List<String> photos;
  final List<TaskNote> notes;

  bool get isActive => status != TaskStatus.completed;

  FieldTask copyWith({TaskStatus? status, Set<int>? doneSteps, List<String>? photos, List<TaskNote>? notes}) =>
      FieldTask(
        id: id,
        title: title,
        zoneId: zoneId,
        assignee: assignee,
        due: due,
        priority: priority,
        status: status ?? this.status,
        origin: origin,
        source: source,
        steps: steps,
        doneSteps: doneSteps ?? this.doneSteps,
        photoRequired: photoRequired,
        incident: incident,
        photos: photos ?? this.photos,
        notes: notes ?? this.notes,
      );
}
