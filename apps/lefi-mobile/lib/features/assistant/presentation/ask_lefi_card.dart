import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/router/routes.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/primitives.dart';
import '../../ai_control/application/brain_ai_control.dart';
import '../application/brain_chat.dart';

/// "Ask Lefi" on Home when signed in to Lefi Brain (`ai.chat`); opens the chat. Says when Lefi AI
/// cannot answer instead of hiding.
class AskLefiCard extends ConsumerWidget {
  const AskLefiCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(brainChatRepositoryProvider) == null) return const SizedBox.shrink();
    final s = ref.watch(brainAiStateProvider).value;
    final on = s?.available ?? false;
    return LefiCard(
      onTap: context.pushChat,
      color: Tone.ai.bg,
      borderColor: Tone.ai.dot.withValues(alpha: .4),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      child: Row(
        children: [
          Image.asset(on ? 'assets/brand/mascot-wink.png' : 'assets/brand/mascot-sleeping.png', width: 42),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Ask Lefi', style: LefiText.outfit(16, color: Tone.ai.fg)),
                const SizedBox(height: 2),
                Text(
                  on
                      ? 'Questions about zones, crops, plants and readings · answers from Lefi Brain’s data'
                      : 'Lefi AI cannot answer now · your earlier conversations are kept',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: LefiText.body(12.5, color: LefiColors.secondary, height: 1.35),
                ),
              ],
            ),
          ),
          Icon(Symbols.chat_rounded, color: Tone.ai.fg),
        ],
      ),
    );
  }
}
