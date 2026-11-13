/// Design-review switches (demo builds only). Read from `--dart-define` or, on
/// the web preview, from the page query string: `?role=supervisor&platform=ios`.
abstract final class ReviewFlags {
  static String? _q(String key) {
    final v = Uri.base.queryParameters[key];
    return (v == null || v.isEmpty) ? null : v;
  }

  static String? get role {
    const d = String.fromEnvironment('LEFI_DEMO_ROLE');
    return d.isNotEmpty ? d : _q('role');
  }

  static String? get platform {
    const d = String.fromEnvironment('LEFI_PLATFORM');
    return d.isNotEmpty ? d : _q('platform');
  }
}
