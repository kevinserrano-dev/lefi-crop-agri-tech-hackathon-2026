// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'brain_greenhouse.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Lefi Brain's greenhouses when signed in to it (`nav.greenhouses`: every role); null on demo data.

@ProviderFor(brainGreenhouseRepository)
final brainGreenhouseRepositoryProvider = BrainGreenhouseRepositoryProvider._();

/// Lefi Brain's greenhouses when signed in to it (`nav.greenhouses`: every role); null on demo data.

final class BrainGreenhouseRepositoryProvider
    extends
        $FunctionalProvider<
          BrainGreenhouseRepository?,
          BrainGreenhouseRepository?,
          BrainGreenhouseRepository?
        >
    with $Provider<BrainGreenhouseRepository?> {
  /// Lefi Brain's greenhouses when signed in to it (`nav.greenhouses`: every role); null on demo data.
  BrainGreenhouseRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainGreenhouseRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainGreenhouseRepositoryHash();

  @$internal
  @override
  $ProviderElement<BrainGreenhouseRepository?> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  BrainGreenhouseRepository? create(Ref ref) {
    return brainGreenhouseRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(BrainGreenhouseRepository? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<BrainGreenhouseRepository?>(value),
    );
  }
}

String _$brainGreenhouseRepositoryHash() =>
    r'c9748b9f00972002bd4287aea718e0f223ce4860';

@ProviderFor(brainGreenhouseOverview)
final brainGreenhouseOverviewProvider = BrainGreenhouseOverviewProvider._();

final class BrainGreenhouseOverviewProvider
    extends
        $FunctionalProvider<
          AsyncValue<GreenhouseOverview>,
          GreenhouseOverview,
          FutureOr<GreenhouseOverview>
        >
    with
        $FutureModifier<GreenhouseOverview>,
        $FutureProvider<GreenhouseOverview> {
  BrainGreenhouseOverviewProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainGreenhouseOverviewProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainGreenhouseOverviewHash();

  @$internal
  @override
  $FutureProviderElement<GreenhouseOverview> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<GreenhouseOverview> create(Ref ref) {
    return brainGreenhouseOverview(ref);
  }
}

String _$brainGreenhouseOverviewHash() =>
    r'4c4a03c90b2fa64a62fb9610e3254c4927e1d8f3';

@ProviderFor(brainZoneDetail)
final brainZoneDetailProvider = BrainZoneDetailFamily._();

final class BrainZoneDetailProvider
    extends
        $FunctionalProvider<
          AsyncValue<ZoneDetail>,
          ZoneDetail,
          FutureOr<ZoneDetail>
        >
    with $FutureModifier<ZoneDetail>, $FutureProvider<ZoneDetail> {
  BrainZoneDetailProvider._({
    required BrainZoneDetailFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'brainZoneDetailProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$brainZoneDetailHash();

  @override
  String toString() {
    return r'brainZoneDetailProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<ZoneDetail> $createElement($ProviderPointer pointer) =>
      $FutureProviderElement(pointer);

  @override
  FutureOr<ZoneDetail> create(Ref ref) {
    final argument = this.argument as String;
    return brainZoneDetail(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainZoneDetailProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainZoneDetailHash() => r'28501b8e49a00c291f274b470928229a242e95b7';

final class BrainZoneDetailFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<ZoneDetail>, String> {
  BrainZoneDetailFamily._()
    : super(
        retry: null,
        name: r'brainZoneDetailProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  BrainZoneDetailProvider call(String zoneId) =>
      BrainZoneDetailProvider._(argument: zoneId, from: this);

  @override
  String toString() => r'brainZoneDetailProvider';
}

@ProviderFor(brainPlantDetail)
final brainPlantDetailProvider = BrainPlantDetailFamily._();

final class BrainPlantDetailProvider
    extends
        $FunctionalProvider<
          AsyncValue<PlantDetail>,
          PlantDetail,
          FutureOr<PlantDetail>
        >
    with $FutureModifier<PlantDetail>, $FutureProvider<PlantDetail> {
  BrainPlantDetailProvider._({
    required BrainPlantDetailFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'brainPlantDetailProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$brainPlantDetailHash();

  @override
  String toString() {
    return r'brainPlantDetailProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<PlantDetail> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<PlantDetail> create(Ref ref) {
    final argument = this.argument as String;
    return brainPlantDetail(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainPlantDetailProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainPlantDetailHash() => r'827e90e6322e040ad9d4c9471c8203536c9d4187';

final class BrainPlantDetailFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<PlantDetail>, String> {
  BrainPlantDetailFamily._()
    : super(
        retry: null,
        name: r'brainPlantDetailProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  BrainPlantDetailProvider call(String plantId) =>
      BrainPlantDetailProvider._(argument: plantId, from: this);

  @override
  String toString() => r'brainPlantDetailProvider';
}

/// Zones for pickers (new task): from the same list the Greenhouse tab shows.

@ProviderFor(brainZones)
final brainZonesProvider = BrainZonesProvider._();

/// Zones for pickers (new task): from the same list the Greenhouse tab shows.

final class BrainZonesProvider
    extends
        $FunctionalProvider<
          AsyncValue<List<BrainZone>>,
          List<BrainZone>,
          FutureOr<List<BrainZone>>
        >
    with $FutureModifier<List<BrainZone>>, $FutureProvider<List<BrainZone>> {
  /// Zones for pickers (new task): from the same list the Greenhouse tab shows.
  BrainZonesProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainZonesProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainZonesHash();

  @$internal
  @override
  $FutureProviderElement<List<BrainZone>> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<List<BrainZone>> create(Ref ref) {
    return brainZones(ref);
  }
}

String _$brainZonesHash() => r'f7699c449ea6d6ebfafdbc3f2a639ce07c217f61';

/// One plant's summary (ADR-109), by id or code; asked again while open.

@ProviderFor(brainPlantSummary)
final brainPlantSummaryProvider = BrainPlantSummaryFamily._();

/// One plant's summary (ADR-109), by id or code; asked again while open.

final class BrainPlantSummaryProvider
    extends
        $FunctionalProvider<
          AsyncValue<PlantSummary>,
          PlantSummary,
          FutureOr<PlantSummary>
        >
    with $FutureModifier<PlantSummary>, $FutureProvider<PlantSummary> {
  /// One plant's summary (ADR-109), by id or code; asked again while open.
  BrainPlantSummaryProvider._({
    required BrainPlantSummaryFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'brainPlantSummaryProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$brainPlantSummaryHash();

  @override
  String toString() {
    return r'brainPlantSummaryProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<PlantSummary> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<PlantSummary> create(Ref ref) {
    final argument = this.argument as String;
    return brainPlantSummary(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainPlantSummaryProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainPlantSummaryHash() => r'e6d50d34a89e351105d37881e22cf4c01e712f29';

/// One plant's summary (ADR-109), by id or code; asked again while open.

final class BrainPlantSummaryFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<PlantSummary>, String> {
  BrainPlantSummaryFamily._()
    : super(
        retry: null,
        name: r'brainPlantSummaryProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// One plant's summary (ADR-109), by id or code; asked again while open.

  BrainPlantSummaryProvider call(String plantRef) =>
      BrainPlantSummaryProvider._(argument: plantRef, from: this);

  @override
  String toString() => r'brainPlantSummaryProvider';
}

/// Lefi AI's latest summary of the plant for this person; asked again every 2 s while pending.

@ProviderFor(brainPlantAiSummary)
final brainPlantAiSummaryProvider = BrainPlantAiSummaryFamily._();

/// Lefi AI's latest summary of the plant for this person; asked again every 2 s while pending.

final class BrainPlantAiSummaryProvider
    extends
        $FunctionalProvider<
          AsyncValue<PlantAiSummary>,
          PlantAiSummary,
          FutureOr<PlantAiSummary>
        >
    with $FutureModifier<PlantAiSummary>, $FutureProvider<PlantAiSummary> {
  /// Lefi AI's latest summary of the plant for this person; asked again every 2 s while pending.
  BrainPlantAiSummaryProvider._({
    required BrainPlantAiSummaryFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'brainPlantAiSummaryProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$brainPlantAiSummaryHash();

  @override
  String toString() {
    return r'brainPlantAiSummaryProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<PlantAiSummary> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<PlantAiSummary> create(Ref ref) {
    final argument = this.argument as String;
    return brainPlantAiSummary(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainPlantAiSummaryProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainPlantAiSummaryHash() =>
    r'e5f237ccf9f50c3c2e4c7cbede8405a82c75e9a5';

/// Lefi AI's latest summary of the plant for this person; asked again every 2 s while pending.

final class BrainPlantAiSummaryFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<PlantAiSummary>, String> {
  BrainPlantAiSummaryFamily._()
    : super(
        retry: null,
        name: r'brainPlantAiSummaryProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// Lefi AI's latest summary of the plant for this person; asked again every 2 s while pending.

  BrainPlantAiSummaryProvider call(String plantId) =>
      BrainPlantAiSummaryProvider._(argument: plantId, from: this);

  @override
  String toString() => r'brainPlantAiSummaryProvider';
}

/// The plant a tag names (ADR-109), by id or code (any case), from Lefi Brain's list of plants
/// (every Lefi Brain version has it). Null = Lefi Brain has no such plant.

@ProviderFor(brainPlantByRef)
final brainPlantByRefProvider = BrainPlantByRefFamily._();

/// The plant a tag names (ADR-109), by id or code (any case), from Lefi Brain's list of plants
/// (every Lefi Brain version has it). Null = Lefi Brain has no such plant.

final class BrainPlantByRefProvider
    extends
        $FunctionalProvider<
          AsyncValue<BrainPlant?>,
          BrainPlant?,
          FutureOr<BrainPlant?>
        >
    with $FutureModifier<BrainPlant?>, $FutureProvider<BrainPlant?> {
  /// The plant a tag names (ADR-109), by id or code (any case), from Lefi Brain's list of plants
  /// (every Lefi Brain version has it). Null = Lefi Brain has no such plant.
  BrainPlantByRefProvider._({
    required BrainPlantByRefFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'brainPlantByRefProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$brainPlantByRefHash();

  @override
  String toString() {
    return r'brainPlantByRefProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<BrainPlant?> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<BrainPlant?> create(Ref ref) {
    final argument = this.argument as String;
    return brainPlantByRef(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainPlantByRefProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainPlantByRefHash() => r'd7594ceae70eea59271634e6bf370f92ce77524f';

/// The plant a tag names (ADR-109), by id or code (any case), from Lefi Brain's list of plants
/// (every Lefi Brain version has it). Null = Lefi Brain has no such plant.

final class BrainPlantByRefFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<BrainPlant?>, String> {
  BrainPlantByRefFamily._()
    : super(
        retry: null,
        name: r'brainPlantByRefProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// The plant a tag names (ADR-109), by id or code (any case), from Lefi Brain's list of plants
  /// (every Lefi Brain version has it). Null = Lefi Brain has no such plant.

  BrainPlantByRefProvider call(String plantRef) =>
      BrainPlantByRefProvider._(argument: plantRef, from: this);

  @override
  String toString() => r'brainPlantByRefProvider';
}
