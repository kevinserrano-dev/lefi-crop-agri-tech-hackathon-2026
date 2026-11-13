import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../core/feedback/feedback.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../brain/data/brain_json.dart';
import '../../camera/application/brain_cameras.dart';
import '../../tasks/presentation/brain_task_sheets.dart' show brainError;
import '../application/brain_chat.dart';
import '../domain/brain_chat.dart';

/// Chat with Lefi AI on Lefi Brain (ADR-067, 107). Lefi answers only from what Lefi Brain reads for this
/// person's role; every answer is labelled as AI with its model and what it read.
class BrainChatScreen extends ConsumerStatefulWidget {
  const BrainChatScreen({super.key});

  @override
  ConsumerState<BrainChatScreen> createState() => _BrainChatScreenState();
}

class _BrainChatScreenState extends ConsumerState<BrainChatScreen> {
  final _ctl = TextEditingController();
  final _scroll = ScrollController();
  String? _conversationId;
  bool _sending = false;

  /// Messages shown (and whether the last is thinking): scrolls to the end when it changes.
  int _shownKey = -1;

  @override
  void dispose() {
    _ctl.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _toEnd() => WidgetsBinding.instance.addPostFrameCallback((_) {
    if (_scroll.hasClients) {
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    }
  });

  Future<void> _send() async {
    final repo = ref.read(brainChatRepositoryProvider);
    final text = _ctl.text.trim();
    if (repo == null || text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final c = await repo.ask(text, conversationId: _conversationId);
      _ctl.clear();
      setState(() => _conversationId = c.id);
      ref.invalidate(brainChatConversationProvider(c.id));
      ref.invalidate(brainChatConversationsProvider);
      _toEnd();
    } on Object catch (e) {
      ref.read(toastProvider.notifier).show(brainError(e), bad: true);
      ref.invalidate(brainChatStatusProvider);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (ref.watch(brainChatRepositoryProvider) == null) {
      return const PushedScreen(
        title: 'Ask Lefi',
        backLabel: 'Back',
        body: ScrollBody(
          children: [
            InfoNote(text: 'Lefi AI’s chat is for people signed in to Lefi Brain.', icon: Symbols.lock_rounded),
          ],
        ),
      );
    }
    final status = ref.watch(brainChatStatusProvider);
    final s = status.value;
    final id = _conversationId;
    final conv = id == null ? null : ref.watch(brainChatConversationProvider(id));
    final shown = conv?.value?.messages;
    final key = shown == null ? 0 : shown.length * 2 + (shown.lastOrNull?.thinking == true ? 1 : 0);
    if (key != _shownKey) {
      _shownKey = key;
      _toEnd();
    }
    final thinking = conv?.value?.thinking ?? false;
    final canAsk = s?.available == true && !thinking && !_sending;

    return PushedScreen(
      title: 'Ask Lefi',
      backLabel: 'Back',
      bottom: s?.available == true
          ? _Composer(
              controller: _ctl,
              enabled: canAsk,
              hint: thinking || _sending ? 'Lefi is answering…' : 'Ask Lefi…',
              onSend: _send,
              onChanged: () => setState(() {}),
            )
          : null,
      body: ListView(
        controller: _scroll,
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
        children: [
          _Head(
            status: s,
            loading: status.isLoading && s == null,
            error: status.hasError ? brainError(status.error!) : null,
            onNew: id == null || thinking ? null : () => setState(() => _conversationId = null),
          ),
          const SizedBox(height: 12),
          if (id == null) ...[
            if (s != null) _Hint(s),
            const SizedBox(height: 14),
            _Earlier(onOpen: (c) => setState(() => _conversationId = c)),
          ] else
            switch (conv!) {
              AsyncData(:final value) => Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final m in value.messages) ...[_Bubble(m), const SizedBox(height: 10)],
                ],
              ),
              AsyncError(:final error) => InfoNote(text: brainError(error), icon: Symbols.error_rounded),
              _ => const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
              ),
            },
        ],
      ),
    );
  }
}

class _Head extends StatelessWidget {
  const _Head({required this.status, required this.loading, this.error, this.onNew});
  final ChatStatus? status;
  final bool loading;
  final String? error;
  final VoidCallback? onNew;

  @override
  Widget build(BuildContext context) {
    final s = status;
    final on = s?.available == true;
    final mood = loading
        ? 'Loading…'
        : s == null
        ? (error ?? 'Lefi AI’s state could not be read')
        : s.killSwitch
        ? 'Stopped · ${s.reason.isEmpty ? 'emergency stop' : s.reason}'
        : on
        ? 'Available${s.model == null ? '' : ' · ${s.model}'}'
        : 'AI reasoning unavailable${s.reason.isEmpty ? '' : ': ${s.reason}'}';
    return LefiCard(
      padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
      child: Row(
        children: [
          Image.asset(on ? 'assets/brand/mascot-wink.png' : 'assets/brand/mascot-sleeping.png', width: 46),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Lefi · AI assistant', style: LefiText.outfit(16)),
                const SizedBox(height: 2),
                Row(
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(color: on ? Tone.ok.dot : Tone.off.dot, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        mood,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: LefiText.body(12.5, color: LefiColors.muted),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (onNew != null)
            IconButton(
              onPressed: onNew,
              tooltip: 'New conversation',
              icon: const Icon(Symbols.add_comment_rounded, color: LefiColors.brandDark),
            ),
        ],
      ),
    );
  }
}

class _Hint extends StatelessWidget {
  const _Hint(this.s);
  final ChatStatus s;

  @override
  Widget build(BuildContext context) {
    if (!s.available) {
      return const InfoNote(
        text: 'Monitoring, rules and alerts keep running without Lefi AI.',
        icon: Symbols.info_rounded,
      );
    }
    final camera = s.has('camera_photo') || s.has('camera_control');
    return Gap(
      gap: 8,
      children: [
        Text(
          'Ask about your greenhouse: zones, crops, plants, sensor readings'
          '${s.has('field_devices') ? ', devices' : ''}${s.has('cameras') ? ', cameras' : ''}.',
          style: LefiText.body(14, color: LefiColors.strong, height: 1.45),
        ),
        Text(
          camera
              ? 'Lefi only reads what your role can see; the only things it can do are take photos and aim the '
                    'cameras a person allowed.'
              : 'Lefi only reads what your role can see and cannot change anything.',
          style: LefiText.body(12.5, color: LefiColors.muted, height: 1.45),
        ),
        if (s.tools.isNotEmpty)
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [for (final t in s.tools) ToneChip(t.label, tone: Tone.ai, fontSize: 11)],
          ),
      ],
    );
  }
}

class _Earlier extends ConsumerWidget {
  const _Earlier({required this.onOpen});
  final ValueChanged<String> onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(brainChatConversationsProvider).value ?? const [];
    if (list.isEmpty) return const SizedBox.shrink();
    return Gap(
      gap: 8,
      children: [
        const SectionTitle('Earlier conversations', size: 15),
        LefiCard(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Column(
            children: [
              for (final c in list.take(10))
                ListTile(
                  dense: true,
                  leading: const Icon(Symbols.chat_rounded, color: LefiColors.leaf, size: 20),
                  title: Text(
                    c.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: LefiText.body(14, weight: 600),
                  ),
                  subtitle: Text(brainWhen(c.updatedAt), style: LefiText.body(12, color: LefiColors.muted)),
                  trailing: const Icon(Symbols.chevron_right_rounded, color: LefiColors.chevron),
                  onTap: () => onOpen(c.id),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Bubble extends ConsumerWidget {
  const _Bubble(this.m);
  final ChatMessage m;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (m.fromPerson) {
      return Align(
        alignment: Alignment.centerRight,
        child: Container(
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * .8),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: LefiColors.brandDark,
            borderRadius: BorderRadius.circular(16).copyWith(bottomRight: const Radius.circular(4)),
          ),
          child: Text(m.content, style: LefiText.body(14.5, color: Colors.white, height: 1.4)),
        ),
      );
    }
    final ai = Tone.ai;
    final canPhotos = ref.watch(brainCameraRepositoryProvider) != null;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: BoxDecoration(
        color: ai.bg,
        borderRadius: BorderRadius.circular(16).copyWith(bottomLeft: const Radius.circular(4)),
        border: Border.all(color: ai.dot.withValues(alpha: .35)),
      ),
      child: Gap(
        gap: 8,
        children: [
          if (m.thinking)
            Row(
              children: [
                SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: ai.fg)),
                const SizedBox(width: 8),
                Text('Lefi is reading the data…', style: LefiText.body(13.5, color: ai.fg)),
              ],
            )
          else if (m.state == 'failed')
            Text(m.error ?? 'Lefi AI could not answer.', style: LefiText.body(14, color: Tone.crit.fg, height: 1.4))
          else
            _AnswerText(m.content),
          for (final id in m.photoIds)
            canPhotos
                ? _ChatPhoto(id)
                : Text('Lefi AI took a photo · open it in Lefi Desktop', style: LefiText.body(12.5, color: ai.fg)),
          if (m.movedCamera)
            Text(
              'Lefi moved a camera for you · see Lefi Desktop → Devices & Health → the camera → Commands sent',
              style: LefiText.body(12, color: ai.fg, height: 1.4),
            ),
          if (!m.thinking)
            Text(
              [
                'AI answer${m.model == null ? '' : ' · ${m.model}'}',
                if (m.read.isNotEmpty) 'read: ${m.read.join(', ')}',
                if (m.denied.isNotEmpty) 'not allowed for your role: ${m.denied.join(', ')}',
              ].join(' · '),
              style: LefiText.body(11.5, color: LefiColors.subtle, height: 1.35),
            ),
        ],
      ),
    );
  }
}

class _AnswerText extends StatelessWidget {
  const _AnswerText(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    final base = LefiText.body(14.5, color: LefiColors.body, height: 1.45);
    TextSpan spans(List<ChatSpan> s) => TextSpan(
      style: base,
      children: [
        for (final p in s)
          TextSpan(
            text: p.text,
            style: p.bold ? const TextStyle(fontWeight: FontWeight.w700) : null,
          ),
      ],
    );
    return SelectionArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final l in chatLines(text))
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: l.bullet
                  ? Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(width: 18, child: Text(l.marker, style: base)),
                        Expanded(child: Text.rich(spans(l.spans))),
                      ],
                    )
                  : Text.rich(spans(l.spans)),
            ),
        ],
      ),
    );
  }
}

/// A photo Lefi AI took for the answer, as Lefi Brain stored it (never described by the AI here).
class _ChatPhoto extends ConsumerWidget {
  const _ChatPhoto(this.id);
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) => ClipRRect(
    borderRadius: BorderRadius.circular(12),
    child: AspectRatio(
      aspectRatio: 16 / 9,
      child: switch (ref.watch(brainCameraPhotoBytesProvider(id))) {
        AsyncData(:final value) => Image.memory(value, fit: BoxFit.cover),
        AsyncError(:final error) => ColoredBox(
          color: LefiColors.surfaceNeutral,
          child: Center(
            child: Text(brainError(error), style: LefiText.body(12, color: LefiColors.muted)),
          ),
        ),
        _ => const ColoredBox(color: LefiColors.skeleton),
      },
    ),
  );
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.enabled,
    required this.hint,
    required this.onSend,
    required this.onChanged,
  });
  final TextEditingController controller;
  final bool enabled;
  final String hint;
  final VoidCallback onSend;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final ready = enabled && controller.text.trim().isNotEmpty;
    return Container(
      padding: EdgeInsets.fromLTRB(12, 8, 8, 10 + MediaQuery.paddingOf(context).bottom),
      decoration: const BoxDecoration(
        color: Color(0xF5F7F9F6),
        border: Border(top: BorderSide(color: LefiColors.hairline)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: TextField(
              controller: controller,
              enabled: enabled,
              minLines: 1,
              maxLines: 5,
              maxLength: chatMaxChars,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) => onChanged(),
              style: LefiText.body(15),
              decoration: InputDecoration(
                hintText: hint,
                counterText: '',
                filled: true,
                fillColor: Colors.white,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(18),
                  borderSide: const BorderSide(color: LefiColors.inputBorder),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(18),
                  borderSide: const BorderSide(color: LefiColors.inputBorder),
                ),
              ),
            ),
          ),
          const SizedBox(width: 6),
          IconButton.filled(
            onPressed: ready ? onSend : null,
            tooltip: 'Send',
            style: IconButton.styleFrom(backgroundColor: LefiColors.brandDark, minimumSize: const Size(46, 46)),
            icon: const Icon(Symbols.send_rounded, color: Colors.white),
          ),
        ],
      ),
    );
  }
}
