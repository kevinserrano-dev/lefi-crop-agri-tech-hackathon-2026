// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'brain_robots.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// The simulated robot on Lefi Brain for roles with `nav.robots` (everyone but the worker); null otherwise.

@ProviderFor(brainRobotRepository)
final brainRobotRepositoryProvider = BrainRobotRepositoryProvider._();

/// The simulated robot on Lefi Brain for roles with `nav.robots` (everyone but the worker); null otherwise.

final class BrainRobotRepositoryProvider
    extends
        $FunctionalProvider<
          BrainRobotRepository?,
          BrainRobotRepository?,
          BrainRobotRepository?
        >
    with $Provider<BrainRobotRepository?> {
  /// The simulated robot on Lefi Brain for roles with `nav.robots` (everyone but the worker); null otherwise.
  BrainRobotRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainRobotRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainRobotRepositoryHash();

  @$internal
  @override
  $ProviderElement<BrainRobotRepository?> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  BrainRobotRepository? create(Ref ref) {
    return brainRobotRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(BrainRobotRepository? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<BrainRobotRepository?>(value),
    );
  }
}

String _$brainRobotRepositoryHash() =>
    r'd27548fb367e1ae0a24370293e1abb1dfb77a368';

/// The robots Lefi Brain knows (one simulated MH3 today), for the Home card.

@ProviderFor(brainRobots)
final brainRobotsProvider = BrainRobotsProvider._();

/// The robots Lefi Brain knows (one simulated MH3 today), for the Home card.

final class BrainRobotsProvider
    extends
        $FunctionalProvider<
          AsyncValue<List<BrainRobot>>,
          List<BrainRobot>,
          FutureOr<List<BrainRobot>>
        >
    with $FutureModifier<List<BrainRobot>>, $FutureProvider<List<BrainRobot>> {
  /// The robots Lefi Brain knows (one simulated MH3 today), for the Home card.
  BrainRobotsProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainRobotsProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainRobotsHash();

  @$internal
  @override
  $FutureProviderElement<List<BrainRobot>> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<List<BrainRobot>> create(Ref ref) {
    return brainRobots(ref);
  }
}

String _$brainRobotsHash() => r'700f7d6b77de98fa74bd6c7f2fcbd8e14ad39c1e';

/// The first robot with its commands, missions and scene; null when Lefi Brain has no robot.

@ProviderFor(brainRobotLive)
final brainRobotLiveProvider = BrainRobotLiveProvider._();

/// The first robot with its commands, missions and scene; null when Lefi Brain has no robot.

final class BrainRobotLiveProvider
    extends
        $FunctionalProvider<
          AsyncValue<RobotLive?>,
          RobotLive?,
          FutureOr<RobotLive?>
        >
    with $FutureModifier<RobotLive?>, $FutureProvider<RobotLive?> {
  /// The first robot with its commands, missions and scene; null when Lefi Brain has no robot.
  BrainRobotLiveProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainRobotLiveProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainRobotLiveHash();

  @$internal
  @override
  $FutureProviderElement<RobotLive?> $createElement($ProviderPointer pointer) =>
      $FutureProviderElement(pointer);

  @override
  FutureOr<RobotLive?> create(Ref ref) {
    return brainRobotLive(ref);
  }
}

String _$brainRobotLiveHash() => r'6d5975bf1dfb40ebb306d14a4855b1aa9227492b';

/// The scene does not change while the simulator runs: asked once, again only after it came back null.

@ProviderFor(brainRobotScene)
final brainRobotSceneProvider = BrainRobotSceneFamily._();

/// The scene does not change while the simulator runs: asked once, again only after it came back null.

final class BrainRobotSceneProvider
    extends
        $FunctionalProvider<
          AsyncValue<RobotScene?>,
          RobotScene?,
          FutureOr<RobotScene?>
        >
    with $FutureModifier<RobotScene?>, $FutureProvider<RobotScene?> {
  /// The scene does not change while the simulator runs: asked once, again only after it came back null.
  BrainRobotSceneProvider._({
    required BrainRobotSceneFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'brainRobotSceneProvider',
         isAutoDispose: false,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$brainRobotSceneHash();

  @override
  String toString() {
    return r'brainRobotSceneProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<RobotScene?> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<RobotScene?> create(Ref ref) {
    final argument = this.argument as String;
    return brainRobotScene(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainRobotSceneProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainRobotSceneHash() => r'e25737bb5b9ddca7b153d7f988c4d6b70ca8ab4a';

/// The scene does not change while the simulator runs: asked once, again only after it came back null.

final class BrainRobotSceneFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<RobotScene?>, String> {
  BrainRobotSceneFamily._()
    : super(
        retry: null,
        name: r'brainRobotSceneProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: false,
      );

  /// The scene does not change while the simulator runs: asked once, again only after it came back null.

  BrainRobotSceneProvider call(String robotId) =>
      BrainRobotSceneProvider._(argument: robotId, from: this);

  @override
  String toString() => r'brainRobotSceneProvider';
}
