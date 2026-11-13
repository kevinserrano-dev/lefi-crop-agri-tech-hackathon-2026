// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'brain_alerts.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Lefi Brain's alerts when signed in to it with `nav.alerts`; null on demo data or without it.

@ProviderFor(brainAlertRepository)
final brainAlertRepositoryProvider = BrainAlertRepositoryProvider._();

/// Lefi Brain's alerts when signed in to it with `nav.alerts`; null on demo data or without it.

final class BrainAlertRepositoryProvider
    extends
        $FunctionalProvider<
          BrainAlertRepository?,
          BrainAlertRepository?,
          BrainAlertRepository?
        >
    with $Provider<BrainAlertRepository?> {
  /// Lefi Brain's alerts when signed in to it with `nav.alerts`; null on demo data or without it.
  BrainAlertRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainAlertRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainAlertRepositoryHash();

  @$internal
  @override
  $ProviderElement<BrainAlertRepository?> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  BrainAlertRepository? create(Ref ref) {
    return brainAlertRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(BrainAlertRepository? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<BrainAlertRepository?>(value),
    );
  }
}

String _$brainAlertRepositoryHash() =>
    r'e3b9afc78a14e1b6dd38cc6d1777994f1ecf594a';

/// Lefi Brain, when the signed-in person may report an issue (`incident.report`: every role).

@ProviderFor(brainReporter)
final brainReporterProvider = BrainReporterProvider._();

/// Lefi Brain, when the signed-in person may report an issue (`incident.report`: every role).

final class BrainReporterProvider
    extends
        $FunctionalProvider<
          BrainAuthRepository?,
          BrainAuthRepository?,
          BrainAuthRepository?
        >
    with $Provider<BrainAuthRepository?> {
  /// Lefi Brain, when the signed-in person may report an issue (`incident.report`: every role).
  BrainReporterProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainReporterProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainReporterHash();

  @$internal
  @override
  $ProviderElement<BrainAuthRepository?> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  BrainAuthRepository? create(Ref ref) {
    return brainReporter(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(BrainAuthRepository? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<BrainAuthRepository?>(value),
    );
  }
}

String _$brainReporterHash() => r'fa1acf576565b222cf7ef970fc260ff0425481ef';

/// [status]: active · resolved · all

@ProviderFor(brainAlerts)
final brainAlertsProvider = BrainAlertsFamily._();

/// [status]: active · resolved · all

final class BrainAlertsProvider
    extends
        $FunctionalProvider<
          AsyncValue<BrainAlertList>,
          BrainAlertList,
          FutureOr<BrainAlertList>
        >
    with $FutureModifier<BrainAlertList>, $FutureProvider<BrainAlertList> {
  /// [status]: active · resolved · all
  BrainAlertsProvider._({
    required BrainAlertsFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'brainAlertsProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$brainAlertsHash();

  @override
  String toString() {
    return r'brainAlertsProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<BrainAlertList> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<BrainAlertList> create(Ref ref) {
    final argument = this.argument as String;
    return brainAlerts(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainAlertsProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainAlertsHash() => r'4d2dac4494b4df8ca745a97d6afe751cc3da64fa';

/// [status]: active · resolved · all

final class BrainAlertsFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<BrainAlertList>, String> {
  BrainAlertsFamily._()
    : super(
        retry: null,
        name: r'brainAlertsProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// [status]: active · resolved · all

  BrainAlertsProvider call(String status) =>
      BrainAlertsProvider._(argument: status, from: this);

  @override
  String toString() => r'brainAlertsProvider';
}

@ProviderFor(brainAlertDetail)
final brainAlertDetailProvider = BrainAlertDetailFamily._();

final class BrainAlertDetailProvider
    extends
        $FunctionalProvider<
          AsyncValue<BrainAlert>,
          BrainAlert,
          FutureOr<BrainAlert>
        >
    with $FutureModifier<BrainAlert>, $FutureProvider<BrainAlert> {
  BrainAlertDetailProvider._({
    required BrainAlertDetailFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'brainAlertDetailProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$brainAlertDetailHash();

  @override
  String toString() {
    return r'brainAlertDetailProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<BrainAlert> $createElement($ProviderPointer pointer) =>
      $FutureProviderElement(pointer);

  @override
  FutureOr<BrainAlert> create(Ref ref) {
    final argument = this.argument as String;
    return brainAlertDetail(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainAlertDetailProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainAlertDetailHash() => r'3f79128cd95d94b7a71feb192415de347079b73e';

final class BrainAlertDetailFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<BrainAlert>, String> {
  BrainAlertDetailFamily._()
    : super(
        retry: null,
        name: r'brainAlertDetailProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  BrainAlertDetailProvider call(String id) =>
      BrainAlertDetailProvider._(argument: id, from: this);

  @override
  String toString() => r'brainAlertDetailProvider';
}
