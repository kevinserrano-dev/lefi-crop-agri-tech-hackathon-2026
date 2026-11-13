// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'brain_cameras.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Zone cameras on Lefi Brain for roles with `nav.devices` (administrator, manager, supervisor,
/// maintenance); null otherwise.

@ProviderFor(brainCameraRepository)
final brainCameraRepositoryProvider = BrainCameraRepositoryProvider._();

/// Zone cameras on Lefi Brain for roles with `nav.devices` (administrator, manager, supervisor,
/// maintenance); null otherwise.

final class BrainCameraRepositoryProvider
    extends $FunctionalProvider<BrainCameraRepository?, BrainCameraRepository?, BrainCameraRepository?>
    with $Provider<BrainCameraRepository?> {
  /// Zone cameras on Lefi Brain for roles with `nav.devices` (administrator, manager, supervisor,
  /// maintenance); null otherwise.
  BrainCameraRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainCameraRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainCameraRepositoryHash();

  @$internal
  @override
  $ProviderElement<BrainCameraRepository?> $createElement($ProviderPointer pointer) => $ProviderElement(pointer);

  @override
  BrainCameraRepository? create(Ref ref) {
    return brainCameraRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(BrainCameraRepository? value) {
    return $ProviderOverride(origin: this, providerOverride: $SyncValueProvider<BrainCameraRepository?>(value));
  }
}

String _$brainCameraRepositoryHash() => r'0d2b9d3ccfa453efddfeeb8b3401726df8096486';

/// The active cameras that look at this zone (ADR-087).

@ProviderFor(brainZoneCameras)
final brainZoneCamerasProvider = BrainZoneCamerasFamily._();

/// The active cameras that look at this zone (ADR-087).

final class BrainZoneCamerasProvider
    extends $FunctionalProvider<AsyncValue<List<BrainCamera>>, List<BrainCamera>, FutureOr<List<BrainCamera>>>
    with $FutureModifier<List<BrainCamera>>, $FutureProvider<List<BrainCamera>> {
  /// The active cameras that look at this zone (ADR-087).
  BrainZoneCamerasProvider._({required BrainZoneCamerasFamily super.from, required String super.argument})
    : super(
        retry: null,
        name: r'brainZoneCamerasProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainZoneCamerasHash();

  @override
  String toString() {
    return r'brainZoneCamerasProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<List<BrainCamera>> $createElement($ProviderPointer pointer) => $FutureProviderElement(pointer);

  @override
  FutureOr<List<BrainCamera>> create(Ref ref) {
    final argument = this.argument as String;
    return brainZoneCameras(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainZoneCamerasProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainZoneCamerasHash() => r'56bbde73a4dd7e46842a4727597d22aaeaf31e72';

/// The active cameras that look at this zone (ADR-087).

final class BrainZoneCamerasFamily extends $Family with $FunctionalFamilyOverride<FutureOr<List<BrainCamera>>, String> {
  BrainZoneCamerasFamily._()
    : super(
        retry: null,
        name: r'brainZoneCamerasProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// The active cameras that look at this zone (ADR-087).

  BrainZoneCamerasProvider call(String zoneId) => BrainZoneCamerasProvider._(argument: zoneId, from: this);

  @override
  String toString() => r'brainZoneCamerasProvider';
}

/// The zone's photos with Lefi AI's latest analysis of each (null = never looked at).

@ProviderFor(brainZonePhotos)
final brainZonePhotosProvider = BrainZonePhotosFamily._();

/// The zone's photos with Lefi AI's latest analysis of each (null = never looked at).

final class BrainZonePhotosProvider
    extends
        $FunctionalProvider<
          AsyncValue<List<(BrainCameraPhoto, PhotoAnalysis?)>>,
          List<(BrainCameraPhoto, PhotoAnalysis?)>,
          FutureOr<List<(BrainCameraPhoto, PhotoAnalysis?)>>
        >
    with
        $FutureModifier<List<(BrainCameraPhoto, PhotoAnalysis?)>>,
        $FutureProvider<List<(BrainCameraPhoto, PhotoAnalysis?)>> {
  /// The zone's photos with Lefi AI's latest analysis of each (null = never looked at).
  BrainZonePhotosProvider._({required BrainZonePhotosFamily super.from, required String super.argument})
    : super(
        retry: null,
        name: r'brainZonePhotosProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainZonePhotosHash();

  @override
  String toString() {
    return r'brainZonePhotosProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<List<(BrainCameraPhoto, PhotoAnalysis?)>> $createElement($ProviderPointer pointer) =>
      $FutureProviderElement(pointer);

  @override
  FutureOr<List<(BrainCameraPhoto, PhotoAnalysis?)>> create(Ref ref) {
    final argument = this.argument as String;
    return brainZonePhotos(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainZonePhotosProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainZonePhotosHash() => r'0c1aeb48e3e814ade6beb607649fa122fe8fab73';

/// The zone's photos with Lefi AI's latest analysis of each (null = never looked at).

final class BrainZonePhotosFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<List<(BrainCameraPhoto, PhotoAnalysis?)>>, String> {
  BrainZonePhotosFamily._()
    : super(
        retry: null,
        name: r'brainZonePhotosProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// The zone's photos with Lefi AI's latest analysis of each (null = never looked at).

  BrainZonePhotosProvider call(String zoneId) => BrainZonePhotosProvider._(argument: zoneId, from: this);

  @override
  String toString() => r'brainZonePhotosProvider';
}

@ProviderFor(brainCameraPhotoBytes)
final brainCameraPhotoBytesProvider = BrainCameraPhotoBytesFamily._();

final class BrainCameraPhotoBytesProvider
    extends $FunctionalProvider<AsyncValue<Uint8List>, Uint8List, FutureOr<Uint8List>>
    with $FutureModifier<Uint8List>, $FutureProvider<Uint8List> {
  BrainCameraPhotoBytesProvider._({required BrainCameraPhotoBytesFamily super.from, required String super.argument})
    : super(
        retry: null,
        name: r'brainCameraPhotoBytesProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainCameraPhotoBytesHash();

  @override
  String toString() {
    return r'brainCameraPhotoBytesProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<Uint8List> $createElement($ProviderPointer pointer) => $FutureProviderElement(pointer);

  @override
  FutureOr<Uint8List> create(Ref ref) {
    final argument = this.argument as String;
    return brainCameraPhotoBytes(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainCameraPhotoBytesProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainCameraPhotoBytesHash() => r'68b2b23c570f9230d8c58f9ca9c209c6dca5eaf8';

final class BrainCameraPhotoBytesFamily extends $Family with $FunctionalFamilyOverride<FutureOr<Uint8List>, String> {
  BrainCameraPhotoBytesFamily._()
    : super(
        retry: null,
        name: r'brainCameraPhotoBytesProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  BrainCameraPhotoBytesProvider call(String photoId) => BrainCameraPhotoBytesProvider._(argument: photoId, from: this);

  @override
  String toString() => r'brainCameraPhotoBytesProvider';
}
