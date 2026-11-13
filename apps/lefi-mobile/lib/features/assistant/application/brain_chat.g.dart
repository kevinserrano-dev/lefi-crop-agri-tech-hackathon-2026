// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'brain_chat.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Chat with Lefi AI on Lefi Brain (`ai.chat`, every role); null when not on Lefi Brain.

@ProviderFor(brainChatRepository)
final brainChatRepositoryProvider = BrainChatRepositoryProvider._();

/// Chat with Lefi AI on Lefi Brain (`ai.chat`, every role); null when not on Lefi Brain.

final class BrainChatRepositoryProvider
    extends
        $FunctionalProvider<
          BrainChatRepository?,
          BrainChatRepository?,
          BrainChatRepository?
        >
    with $Provider<BrainChatRepository?> {
  /// Chat with Lefi AI on Lefi Brain (`ai.chat`, every role); null when not on Lefi Brain.
  BrainChatRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainChatRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainChatRepositoryHash();

  @$internal
  @override
  $ProviderElement<BrainChatRepository?> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  BrainChatRepository? create(Ref ref) {
    return brainChatRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(BrainChatRepository? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<BrainChatRepository?>(value),
    );
  }
}

String _$brainChatRepositoryHash() =>
    r'ec2937974ddf0e0c4e15f4c0703542fe53b987ce';

@ProviderFor(brainChatStatus)
final brainChatStatusProvider = BrainChatStatusProvider._();

final class BrainChatStatusProvider
    extends
        $FunctionalProvider<
          AsyncValue<ChatStatus>,
          ChatStatus,
          FutureOr<ChatStatus>
        >
    with $FutureModifier<ChatStatus>, $FutureProvider<ChatStatus> {
  BrainChatStatusProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainChatStatusProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainChatStatusHash();

  @$internal
  @override
  $FutureProviderElement<ChatStatus> $createElement($ProviderPointer pointer) =>
      $FutureProviderElement(pointer);

  @override
  FutureOr<ChatStatus> create(Ref ref) {
    return brainChatStatus(ref);
  }
}

String _$brainChatStatusHash() => r'd73a9cd8d072b2607c0ebbb61ecbb51e8006259d';

/// This person's conversations with Lefi AI, most recent first.

@ProviderFor(brainChatConversations)
final brainChatConversationsProvider = BrainChatConversationsProvider._();

/// This person's conversations with Lefi AI, most recent first.

final class BrainChatConversationsProvider
    extends
        $FunctionalProvider<
          AsyncValue<List<ChatConversationSummary>>,
          List<ChatConversationSummary>,
          FutureOr<List<ChatConversationSummary>>
        >
    with
        $FutureModifier<List<ChatConversationSummary>>,
        $FutureProvider<List<ChatConversationSummary>> {
  /// This person's conversations with Lefi AI, most recent first.
  BrainChatConversationsProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'brainChatConversationsProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$brainChatConversationsHash();

  @$internal
  @override
  $FutureProviderElement<List<ChatConversationSummary>> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<List<ChatConversationSummary>> create(Ref ref) {
    return brainChatConversations(ref);
  }
}

String _$brainChatConversationsHash() =>
    r'c14255418e85d1fad00acc1f9f6d84dd7c61bb55';

@ProviderFor(brainChatConversation)
final brainChatConversationProvider = BrainChatConversationFamily._();

final class BrainChatConversationProvider
    extends
        $FunctionalProvider<
          AsyncValue<ChatConversation>,
          ChatConversation,
          FutureOr<ChatConversation>
        >
    with $FutureModifier<ChatConversation>, $FutureProvider<ChatConversation> {
  BrainChatConversationProvider._({
    required BrainChatConversationFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'brainChatConversationProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$brainChatConversationHash();

  @override
  String toString() {
    return r'brainChatConversationProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<ChatConversation> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<ChatConversation> create(Ref ref) {
    final argument = this.argument as String;
    return brainChatConversation(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is BrainChatConversationProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$brainChatConversationHash() =>
    r'6c3d16c9bd81721df119d4b31f8d4ab74579fda9';

final class BrainChatConversationFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<ChatConversation>, String> {
  BrainChatConversationFamily._()
    : super(
        retry: null,
        name: r'brainChatConversationProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  BrainChatConversationProvider call(String id) =>
      BrainChatConversationProvider._(argument: id, from: this);

  @override
  String toString() => r'brainChatConversationProvider';
}
