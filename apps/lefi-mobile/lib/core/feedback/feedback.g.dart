// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'feedback.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Transient bottom toast (design: dark pill above the tab bar, 2.8 s).

@ProviderFor(Toast)
final toastProvider = ToastProvider._();

/// Transient bottom toast (design: dark pill above the tab bar, 2.8 s).
final class ToastProvider extends $NotifierProvider<Toast, ToastMessage?> {
  /// Transient bottom toast (design: dark pill above the tab bar, 2.8 s).
  ToastProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'toastProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$toastHash();

  @$internal
  @override
  Toast create() => Toast();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(ToastMessage? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<ToastMessage?>(value),
    );
  }
}

String _$toastHash() => r'ed979085ac2c991e666aaaf492bf3917099db59e';

/// Transient bottom toast (design: dark pill above the tab bar, 2.8 s).

abstract class _$Toast extends $Notifier<ToastMessage?> {
  ToastMessage? build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<ToastMessage?, ToastMessage?>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<ToastMessage?, ToastMessage?>,
              ToastMessage?,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

/// Blocking "working…" overlay while an operation runs.

@ProviderFor(Busy)
final busyProvider = BusyProvider._();

/// Blocking "working…" overlay while an operation runs.
final class BusyProvider extends $NotifierProvider<Busy, String?> {
  /// Blocking "working…" overlay while an operation runs.
  BusyProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'busyProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$busyHash();

  @$internal
  @override
  Busy create() => Busy();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(String? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<String?>(value),
    );
  }
}

String _$busyHash() => r'20bef1acb0c41f00cc458d2b06ba136acda57c11';

/// Blocking "working…" overlay while an operation runs.

abstract class _$Busy extends $Notifier<String?> {
  String? build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<String?, String?>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<String?, String?>,
              String?,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
