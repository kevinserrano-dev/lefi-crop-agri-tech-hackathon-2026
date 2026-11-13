import '../../brain/data/brain_auth_repository.dart';
import '../domain/brain_chat.dart';

/// Chat with Lefi AI through Lefi Gateway (ADR-067, 107; `ai.chat`, every role). Lefi Brain answers
/// over read-only tools offered by the person's role; the answer arrives `thinking` and is read again
/// until `done` or `failed`. One question at a time per person (409 `AI_BUSY`).
class BrainChatRepository {
  BrainChatRepository(this.brain);
  final BrainAuthRepository brain;

  Future<ChatStatus> status() async => ChatStatus.fromJson((await brain.api('GET', '/ai/assistant')).json);

  Future<ChatConversation> ask(String message, {String? conversationId}) async => ChatConversation.fromJson(
    (await brain.api('POST', '/ai/chat', body: {'message': message, 'conversation_id': ?conversationId})).json,
  );

  Future<List<ChatConversationSummary>> conversations() async {
    final body = (await brain.api('GET', '/ai/conversations')).body;
    return [
      for (final c in body is List ? body : const [])
        if (c is Map<String, dynamic>) ChatConversationSummary.fromJson(c),
    ];
  }

  Future<ChatConversation> conversation(String id) async =>
      ChatConversation.fromJson((await brain.api('GET', '/ai/conversations/$id')).json);
}
