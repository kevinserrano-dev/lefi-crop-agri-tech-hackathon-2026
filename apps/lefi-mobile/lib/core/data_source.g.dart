// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data_source.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Which data source backs the repositories. Only `demo` exists today; the Brain
/// API implementation will be selected here (e.g. from `--dart-define`).

@ProviderFor(dataSource)
final dataSourceProvider = DataSourceProvider._();

/// Which data source backs the repositories. Only `demo` exists today; the Brain
/// API implementation will be selected here (e.g. from `--dart-define`).

final class DataSourceProvider
    extends $FunctionalProvider<DataSourceKind, DataSourceKind, DataSourceKind>
    with $Provider<DataSourceKind> {
  /// Which data source backs the repositories. Only `demo` exists today; the Brain
  /// API implementation will be selected here (e.g. from `--dart-define`).
  DataSourceProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'dataSourceProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$dataSourceHash();

  @$internal
  @override
  $ProviderElement<DataSourceKind> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  DataSourceKind create(Ref ref) {
    return dataSource(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(DataSourceKind value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<DataSourceKind>(value),
    );
  }
}

String _$dataSourceHash() => r'65182a0027d844125f0aaa1d52b5d7d3f7deb891';
