// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'devices_providers.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Lefi Brain's devices when signed in to it with `nav.devices`; null otherwise.

@ProviderFor(brainDevicesRepository)
final brainDevicesRepositoryProvider = BrainDevicesRepositoryProvider._();

/// Lefi Brain's devices when signed in to it with `nav.devices`; null otherwise.

final class BrainDevicesRepositoryProvider
    extends
        $FunctionalProvider<
          BrainDevicesRepository?,
          BrainDevicesRepository?,
          BrainDevicesRepository?
        >
    with $Provider<BrainDevicesRepository?> {
  /// Lefi Brain's devices when signed in to it with `nav.devices`; null otherwise.
  BrainDevicesRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainDevicesRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainDevicesRepositoryHash();

  @$internal
  @override
  $ProviderElement<BrainDevicesRepository?> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  BrainDevicesRepository? create(Ref ref) {
    return brainDevicesRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(BrainDevicesRepository? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<BrainDevicesRepository?>(value),
    );
  }
}

String _$brainDevicesRepositoryHash() =>
    r'd1cacc1ea35de1a30c5abcabca3066d8e7b1478f';

@ProviderFor(fieldDevices)
final fieldDevicesProvider = FieldDevicesProvider._();

final class FieldDevicesProvider
    extends
        $FunctionalProvider<
          AsyncValue<List<FieldDevice>>,
          List<FieldDevice>,
          FutureOr<List<FieldDevice>>
        >
    with
        $FutureModifier<List<FieldDevice>>,
        $FutureProvider<List<FieldDevice>> {
  FieldDevicesProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'fieldDevicesProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$fieldDevicesHash();

  @$internal
  @override
  $FutureProviderElement<List<FieldDevice>> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<List<FieldDevice>> create(Ref ref) {
    return fieldDevices(ref);
  }
}

String _$fieldDevicesHash() => r'0dd11573995e1a8cd66aec7e1cf4cf3cf0451d1d';

@ProviderFor(fieldDevice)
final fieldDeviceProvider = FieldDeviceFamily._();

final class FieldDeviceProvider
    extends
        $FunctionalProvider<
          AsyncValue<FieldDevice>,
          FieldDevice,
          FutureOr<FieldDevice>
        >
    with $FutureModifier<FieldDevice>, $FutureProvider<FieldDevice> {
  FieldDeviceProvider._({
    required FieldDeviceFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'fieldDeviceProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$fieldDeviceHash();

  @override
  String toString() {
    return r'fieldDeviceProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<FieldDevice> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<FieldDevice> create(Ref ref) {
    final argument = this.argument as String;
    return fieldDevice(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is FieldDeviceProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$fieldDeviceHash() => r'b7e55c63075535217355655b3ea25f5cb978bd24';

final class FieldDeviceFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<FieldDevice>, String> {
  FieldDeviceFamily._()
    : super(
        retry: null,
        name: r'fieldDeviceProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  FieldDeviceProvider call(String id) =>
      FieldDeviceProvider._(argument: id, from: this);

  @override
  String toString() => r'fieldDeviceProvider';
}
