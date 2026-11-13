import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../data/brain_chat_repository.dart';
import '../domain/brain_chat.dart';

part 'brain_chat.g.dart';

/// While an answer is `thinking` the conversation is asked again this often.
const brainChatThinkingPoll = Duration(milliseconds: 1500);

/// Lefi AI's state is asked again while the chat is open.
const brainChatStatusPoll = Duration(seconds: 20);

/// Chat with Lefi AI on Lefi Brain (`ai.chat`, every role); null when not on Lefi Brain.
@Riverpod(keepAlive: true)
BrainChatRepository? brainChatRepository(Ref ref) {
  final auth = ref.watch(activeAuthRepositoryProvider);
  ref.watch(sessionProvider);
  if (auth is! BrainAuthRepository || !auth.can('ai.chat')) return null;
  return BrainChatRepository(auth);
}

BrainChatRepository _repo(Ref ref) =>
    ref.watch(brainChatRepositoryProvider) ?? (throw StateError('Not connected to Lefi Brain.'));

@riverpod
Future<ChatStatus> brainChatStatus(Ref ref) async {
  final t = Timer(brainChatStatusPoll, ref.invalidateSelf);
  ref.onDispose(t.cancel);
  return _repo(ref).status();
}

/// This person's conversations with Lefi AI, most recent first.
@riverpod
Future<List<ChatConversationSummary>> brainChatConversations(Ref ref) => _repo(ref).conversations();

@riverpod
Future<ChatConversation> brainChatConversation(Ref ref, String id) async {
  final c = await _repo(ref).conversation(id);
  if (c.thinking) {
    final t = Timer(brainChatThinkingPoll, ref.invalidateSelf);
    ref.onDispose(t.cancel);
  }
  return c;
}
