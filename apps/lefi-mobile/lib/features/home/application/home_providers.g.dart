// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'home_providers.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(dashboard)
final dashboardProvider = DashboardProvider._();

final class DashboardProvider
    extends
        $FunctionalProvider<
          AsyncValue<Dashboard>,
          Dashboard,
          FutureOr<Dashboard>
        >
    with $FutureModifier<Dashboard>, $FutureProvider<Dashboard> {
  DashboardProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'dashboardProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$dashboardHash();

  @$internal
  @override
  $FutureProviderElement<Dashboard> $createElement($ProviderPointer pointer) =>
      $FutureProviderElement(pointer);

  @override
  FutureOr<Dashboard> create(Ref ref) {
    return dashboard(ref);
  }
}

String _$dashboardHash() => r'7c1096441f65baf52ad12e62e183ffaac0e6dd58';
