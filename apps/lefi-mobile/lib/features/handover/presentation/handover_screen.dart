import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../core/feedback/feedback.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/glyph_icons.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/widgets/selectors.dart';
import '../../home/domain/dashboard.dart';
import '../application/brain_handover.dart';
import '../application/handover_controller.dart';
import 'brain_handover_screen.dart';

class HandoverScreen extends ConsumerStatefulWidget {
  const HandoverScreen({super.key});

  @override
  ConsumerState<HandoverScreen> createState() => _HandoverScreenState();
}

class _HandoverScreenState extends ConsumerState<HandoverScreen> {
  bool _read = false;

  @override
  Widget build(BuildContext context) {
    if (ref.watch(brainHandoverRepositoryProvider) != null) return const BrainHandoverScreen();
    final ho = ref.watch(currentHandoverProvider);
    final ack = ref.watch(handoverAckProvider);
    final toast = ref.read(toastProvider.notifier);

    return PushedScreen(
      title: 'Shift handover',
      backLabel: 'Back',
      bottom: StickyActionBar(
        children: ack != null
            ? [DoneBanner(label: ack, icon: Symbols.verified_rounded)]
            : [
                InkWell(
                  onTap: () => setState(() => _read = !_read),
                  child: SizedBox(
                    height: 44,
                    child: Row(
                      children: [
                        CheckSquare(checked: _read),
                        const SizedBox(width: 12),
                        Text('I have read this handover', style: LefiText.body(14, weight: 600)),
                      ],
                    ),
                  ),
                ),
                LefiButton(
                  label: 'Read and acknowledge',
                  opacity: _read ? 1 : .45,
                  onPressed: () async {
                    if (!_read) return toast.show('Confirm you have read the handover first.', bad: true);
                    await ref
                        .read(busyProvider.notifier)
                        .run('Acknowledging…', ref.read(handoverAckProvider.notifier).acknowledge);
                    toast.show('Handover acknowledged. Owen MacLeod has been notified.');
                  },
                ),
              ],
      ),
      body: AsyncView(
        ho,
        data: (h) => ScrollBody(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
          children: [
            LefiCard(
              child: Row(
                children: [
                  Expanded(child: _end('FROM', h.fromShift, h.fromPerson, CrossAxisAlignment.start)),
                  const Icon(Symbols.arrow_forward_rounded, size: 24, color: LefiColors.faint),
                  const SizedBox(width: 10),
                  Expanded(child: _end('TO', h.toShift, 'Current shift', CrossAxisAlignment.end)),
                ],
              ),
            ),
            LefiCard(
              radius: 20,
              padding: const EdgeInsets.all(16),
              borderColor: const Color(0xFFD6E9DC),
              gradient: const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0xFFEAF6EF), Colors.white],
                stops: [0, .8],
              ),
              child: Gap(
                children: [
                  Row(
                    children: [
                      Image.asset('assets/brand/mascot-thinking.png', width: 64, semanticLabel: 'Lefi'),
                      const SizedBox(width: 12),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Lefi’s summary', style: LefiText.outfit(18)),
                          const SizedBox(height: 4),
                          ToneChip(
                            'AI-GENERATED · ${h.summaryTime}',
                            fontSize: 10.5,
                            background: const Color(0xFFDFF0E5),
                            foreground: LefiColors.leaf,
                            radius: 6,
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          ),
                        ],
                      ),
                    ],
                  ),
                  Text(h.summary, style: LefiText.body(14.5, color: LefiColors.body, height: 1.55)),
                ],
              ),
            ),
            for (final s in h.sections)
              LefiCard(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Row(
                        children: [
                          Icon(glyphIcon(s.glyph), size: 20, color: LefiColors.leaf),
                          const SizedBox(width: 8),
                          Text(s.title, style: LefiText.outfit(16)),
                        ],
                      ),
                    ),
                    for (final it in s.items)
                      Container(
                        padding: const EdgeInsets.symmetric(vertical: 9),
                        decoration: const BoxDecoration(
                          border: Border(top: BorderSide(color: LefiColors.divider)),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              width: 8,
                              height: 8,
                              margin: const EdgeInsets.only(top: 6),
                              decoration: BoxDecoration(
                                color: it.severity == Severity.ai
                                    ? const Color(0xFF8A6CD0)
                                    : severityTone(it.severity).dot,
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(child: Text(it.text, style: LefiText.body(13.5, height: 1.45))),
                            const SizedBox(width: 10),
                            Text(it.meta, style: LefiText.body(11.5, color: LefiColors.subtle)),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            LefiCard(
              color: LefiColors.amberWash,
              borderColor: LefiColors.amberBorder,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Row(
                      children: [
                        const Icon(Symbols.tips_and_updates_rounded, size: 20, color: Color(0xFF8A5A00)),
                        const SizedBox(width: 8),
                        Text('Recommendations for this shift', style: LefiText.outfit(16, color: LefiColors.amberDeep)),
                      ],
                    ),
                  ),
                  for (final r in h.recommendations)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 5),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Symbols.arrow_right_rounded, size: 17, color: Color(0xFFE0A21B)),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(r, style: LefiText.body(13.5, color: LefiColors.amberInk, height: 1.45)),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _end(String k, String shift, String who, CrossAxisAlignment a) => Column(
    crossAxisAlignment: a,
    children: [
      Text(k, style: LefiText.body(11.5, weight: 700, color: LefiColors.subtle)),
      const SizedBox(height: 1),
      Text(shift, style: LefiText.body(14, weight: 700)),
      Text(who, style: LefiText.body(12, color: LefiColors.subtle)),
    ],
  );
}
