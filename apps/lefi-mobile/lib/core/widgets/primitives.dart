import 'package:flutter/material.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../theme/lefi_colors.dart';
import '../theme/lefi_text.dart';
import '../theme/tone.dart';

/// White rounded card with the design's hairline border.
class LefiCard extends StatelessWidget {
  const LefiCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(14),
    this.radius = 18,
    this.color = LefiColors.surface,
    this.borderColor = LefiColors.border,
    this.gradient,
    this.onTap,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final Color color;
  final Color? borderColor;
  final Gradient? gradient;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(radius),
      side: borderColor == null ? BorderSide.none : BorderSide(color: borderColor!),
    );
    final content = Padding(padding: padding, child: child);
    return Material(
      color: gradient == null ? color : Colors.transparent,
      shape: shape,
      clipBehavior: Clip.antiAlias,
      child: Ink(
        decoration: gradient == null ? null : BoxDecoration(gradient: gradient),
        child: onTap == null ? content : InkWell(onTap: onTap, child: content),
      ),
    );
  }
}

/// Small rounded status pill ("High", "LIVE", "Acknowledged").
class ToneChip extends StatelessWidget {
  const ToneChip(
    this.label, {
    super.key,
    this.tone = Tone.neutral,
    this.fontSize = 11,
    this.padding = const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    this.radius = 7,
    this.icon,
    this.background,
    this.foreground,
    this.mono = false,
  });

  final String label;
  final Tone tone;
  final double fontSize;
  final EdgeInsets padding;
  final double radius;
  final IconData? icon;
  final Color? background;
  final Color? foreground;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    final fg = foreground ?? tone.fg;
    final style = mono
        ? LefiText.mono(fontSize, weight: 600, color: fg)
        : LefiText.body(fontSize, weight: 800, color: fg);
    return Container(
      padding: padding,
      decoration: BoxDecoration(color: background ?? tone.bg, borderRadius: BorderRadius.circular(radius)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: fontSize + 3.5, color: fg), const SizedBox(width: 3)],
          Text(label, style: style, maxLines: 1, softWrap: false),
        ],
      ),
    );
  }
}

/// "SIMULATION" badge — violet, always shown on simulated content.
class SimulationBadge extends StatelessWidget {
  const SimulationBadge({super.key, this.label = 'SIMULATION', this.fontSize = 9.5});
  final String label;
  final double fontSize;

  @override
  Widget build(BuildContext context) => ToneChip(
    label,
    fontSize: fontSize,
    background: LefiColors.simulation,
    foreground: Colors.white,
    radius: 5,
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
  );
}

/// Rounded square holding an icon (row leading tiles, quick actions).
class IconTile extends StatelessWidget {
  const IconTile(
    this.icon, {
    super.key,
    this.size = 40,
    this.radius = 12,
    this.iconSize = 21,
    this.background = LefiColors.brandTint,
    this.foreground = LefiColors.brandDark,
    this.fill = 0,
  });

  IconTile.tone(IconData icon, Tone tone, {Key? key, double size = 40, double radius = 12, double iconSize = 21})
    : this(icon, key: key, size: size, radius: radius, iconSize: iconSize, background: tone.bg, foreground: tone.fg);

  final IconData icon;
  final double size;
  final double radius;
  final double iconSize;
  final Color background;
  final Color foreground;
  final double fill;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(radius)),
    child: Icon(icon, size: iconSize, color: foreground, fill: fill),
  );
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(
    this.text, {
    super.key,
    this.size = 18,
    this.trailing,
    this.padding = const EdgeInsets.symmetric(horizontal: 2),
  });
  final String text;
  final double size;
  final Widget? trailing;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Padding(
    padding: padding,
    child: Row(
      children: [
        Expanded(child: Text(text, style: LefiText.outfit(size))),
        ?trailing,
      ],
    ),
  );
}

class Overline extends StatelessWidget {
  const Overline(this.text, {super.key, this.color = LefiColors.subtle, this.size = 11.5});
  final String text;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) => Text(
    text.toUpperCase(),
    style: LefiText.overline(size: size, color: color),
  );
}

class Chevron extends StatelessWidget {
  const Chevron({super.key, this.size = 20, this.color = LefiColors.chevron});
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) => Icon(Symbols.chevron_right_rounded, size: size, color: color);
}

/// Thin progress bar.
class LefiProgress extends StatelessWidget {
  const LefiProgress({
    super.key,
    required this.value,
    this.height = 8,
    this.track = LefiColors.progressTrack,
    this.fill = LefiColors.brand,
  });

  final double value;
  final double height;
  final Color track;
  final Color fill;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(height / 2 + 1),
    child: SizedBox(
      height: height,
      child: Stack(
        fit: StackFit.expand,
        children: [
          ColoredBox(color: track),
          FractionallySizedBox(
            alignment: Alignment.centerLeft,
            widthFactor: value.clamp(0, 1),
            child: DecoratedBox(
              decoration: BoxDecoration(color: fill, borderRadius: BorderRadius.circular(height / 2 + 1)),
            ),
          ),
        ],
      ),
    ),
  );
}

class Avatar extends StatelessWidget {
  const Avatar({super.key, required this.initials, required this.color, this.size = 46, this.fontSize = 16});
  final String initials;
  final Color color;
  final double size;
  final double fontSize;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    child: Text(initials, style: LefiText.outfit(fontSize, color: Colors.white)),
  );
}

/// The design's iOS-like 48×28 switch.
class LefiToggle extends StatelessWidget {
  const LefiToggle({super.key, required this.value, required this.onChanged, this.semanticLabel});
  final bool value;
  final VoidCallback onChanged;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) => Semantics(
    toggled: value,
    button: true,
    label: semanticLabel,
    child: GestureDetector(
      onTap: onChanged,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        width: 48,
        height: 28,
        padding: const EdgeInsets.all(2),
        alignment: value ? Alignment.centerRight : Alignment.centerLeft,
        decoration: BoxDecoration(
          color: value ? LefiColors.brand : LefiColors.toggleOff,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Container(
          width: 24,
          height: 24,
          decoration: const BoxDecoration(
            color: Colors.white,
            shape: BoxShape.circle,
            boxShadow: [BoxShadow(color: Color(0x33000000), blurRadius: 3, offset: Offset(0, 1))],
          ),
        ),
      ),
    ),
  );
}

/// Grey informational strip with an icon ("lock · View only — …").
class InfoNote extends StatelessWidget {
  const InfoNote({
    super.key,
    required this.text,
    this.icon = Symbols.lock_rounded,
    this.background = LefiColors.surfaceNeutral,
    this.foreground = LefiColors.muted,
    this.fontSize = 13,
    this.fontWeight = 400,
    this.iconSize = 18,
    this.padding = const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
  });

  final String text;
  final IconData icon;
  final Color background;
  final Color foreground;
  final double fontSize;
  final int fontWeight;
  final double iconSize;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Container(
    padding: padding,
    decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(12)),
    child: Row(
      children: [
        Icon(icon, size: iconSize, color: foreground),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: LefiText.body(fontSize, weight: fontWeight, color: foreground, height: 1.4),
          ),
        ),
      ],
    ),
  );
}

/// Divider used between rows inside cards.
class RowDivider extends StatelessWidget {
  const RowDivider({super.key, this.color = LefiColors.divider});
  final Color color;
  @override
  Widget build(BuildContext context) => Container(height: 1, color: color);
}

/// Key/value line used in detail cards.
class KeyValueRow extends StatelessWidget {
  const KeyValueRow(this.k, this.v, {super.key, this.last = false, this.fontSize = 14, this.valueWidget});
  final String k;
  final String v;
  final bool last;
  final double fontSize;
  final Widget? valueWidget;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(vertical: 12),
    decoration: BoxDecoration(
      border: last ? null : const Border(bottom: BorderSide(color: LefiColors.divider)),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Text(k, style: LefiText.body(fontSize, color: LefiColors.subtle)),
        const SizedBox(width: 12),
        Expanded(
          child: Align(
            alignment: Alignment.centerRight,
            child:
                valueWidget ??
                Text(
                  v,
                  textAlign: TextAlign.right,
                  style: LefiText.body(fontSize, weight: 700, color: LefiColors.text),
                ),
          ),
        ),
      ],
    ),
  );
}
