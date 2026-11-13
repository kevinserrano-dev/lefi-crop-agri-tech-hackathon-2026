// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'inspection_form.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(InspectionForm)
final inspectionFormProvider = InspectionFormFamily._();

final class InspectionFormProvider
    extends $NotifierProvider<InspectionForm, InspectionDraft> {
  InspectionFormProvider._({
    required InspectionFormFamily super.from,
    required String? super.argument,
  }) : super(
         retry: null,
         name: r'inspectionFormProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$inspectionFormHash();

  @override
  String toString() {
    return r'inspectionFormProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  InspectionForm create() => InspectionForm();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(InspectionDraft value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<InspectionDraft>(value),
    );
  }

  @override
  bool operator ==(Object other) {
    return other is InspectionFormProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$inspectionFormHash() => r'2247fc0b1c773ad3cbb55561ca0001667ea8ecf6';

final class InspectionFormFamily extends $Family
    with
        $ClassFamilyOverride<
          InspectionForm,
          InspectionDraft,
          InspectionDraft,
          InspectionDraft,
          String?
        > {
  InspectionFormFamily._()
    : super(
        retry: null,
        name: r'inspectionFormProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  InspectionFormProvider call(String? initialPlantId) =>
      InspectionFormProvider._(argument: initialPlantId, from: this);

  @override
  String toString() => r'inspectionFormProvider';
}

abstract class _$InspectionForm extends $Notifier<InspectionDraft> {
  late final _$args = ref.$arg as String?;
  String? get initialPlantId => _$args;

  InspectionDraft build(String? initialPlantId);
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<InspectionDraft, InspectionDraft>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<InspectionDraft, InspectionDraft>,
              InspectionDraft,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, () => build(_$args));
  }
}
