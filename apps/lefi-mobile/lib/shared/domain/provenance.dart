/// Where a value comes from (ADR-012). Every reading the UI shows carries one.
enum DataOrigin { live, simulated, offline }

/// Where the whole data set behind the app comes from.
enum DataSourceKind {
  /// Design fixtures bundled in the app — NOT real greenhouse data.
  demo,

  /// The LEFI CROP Brain API on the local network.
  brain,
}
