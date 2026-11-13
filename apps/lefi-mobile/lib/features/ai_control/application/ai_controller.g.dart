// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_controller.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(AiController)
final aiControllerProvider = AiControllerProvider._();

final class AiControllerProvider
    extends $AsyncNotifierProvider<AiController, AiStatus> {
  AiControllerProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'aiControllerProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$aiControllerHash();

  @$internal
  @override
  AiController create() => AiController();
}

String _$aiControllerHash() => r'1c7b230588a34e5b73fdbdc99997db2f3d83c1c5';

abstract class _$AiController extends $AsyncNotifier<AiStatus> {
  FutureOr<AiStatus> build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<AsyncValue<AiStatus>, AiStatus>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<AsyncValue<AiStatus>, AiStatus>,
              AsyncValue<AiStatus>,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
