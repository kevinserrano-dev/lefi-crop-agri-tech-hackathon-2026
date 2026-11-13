// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'brain_profile.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(brainProfileRepository)
final brainProfileRepositoryProvider = BrainProfileRepositoryProvider._();

final class BrainProfileRepositoryProvider
    extends
        $FunctionalProvider<
          BrainProfileRepository?,
          BrainProfileRepository?,
          BrainProfileRepository?
        >
    with $Provider<BrainProfileRepository?> {
  BrainProfileRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainProfileRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainProfileRepositoryHash();

  @$internal
  @override
  $ProviderElement<BrainProfileRepository?> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  BrainProfileRepository? create(Ref ref) {
    return brainProfileRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(BrainProfileRepository? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<BrainProfileRepository?>(value),
    );
  }
}

String _$brainProfileRepositoryHash() =>
    r'8c7c09f226b0216700cd52ea5f0e049b2fac3f58';

@ProviderFor(myShifts)
final myShiftsProvider = MyShiftsProvider._();

final class MyShiftsProvider
    extends
        $FunctionalProvider<
          AsyncValue<MyShifts?>,
          MyShifts?,
          FutureOr<MyShifts?>
        >
    with $FutureModifier<MyShifts?>, $FutureProvider<MyShifts?> {
  MyShiftsProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'myShiftsProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$myShiftsHash();

  @$internal
  @override
  $FutureProviderElement<MyShifts?> $createElement($ProviderPointer pointer) =>
      $FutureProviderElement(pointer);

  @override
  FutureOr<MyShifts?> create(Ref ref) {
    return myShifts(ref);
  }
}

String _$myShiftsHash() => r'c962d6f9a1b026aec137c4f76728dbf876270d45';

@ProviderFor(notificationLevel)
final notificationLevelProvider = NotificationLevelProvider._();

final class NotificationLevelProvider
    extends $FunctionalProvider<AsyncValue<String>, String, FutureOr<String>>
    with $FutureModifier<String>, $FutureProvider<String> {
  NotificationLevelProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'notificationLevelProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$notificationLevelHash();

  @$internal
  @override
  $FutureProviderElement<String> $createElement($ProviderPointer pointer) =>
      $FutureProviderElement(pointer);

  @override
  FutureOr<String> create(Ref ref) {
    return notificationLevel(ref);
  }
}

String _$notificationLevelHash() => r'd2a954bae7736ac6dfc31b6344d63907cb4e74d1';
