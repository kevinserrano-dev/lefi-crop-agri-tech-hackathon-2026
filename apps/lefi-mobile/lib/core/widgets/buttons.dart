import 'package:flutter/material.dart';

import '../theme/lefi_colors.dart';
import '../theme/lefi_text.dart';

/// Filled action button (design default: dark green, 54 px, radius 14).
class LefiButton extends StatelessWidget {
  const LefiButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.height = 54,
    this.radius = 14,
    this.background = LefiColors.brandDark,
    this.foreground = Colors.white,
    this.fontSize = 16,
    this.fontWeight = 800,
    this.iconSize = 22,
    this.letterSpacing,
    this.shadow,
    this.opacity = 1,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final double height;
  final double radius;
  final Color background;
  final Color foreground;
  final double fontSize;
  final int fontWeight;
  final double iconSize;
  final double? letterSpacing;
  final List<BoxShadow>? shadow;
  final double opacity;

  @override
  Widget build(BuildContext context) => Opacity(
    opacity: opacity,
    child: Container(
      height: height,
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(radius), boxShadow: shadow),
      child: Material(
        color: background,
        borderRadius: BorderRadius.circular(radius),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onPressed,
          child: Center(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (icon != null) ...[Icon(icon, size: iconSize, color: foreground), const SizedBox(width: 8)],
                Flexible(
                  child: Text(
                    label,
                    textAlign: TextAlign.center,
                    style: LefiText.body(fontSize, weight: fontWeight, color: foreground, letterSpacing: letterSpacing),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

/// White outlined button (border #CFE3D6, dark green label).
class LefiOutlineButton extends StatelessWidget {
  const LefiOutlineButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.height = 50,
    this.radius = 14,
    this.borderColor = LefiColors.brandBorder,
    this.foreground = LefiColors.brandDark,
    this.background = Colors.white,
    this.fontSize = 15,
    this.fontWeight = 700,
    this.iconSize = 22,
    this.borderWidth = 1,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final double height;
  final double radius;
  final Color borderColor;
  final Color foreground;
  final Color background;
  final double fontSize;
  final int fontWeight;
  final double iconSize;
  final double borderWidth;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: height,
    child: Material(
      color: background,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radius),
        side: BorderSide(color: borderColor, width: borderWidth),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onPressed,
        child: Center(
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[Icon(icon, size: iconSize, color: foreground), const SizedBox(width: 8)],
              Flexible(
                child: Text(
                  label,
                  textAlign: TextAlign.center,
                  style: LefiText.body(fontSize, weight: fontWeight, color: foreground),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

/// Plain text button in link green ("Mark all read", "+ Add").
class LefiTextButton extends StatelessWidget {
  const LefiTextButton(
    this.label, {
    super.key,
    required this.onPressed,
    this.fontSize = 14,
    this.height = 44,
    this.color = LefiColors.link,
    this.fontWeight = 700,
  });
  final String label;
  final VoidCallback? onPressed;
  final double fontSize;
  final double height;
  final Color color;
  final int fontWeight;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onPressed,
    borderRadius: BorderRadius.circular(8),
    child: SizedBox(
      height: height,
      child: Center(
        child: Text(
          label,
          style: LefiText.body(fontSize, weight: fontWeight, color: color),
        ),
      ),
    ),
  );
}

/// Translucent bottom bar holding the primary action of a pushed screen.
class StickyActionBar extends StatelessWidget {
  const StickyActionBar({
    super.key,
    required this.children,
    this.padding = const EdgeInsets.fromLTRB(16, 12, 16, 14),
    this.gap = 10,
  });
  final List<Widget> children;
  final EdgeInsets padding;
  final double gap;

  @override
  Widget build(BuildContext context) => Container(
    padding: padding,
    decoration: const BoxDecoration(
      color: Color(0xF5F7F9F6),
      border: Border(top: BorderSide(color: LefiColors.hairline)),
    ),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, c) in children.indexed) ...[if (i > 0) SizedBox(height: gap), c],
      ],
    ),
  );
}

/// Green "done" status block shown in place of a button.
class DoneBanner extends StatelessWidget {
  const DoneBanner({super.key, required this.label, required this.icon, this.height = 54, this.fontSize = 15});
  final String label;
  final IconData icon;
  final double height;
  final double fontSize;

  @override
  Widget build(BuildContext context) => Container(
    height: height,
    padding: const EdgeInsets.symmetric(horizontal: 12),
    decoration: BoxDecoration(color: const Color(0xFFE4F4EA), borderRadius: BorderRadius.circular(14)),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(icon, size: 22, color: const Color(0xFF1F7A4D)),
        const SizedBox(width: 8),
        Flexible(
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: LefiText.body(fontSize, weight: 800, color: const Color(0xFF1F7A4D)),
          ),
        ),
      ],
    ),
  );
}
