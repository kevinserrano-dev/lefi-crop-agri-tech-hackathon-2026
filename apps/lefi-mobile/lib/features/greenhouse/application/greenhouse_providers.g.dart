// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'greenhouse_providers.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(greenhouses)
final greenhousesProvider = GreenhousesProvider._();

final class GreenhousesProvider
    extends $FunctionalProvider<AsyncValue<List<Greenhouse>>, List<Greenhouse>, FutureOr<List<Greenhouse>>>
    with $FutureModifier<List<Greenhouse>>, $FutureProvider<List<Greenhouse>> {
  GreenhousesProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'greenhousesProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$greenhousesHash();

  @$internal
  @override
  $FutureProviderElement<List<Greenhouse>> $createElement($ProviderPointer pointer) => $FutureProviderElement(pointer);

  @override
  FutureOr<List<Greenhouse>> create(Ref ref) {
    return greenhouses(ref);
  }
}

String _$greenhousesHash() => r'1c8fd3d228e0724be77bdeaeb9f1285c40dd8b2e';

@ProviderFor(zones)
final zonesProvider = ZonesProvider._();

final class ZonesProvider extends $FunctionalProvider<AsyncValue<List<Zone>>, List<Zone>, FutureOr<List<Zone>>>
    with $FutureModifier<List<Zone>>, $FutureProvider<List<Zone>> {
  ZonesProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'zonesProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$zonesHash();

  @$internal
  @override
  $FutureProviderElement<List<Zone>> $createElement($ProviderPointer pointer) => $FutureProviderElement(pointer);

  @override
  FutureOr<List<Zone>> create(Ref ref) {
    return zones(ref);
  }
}

String _$zonesHash() => r'657de8fa3e26b1fdaf8d75929b18e267d44d6c69';

@ProviderFor(plants)
final plantsProvider = PlantsProvider._();

final class PlantsProvider extends $FunctionalProvider<AsyncValue<List<Plant>>, List<Plant>, FutureOr<List<Plant>>>
    with $FutureModifier<List<Plant>>, $FutureProvider<List<Plant>> {
  PlantsProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'plantsProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$plantsHash();

  @$internal
  @override
  $FutureProviderElement<List<Plant>> $createElement($ProviderPointer pointer) => $FutureProviderElement(pointer);

  @override
  FutureOr<List<Plant>> create(Ref ref) {
    return plants(ref);
  }
}

String _$plantsHash() => r'5609ca93c6df1d91990d2a76cab7e13d1df53d67';

@ProviderFor(accessPolicy)
final accessPolicyProvider = AccessPolicyProvider._();

final class AccessPolicyProvider
    extends $FunctionalProvider<AsyncValue<AccessPolicy>, AccessPolicy, FutureOr<AccessPolicy>>
    with $FutureModifier<AccessPolicy>, $FutureProvider<AccessPolicy> {
  AccessPolicyProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'accessPolicyProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$accessPolicyHash();

  @$internal
  @override
  $FutureProviderElement<AccessPolicy> $createElement($ProviderPointer pointer) => $FutureProviderElement(pointer);

  @override
  FutureOr<AccessPolicy> create(Ref ref) {
    return accessPolicy(ref);
  }
}

String _$accessPolicyHash() => r'2fae236c5720a4bded0e5ac66a6a66af4fd58b88';

@ProviderFor(plantHealthHistory)
final plantHealthHistoryProvider = PlantHealthHistoryFamily._();

final class PlantHealthHistoryProvider
    extends $FunctionalProvider<AsyncValue<List<double>>, List<double>, FutureOr<List<double>>>
    with $FutureModifier<List<double>>, $FutureProvider<List<double>> {
  PlantHealthHistoryProvider._({required PlantHealthHistoryFamily super.from, required String super.argument})
    : super(
        retry: null,
        name: r'plantHealthHistoryProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$plantHealthHistoryHash();

  @override
  String toString() {
    return r'plantHealthHistoryProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<List<double>> $createElement($ProviderPointer pointer) => $FutureProviderElement(pointer);

  @override
  FutureOr<List<double>> create(Ref ref) {
    final argument = this.argument as String;
    return plantHealthHistory(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is PlantHealthHistoryProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$plantHealthHistoryHash() => r'5defffecfee6367f0fb94d413fee255164cfec14';

final class PlantHealthHistoryFamily extends $Family with $FunctionalFamilyOverride<FutureOr<List<double>>, String> {
  PlantHealthHistoryFamily._()
    : super(
        retry: null,
        name: r'plantHealthHistoryProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  PlantHealthHistoryProvider call(String plantId) => PlantHealthHistoryProvider._(argument: plantId, from: this);

  @override
  String toString() => r'plantHealthHistoryProvider';
}

/// Human observations saved from inspections during this session (newest first).

@ProviderFor(SessionObservations)
final sessionObservationsProvider = SessionObservationsProvider._();

/// Human observations saved from inspections during this session (newest first).
final class SessionObservationsProvider extends $NotifierProvider<SessionObservations, Map<String, List<Observation>>> {
  /// Human observations saved from inspections during this session (newest first).
  SessionObservationsProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'sessionObservationsProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$sessionObservationsHash();

  @$internal
  @override
  SessionObservations create() => SessionObservations();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(Map<String, List<Observation>> value) {
    return $ProviderOverride(origin: this, providerOverride: $SyncValueProvider<Map<String, List<Observation>>>(value));
  }
}

String _$sessionObservationsHash() => r'ef72a951af85142d760855d5a271b20d0c1ea2f0';

/// Human observations saved from inspections during this session (newest first).

abstract class _$SessionObservations extends $Notifier<Map<String, List<Observation>>> {
  Map<String, List<Observation>> build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<Map<String, List<Observation>>, Map<String, List<Observation>>>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<Map<String, List<Observation>>, Map<String, List<Observation>>>,
              Map<String, List<Observation>>,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

@ProviderFor(plantObservations)
final plantObservationsProvider = PlantObservationsFamily._();

final class PlantObservationsProvider
    extends $FunctionalProvider<AsyncValue<List<Observation>>, List<Observation>, FutureOr<List<Observation>>>
    with $FutureModifier<List<Observation>>, $FutureProvider<List<Observation>> {
  PlantObservationsProvider._({required PlantObservationsFamily super.from, required String super.argument})
    : super(
        retry: null,
        name: r'plantObservationsProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$plantObservationsHash();

  @override
  String toString() {
    return r'plantObservationsProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<List<Observation>> $createElement($ProviderPointer pointer) => $FutureProviderElement(pointer);

  @override
  FutureOr<List<Observation>> create(Ref ref) {
    final argument = this.argument as String;
    return plantObservations(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is PlantObservationsProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$plantObservationsHash() => r'113148370b64e0a032a7cdb7923ee419d6ef0f2e';

final class PlantObservationsFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<List<Observation>>, String> {
  PlantObservationsFamily._()
    : super(
        retry: null,
        name: r'plantObservationsProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  PlantObservationsProvider call(String plantId) => PlantObservationsProvider._(argument: plantId, from: this);

  @override
  String toString() => r'plantObservationsProvider';
}

/// Flagged plants in a zone with their latest AI observation.

@ProviderFor(zoneAiFlags)
final zoneAiFlagsProvider = ZoneAiFlagsFamily._();

/// Flagged plants in a zone with their latest AI observation.

final class ZoneAiFlagsProvider
    extends
        $FunctionalProvider<
          AsyncValue<List<(Plant, Observation)>>,
          List<(Plant, Observation)>,
          FutureOr<List<(Plant, Observation)>>
        >
    with $FutureModifier<List<(Plant, Observation)>>, $FutureProvider<List<(Plant, Observation)>> {
  /// Flagged plants in a zone with their latest AI observation.
  ZoneAiFlagsProvider._({required ZoneAiFlagsFamily super.from, required String super.argument})
    : super(
        retry: null,
        name: r'zoneAiFlagsProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$zoneAiFlagsHash();

  @override
  String toString() {
    return r'zoneAiFlagsProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<List<(Plant, Observation)>> $createElement($ProviderPointer pointer) =>
      $FutureProviderElement(pointer);

  @override
  FutureOr<List<(Plant, Observation)>> create(Ref ref) {
    final argument = this.argument as String;
    return zoneAiFlags(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is ZoneAiFlagsProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$zoneAiFlagsHash() => r'78c3d4a8b9be9befd93d130d2c796c945ad682f6';

/// Flagged plants in a zone with their latest AI observation.

final class ZoneAiFlagsFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<List<(Plant, Observation)>>, String> {
  ZoneAiFlagsFamily._()
    : super(
        retry: null,
        name: r'zoneAiFlagsProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// Flagged plants in a zone with their latest AI observation.

  ZoneAiFlagsProvider call(String zoneId) => ZoneAiFlagsProvider._(argument: zoneId, from: this);

  @override
  String toString() => r'zoneAiFlagsProvider';
}
