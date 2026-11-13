import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../platform/platform_style.dart';
import '../theme/lefi_colors.dart';
import '../theme/lefi_text.dart';

const _statusBarDark = SystemUiOverlayStyle(
  statusBarColor: Colors.transparent,
  statusBarIconBrightness: Brightness.dark,
  statusBarBrightness: Brightness.light,
);

/// Root tab screen: large title header + scrolling content.
class RootScreen extends StatelessWidget {
  const RootScreen({
    super.key,
    required this.title,
    required this.subtitle,
    required this.children,
    this.action,
    this.top,
    this.onRefresh,
  });

  final String title;
  final String subtitle;
  final List<Widget> children;
  final Widget? action;

  /// Widget shown above the header (e.g. the AI-offline bar).
  final Widget? top;

  /// Pull to refresh (screens backed by Lefi Brain).
  final Future<void> Function()? onRefresh;

  @override
  Widget build(BuildContext context) => AnnotatedRegion(
    value: _statusBarDark,
    child: ColoredBox(
      color: LefiColors.screen,
      child: SafeArea(
        bottom: false,
        child: _refreshable(
          ListView(
            physics: onRefresh == null ? null : const AlwaysScrollableScrollPhysics(),
            padding: EdgeInsets.zero,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 6, 18, 12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(title, style: LefiText.outfit(30, weight: 700, letterSpacing: -0.3)),
                          const SizedBox(height: 2),
                          Text(subtitle, style: LefiText.body(13, color: LefiColors.muted)),
                        ],
                      ),
                    ),
                    ?action,
                  ],
                ),
              ),
              ?top,
              ...children,
            ],
          ),
        ),
      ),
    ),
  );

  Widget _refreshable(Widget list) =>
      onRefresh == null ? list : RefreshIndicator(color: LefiColors.brandDark, onRefresh: onRefresh!, child: list);
}

/// Pushed screen with the platform-specific navigation bar and an optional
/// sticky bottom action bar.
class PushedScreen extends StatelessWidget {
  const PushedScreen({
    super.key,
    required this.title,
    required this.backLabel,
    required this.body,
    this.bottom,
    this.onBack,
  });

  final String title;
  final String backLabel;
  final Widget body;
  final Widget? bottom;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final ios = context.isCupertino;
    final back = onBack ?? () => context.canPop() ? context.pop() : null;
    return AnnotatedRegion(
      value: _statusBarDark,
      child: ColoredBox(
        color: LefiColors.screen,
        child: SafeArea(
          bottom: false,
          child: Column(
            children: [
              ClipRect(
                child: BackdropFilter(
                  filter: ui.ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                  child: Container(
                    height: 52,
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    decoration: const BoxDecoration(
                      color: Color(0xF2F7F9F6),
                      border: Border(bottom: BorderSide(color: LefiColors.hairline)),
                    ),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 104,
                          // The label may overflow the 104 px slot, as in the design.
                          child: OverflowBox(
                            alignment: Alignment.centerLeft,
                            maxWidth: 170,
                            child: InkWell(
                              onTap: back,
                              borderRadius: BorderRadius.circular(10),
                              child: SizedBox(
                                height: 44,
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 6),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(
                                        ios ? Symbols.chevron_left_rounded : Symbols.arrow_back_rounded,
                                        size: 28,
                                        color: LefiColors.link,
                                        semanticLabel: 'Back',
                                      ),
                                      if (ios)
                                        Text(
                                          backLabel,
                                          softWrap: false,
                                          style: LefiText.body(16, weight: 600, color: LefiColors.link),
                                        ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                        Expanded(
                          child: Text(
                            title,
                            textAlign: ios ? TextAlign.center : TextAlign.left,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: LefiText.outfit(17),
                          ),
                        ),
                        const SizedBox(width: 104),
                      ],
                    ),
                  ),
                ),
              ),
              Expanded(child: body),
              ?bottom,
            ],
          ),
        ),
      ),
    );
  }
}

/// Standard scrolling column body with the design's 16 px gutters.
class ScrollBody extends StatelessWidget {
  const ScrollBody({
    super.key,
    required this.children,
    this.padding = const EdgeInsets.fromLTRB(16, 14, 16, 28),
    this.gap = 14,
  });
  final List<Widget> children;
  final EdgeInsets padding;
  final double gap;

  @override
  Widget build(BuildContext context) => ListView(
    padding: padding,
    children: [
      for (final (i, c) in children.indexed) ...[if (i > 0) SizedBox(height: gap), c],
    ],
  );
}

/// Column with uniform spacing (used inside cards).
class Gap extends StatelessWidget {
  const Gap({super.key, required this.children, this.gap = 10, this.crossAxisAlignment = CrossAxisAlignment.stretch});
  final List<Widget> children;
  final double gap;
  final CrossAxisAlignment crossAxisAlignment;

  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: crossAxisAlignment,
    children: [
      for (final (i, c) in children.indexed) ...[if (i > 0) SizedBox(height: gap), c],
    ],
  );
}
