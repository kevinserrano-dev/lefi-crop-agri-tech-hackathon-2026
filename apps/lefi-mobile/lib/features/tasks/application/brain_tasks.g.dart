// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'brain_tasks.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Lefi Brain's tasks when signed in to it (`nav.tasks`: every role); null on demo data.

@ProviderFor(brainTaskRepository)
final brainTaskRepositoryProvider = BrainTaskRepositoryProvider._();

/// Lefi Brain's tasks when signed in to it (`nav.tasks`: every role); null on demo data.

final class BrainTaskRepositoryProvider
    extends
        $FunctionalProvider<
          BrainTaskRepository?,
          BrainTaskRepository?,
          BrainTaskRepository?
        >
    with $Provider<BrainTaskRepository?> {
  /// Lefi Brain's tasks when signed in to it (`nav.tasks`: every role); null on demo data.
  BrainTaskRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainTaskRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainTaskRepositoryHash();

  @$internal
  @override
  $ProviderElement<BrainTaskRepository?> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  BrainTaskRepository? create(Ref ref) {
    return brainTaskRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(BrainTaskRepository? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<BrainTaskRepository?>(value),
    );
  }
}

String _$brainTaskRepositoryHash() =>
    r'5c45429d790752fc6340d089c732270993c92a60';

/// [status]: active · closed · all · awaiting… ([BrainTaskRepository.list]).

@ProviderFor(brainTasks)
final brainTasksProvider = BrainTasksFamily._();

/// [status]: active · closed · all · awaiting… ([BrainTaskRepository.list]).

final class BrainTasksProvider
    extends
        $FunctionalProvider<
          AsyncValue<BrainTaskList>,
          BrainTaskList,
          FutureOr<BrainTaskList>
        >
    with $FutureModifier<BrainTaskList>, $FutureProvider<BrainTaskList> {
  /// [status]: active · closed · all · awaiting… ([BrainTaskRepository.list]).
  BrainTasksProvider._({
    required BrainTasksFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'brainTasksProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$brainTasksHash();

  @override
  String toString() {
    return r'brainTasksProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<BrainTaskList> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<BrainTaskList> create(Ref ref) {
    final argument = this.argument as String;
    return brainTasks(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainTasksProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainTasksHash() => r'b5cf6ffe32b765920bc0ae81bb52a593c606ac4b';

/// [status]: active · closed · all · awaiting… ([BrainTaskRepository.list]).

final class BrainTasksFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<BrainTaskList>, String> {
  BrainTasksFamily._()
    : super(
        retry: null,
        name: r'brainTasksProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// [status]: active · closed · all · awaiting… ([BrainTaskRepository.list]).

  BrainTasksProvider call(String status) =>
      BrainTasksProvider._(argument: status, from: this);

  @override
  String toString() => r'brainTasksProvider';
}

/// Active tasks of one zone (zone screen).

@ProviderFor(brainZoneTasks)
final brainZoneTasksProvider = BrainZoneTasksFamily._();

/// Active tasks of one zone (zone screen).

final class BrainZoneTasksProvider
    extends
        $FunctionalProvider<
          AsyncValue<BrainTaskList>,
          BrainTaskList,
          FutureOr<BrainTaskList>
        >
    with $FutureModifier<BrainTaskList>, $FutureProvider<BrainTaskList> {
  /// Active tasks of one zone (zone screen).
  BrainZoneTasksProvider._({
    required BrainZoneTasksFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'brainZoneTasksProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$brainZoneTasksHash();

  @override
  String toString() {
    return r'brainZoneTasksProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<BrainTaskList> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<BrainTaskList> create(Ref ref) {
    final argument = this.argument as String;
    return brainZoneTasks(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainZoneTasksProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainZoneTasksHash() => r'c50f7770373221ca90265a529cb53073078c2250';

/// Active tasks of one zone (zone screen).

final class BrainZoneTasksFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<BrainTaskList>, String> {
  BrainZoneTasksFamily._()
    : super(
        retry: null,
        name: r'brainZoneTasksProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// Active tasks of one zone (zone screen).

  BrainZoneTasksProvider call(String zoneId) =>
      BrainZoneTasksProvider._(argument: zoneId, from: this);

  @override
  String toString() => r'brainZoneTasksProvider';
}

@ProviderFor(brainTask)
final brainTaskProvider = BrainTaskFamily._();

final class BrainTaskProvider
    extends
        $FunctionalProvider<
          AsyncValue<BrainTask>,
          BrainTask,
          FutureOr<BrainTask>
        >
    with $FutureModifier<BrainTask>, $FutureProvider<BrainTask> {
  BrainTaskProvider._({
    required BrainTaskFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'brainTaskProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$brainTaskHash();

  @override
  String toString() {
    return r'brainTaskProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<BrainTask> $createElement($ProviderPointer pointer) =>
      $FutureProviderElement(pointer);

  @override
  FutureOr<BrainTask> create(Ref ref) {
    final argument = this.argument as String;
    return brainTask(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainTaskProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainTaskHash() => r'b8e96f5632d7af14f7033e0b8d06de56d1ff340b';

final class BrainTaskFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<BrainTask>, String> {
  BrainTaskFamily._()
    : super(
        retry: null,
        name: r'brainTaskProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  BrainTaskProvider call(String id) =>
      BrainTaskProvider._(argument: id, from: this);

  @override
  String toString() => r'brainTaskProvider';
}

@ProviderFor(brainTaskPhotos)
final brainTaskPhotosProvider = BrainTaskPhotosFamily._();

final class BrainTaskPhotosProvider
    extends
        $FunctionalProvider<
          AsyncValue<List<TaskPhoto>>,
          List<TaskPhoto>,
          FutureOr<List<TaskPhoto>>
        >
    with $FutureModifier<List<TaskPhoto>>, $FutureProvider<List<TaskPhoto>> {
  BrainTaskPhotosProvider._({
    required BrainTaskPhotosFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'brainTaskPhotosProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$brainTaskPhotosHash();

  @override
  String toString() {
    return r'brainTaskPhotosProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<List<TaskPhoto>> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<List<TaskPhoto>> create(Ref ref) {
    final argument = this.argument as String;
    return brainTaskPhotos(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainTaskPhotosProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainTaskPhotosHash() => r'78b960d0099257de6d5bc6077560e8ff9bac7e01';

final class BrainTaskPhotosFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<List<TaskPhoto>>, String> {
  BrainTaskPhotosFamily._()
    : super(
        retry: null,
        name: r'brainTaskPhotosProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  BrainTaskPhotosProvider call(String taskId) =>
      BrainTaskPhotosProvider._(argument: taskId, from: this);

  @override
  String toString() => r'brainTaskPhotosProvider';
}

/// A photo's bytes, kept while the app runs (photos never change).

@ProviderFor(brainTaskPhotoBytes)
final brainTaskPhotoBytesProvider = BrainTaskPhotoBytesFamily._();

/// A photo's bytes, kept while the app runs (photos never change).

final class BrainTaskPhotoBytesProvider
    extends
        $FunctionalProvider<
          AsyncValue<Uint8List>,
          Uint8List,
          FutureOr<Uint8List>
        >
    with $FutureModifier<Uint8List>, $FutureProvider<Uint8List> {
  /// A photo's bytes, kept while the app runs (photos never change).
  BrainTaskPhotoBytesProvider._({
    required BrainTaskPhotoBytesFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'brainTaskPhotoBytesProvider',
         isAutoDispose: false,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$brainTaskPhotoBytesHash();

  @override
  String toString() {
    return r'brainTaskPhotoBytesProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<Uint8List> $createElement($ProviderPointer pointer) =>
      $FutureProviderElement(pointer);

  @override
  FutureOr<Uint8List> create(Ref ref) {
    final argument = this.argument as String;
    return brainTaskPhotoBytes(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainTaskPhotoBytesProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainTaskPhotoBytesHash() =>
    r'a18b58c924873bb2f71588e881474b515cc087ce';

/// A photo's bytes, kept while the app runs (photos never change).

final class BrainTaskPhotoBytesFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<Uint8List>, String> {
  BrainTaskPhotoBytesFamily._()
    : super(
        retry: null,
        name: r'brainTaskPhotoBytesProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: false,
      );

  /// A photo's bytes, kept while the app runs (photos never change).

  BrainTaskPhotoBytesProvider call(String photoId) =>
      BrainTaskPhotoBytesProvider._(argument: photoId, from: this);

  @override
  String toString() => r'brainTaskPhotoBytesProvider';
}
