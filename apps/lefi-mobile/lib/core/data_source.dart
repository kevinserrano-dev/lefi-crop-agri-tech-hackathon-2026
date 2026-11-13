import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../shared/domain/provenance.dart';

part 'data_source.g.dart';

/// Which data source backs the repositories. Only `demo` exists today; the Brain
/// API implementation will be selected here (e.g. from `--dart-define`).
@Riverpod(keepAlive: true)
DataSourceKind dataSource(Ref ref) => DataSourceKind.demo;
