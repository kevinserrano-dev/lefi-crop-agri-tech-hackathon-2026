import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../feedback/feedback.dart';
import '../theme/lefi_colors.dart';
import '../theme/lefi_text.dart';
import 'buttons.dart';

/// Shows a bottom sheet styled like the design (radius 26, grab handle).
Future<T?> showLefiSheet<T>(BuildContext context, {required WidgetBuilder builder}) => showModalBottomSheet<T>(
  context: context,
  useRootNavigator: true,
  isScrollControlled: true,
  backgroundColor: Colors.white,
  barrierColor: const Color(0x730A1410),
  elevation: 0,
  constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * .84),
  shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(26))),
  builder: (ctx) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(ctx).bottom),
    child: SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(18, 8, 18, 34),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 38,
              height: 5,
              margin: const EdgeInsets.only(bottom: 18),
              decoration: BoxDecoration(color: LefiColors.inputBorder, borderRadius: BorderRadius.circular(3)),
            ),
          ),
          builder(ctx),
        ],
      ),
    ),
  ),
);

/// Confirmation dialog (radius 24, Cancel + coloured confirm).
Future<bool> showLefiConfirm(
  BuildContext context, {
  required String title,
  required String body,
  required String confirmLabel,
  Color confirmColor = LefiColors.brandDark,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    useRootNavigator: true,
    barrierColor: const Color(0x730A1410),
    builder: (ctx) => Dialog(
      backgroundColor: Colors.white,
      insetPadding: const EdgeInsets.all(28),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 22, 20, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: LefiText.outfit(20)),
            const SizedBox(height: 10),
            Text(body, style: LefiText.body(14.5, color: LefiColors.secondary, height: 1.5)),
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: LefiOutlineButton(
                    label: 'Cancel',
                    borderColor: LefiColors.inputBorder,
                    foreground: LefiColors.strong,
                    onPressed: () => Navigator.pop(ctx, false),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 13,
                  child: LefiButton(
                    label: confirmLabel,
                    height: 50,
                    fontSize: 15,
                    background: confirmColor,
                    onPressed: () => Navigator.pop(ctx, true),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
  return ok ?? false;
}

/// App-wide toast + busy overlay, layered above the router.
class FeedbackLayer extends ConsumerWidget {
  const FeedbackLayer({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final toast = ref.watch(toastProvider);
    final busy = ref.watch(busyProvider);
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    return Stack(
      children: [
        child,
        if (busy != null)
          Positioned.fill(
            child: ColoredBox(
              color: const Color(0x8CF7F9F6),
              child: Center(
                child: Container(
                  constraints: const BoxConstraints(minWidth: 150),
                  padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 18),
                  decoration: BoxDecoration(color: LefiColors.ink, borderRadius: BorderRadius.circular(18)),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Symbols.progress_activity_rounded, size: 30, color: LefiColors.brand),
                      const SizedBox(height: 8),
                      Text(busy, style: LefiText.body(14, weight: 700, color: Colors.white)),
                    ],
                  ),
                ),
              ),
            ),
          ),
        if (toast != null)
          Positioned(
            left: 16,
            right: 16,
            bottom: 104 - 34 + bottomInset,
            child: IgnorePointer(
              child: Material(
                color: Colors.transparent,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  decoration: BoxDecoration(
                    color: toast.bad ? LefiColors.toastBad : LefiColors.ink,
                    borderRadius: BorderRadius.circular(14),
                    boxShadow: const [BoxShadow(color: Color(0x40000000), blurRadius: 28, offset: Offset(0, 10))],
                  ),
                  child: Text(toast.text, style: LefiText.body(14, color: Colors.white, height: 1.4)),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
