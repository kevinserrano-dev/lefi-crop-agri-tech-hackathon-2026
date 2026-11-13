// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'tasks_controller.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(TasksController)
final tasksControllerProvider = TasksControllerProvider._();

final class TasksControllerProvider
    extends $AsyncNotifierProvider<TasksController, List<FieldTask>> {
  TasksControllerProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'tasksControllerProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$tasksControllerHash();

  @$internal
  @override
  TasksController create() => TasksController();
}

String _$tasksControllerHash() => r'df44ae9190211e1b93bb58c57ec9330bc1c55993';

abstract class _$TasksController extends $AsyncNotifier<List<FieldTask>> {
  FutureOr<List<FieldTask>> build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<AsyncValue<List<FieldTask>>, List<FieldTask>>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<AsyncValue<List<FieldTask>>, List<FieldTask>>,
              AsyncValue<List<FieldTask>>,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

/// Generates demo photo ids (IMG-4910, IMG-4911…). Real capture comes with the camera plugin.

@ProviderFor(PhotoSequence)
final photoSequenceProvider = PhotoSequenceProvider._();

/// Generates demo photo ids (IMG-4910, IMG-4911…). Real capture comes with the camera plugin.
final class PhotoSequenceProvider
    extends $NotifierProvider<PhotoSequence, int> {
  /// Generates demo photo ids (IMG-4910, IMG-4911…). Real capture comes with the camera plugin.
  PhotoSequenceProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'photoSequenceProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$photoSequenceHash();

  @$internal
  @override
  PhotoSequence create() => PhotoSequence();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(int value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<int>(value),
    );
  }
}

String _$photoSequenceHash() => r'e744cb5dd2476e242fb46c6d4bac79a49b1e894e';

/// Generates demo photo ids (IMG-4910, IMG-4911…). Real capture comes with the camera plugin.

abstract class _$PhotoSequence extends $Notifier<int> {
  int build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<int, int>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<int, int>,
              int,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

/// Tasks tab scope: false = "My tasks", true = "Team tasks".

@ProviderFor(TaskScopeTeam)
final taskScopeTeamProvider = TaskScopeTeamProvider._();

/// Tasks tab scope: false = "My tasks", true = "Team tasks".
final class TaskScopeTeamProvider
    extends $NotifierProvider<TaskScopeTeam, bool> {
  /// Tasks tab scope: false = "My tasks", true = "Team tasks".
  TaskScopeTeamProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'taskScopeTeamProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$taskScopeTeamHash();

  @$internal
  @override
  TaskScopeTeam create() => TaskScopeTeam();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(bool value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<bool>(value),
    );
  }
}

String _$taskScopeTeamHash() => r'a7000546f60756c4df33032a9c9751ebea6ba7a6';

/// Tasks tab scope: false = "My tasks", true = "Team tasks".

abstract class _$TaskScopeTeam extends $Notifier<bool> {
  bool build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<bool, bool>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<bool, bool>,
              bool,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
