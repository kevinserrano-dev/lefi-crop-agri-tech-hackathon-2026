import 'package:flutter/material.dart';

import '../theme/lefi_colors.dart';
import '../theme/lefi_text.dart';
import '../theme/tone.dart';
import 'dashed_border.dart';
import 'primitives.dart';

/// White bordered card that stacks tappable rows (design list groups).
class CardList extends StatelessWidget {
  const CardList({
    super.key,
    required this.children,
    this.radius = 18,
    this.color = Colors.white,
    this.borderColor = LefiColors.border,
    this.dashed = false,
  });
  final List<Widget> children;
  final double radius;
  final Color color;
  final Color borderColor;
  final bool dashed;

  @override
  Widget build(BuildContext context) {
    final content = Material(
      type: MaterialType.transparency,
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
    );
    if (dashed) {
      return DashedBorder(
        color: borderColor,
        radius: radius,
        child: ColoredBox(color: color, child: content),
      );
    }
    return Container(
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: borderColor),
      ),
      clipBehavior: Clip.antiAlias,
      child: content,
    );
  }
}

/// Row with leading icon tile, title/subtitle, optional chip and chevron.
class NavRow extends StatelessWidget {
  const NavRow({
    super.key,
    required this.icon,
    required this.tone,
    required this.title,
    required this.subtitle,
    this.chip,
    this.chipTone,
    this.onTap,
    this.minHeight = 66,
    this.padding = const EdgeInsets.fromLTRB(14, 10, 12, 10),
    this.tileSize = 40,
    this.iconSize = 21,
    this.titleSize = 14.5,
    this.subtitleSize = 12.5,
    this.background = Colors.white,
    this.divider = LefiColors.divider,
    this.trailing,
    this.titleMono = false,
    this.leading,
  });

  final IconData icon;
  final Tone tone;
  final String title;
  final String subtitle;
  final String? chip;
  final Tone? chipTone;
  final VoidCallback? onTap;
  final double minHeight;
  final EdgeInsets padding;
  final double tileSize;
  final double iconSize;
  final double titleSize;
  final double subtitleSize;
  final Color background;
  final Color divider;
  final Widget? trailing;
  final bool titleMono;
  final Widget? leading;

  @override
  Widget build(BuildContext context) => Material(
    color: background,
    child: InkWell(
      onTap: onTap,
      child: Container(
        constraints: BoxConstraints(minHeight: minHeight),
        padding: padding,
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: divider)),
        ),
        child: Row(
          children: [
            leading ?? IconTile.tone(icon, tone, size: tileSize, iconSize: iconSize, radius: tileSize >= 40 ? 12 : 11),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: titleMono
                        ? LefiText.mono(titleSize, weight: 600)
                        : LefiText.body(titleSize, weight: 700, color: LefiColors.ink, height: 1.3),
                  ),
                  const SizedBox(height: 2),
                  Text(subtitle, style: LefiText.body(subtitleSize, color: LefiColors.subtle, height: 1.35)),
                ],
              ),
            ),
            if (chip != null && chip!.isNotEmpty) ...[
              const SizedBox(width: 12),
              ToneChip(chip!, tone: chipTone ?? tone),
            ],
            if (trailing != null) ...[const SizedBox(width: 12), trailing!],
            if (onTap != null) ...[const SizedBox(width: 12), const Chevron()],
          ],
        ),
      ),
    ),
  );
}
