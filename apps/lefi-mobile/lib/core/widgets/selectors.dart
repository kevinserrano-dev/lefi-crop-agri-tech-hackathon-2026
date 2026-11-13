import 'package:flutter/material.dart';

import 'package:material_symbols_icons/symbols.dart';

import '../theme/lefi_colors.dart';
import '../theme/lefi_text.dart';

/// Horizontally scrolling filter pills ("Active · 3", "All · 7").
class FilterPills<T> extends StatelessWidget {
  const FilterPills({
    super.key,
    required this.items,
    required this.selected,
    required this.labelOf,
    required this.onSelected,
    this.height = 36,
    this.fontSize = 13,
    this.horizontalPadding = 14,
    this.bleed = 0,
  });

  final List<T> items;
  final T selected;
  final String Function(T) labelOf;
  final ValueChanged<T> onSelected;
  final double height;
  final double fontSize;
  final double horizontalPadding;

  /// Extends the scroll area to the screen edges (design: margin 0 -16px).
  final double bleed;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: height,
    child: ListView.separated(
      scrollDirection: Axis.horizontal,
      padding: EdgeInsets.symmetric(horizontal: bleed),
      clipBehavior: bleed > 0 ? Clip.none : Clip.hardEdge,
      itemCount: items.length,
      separatorBuilder: (_, _) => const SizedBox(width: 6),
      itemBuilder: (_, i) {
        final it = items[i];
        final on = it == selected;
        return PillButton(
          label: labelOf(it),
          selected: on,
          onTap: () => onSelected(it),
          height: height,
          fontSize: fontSize,
          horizontalPadding: horizontalPadding,
        );
      },
    ),
  );
}

class PillButton extends StatelessWidget {
  const PillButton({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.height = 36,
    this.fontSize = 13,
    this.horizontalPadding = 14,
    this.radius = 999,
    this.selectedBackground = LefiColors.brandDark,
    this.selectedForeground = Colors.white,
    this.selectedBorder = LefiColors.brandDark,
    this.borderWidth = 1,
    this.mono = false,
    this.leading,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final double height;
  final double fontSize;
  final double horizontalPadding;
  final double radius;
  final Color selectedBackground;
  final Color selectedForeground;
  final Color selectedBorder;
  final double borderWidth;
  final bool mono;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final fg = selected ? selectedForeground : LefiColors.strong;
    return SizedBox(
      height: height,
      child: Material(
        color: selected ? selectedBackground : Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radius),
          side: BorderSide(color: selected ? selectedBorder : LefiColors.chipBorder, width: borderWidth),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: horizontalPadding),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (leading != null) ...[leading!, const SizedBox(width: 7)],
                Text(
                  label,
                  style: mono
                      ? LefiText.mono(fontSize, weight: 600, color: fg)
                      : LefiText.body(fontSize, weight: 700, color: fg),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Segmented control (grey track, white selected segment with soft shadow).
class SegmentedTabs<T> extends StatelessWidget {
  const SegmentedTabs({
    super.key,
    required this.items,
    required this.selected,
    required this.labelOf,
    required this.onSelected,
    this.height = 40,
    this.fontSize = 14,
  });

  final List<T> items;
  final T selected;
  final String Function(T) labelOf;
  final ValueChanged<T> onSelected;
  final double height;
  final double fontSize;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(3),
    decoration: BoxDecoration(color: LefiColors.segmentTrack, borderRadius: BorderRadius.circular(12)),
    child: Row(
      children: [
        for (final (i, it) in items.indexed) ...[
          if (i > 0) const SizedBox(width: 4),
          Expanded(
            child: GestureDetector(
              onTap: () => onSelected(it),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                height: height,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: it == selected ? Colors.white : Colors.transparent,
                  borderRadius: BorderRadius.circular(10),
                  boxShadow: it == selected
                      ? const [BoxShadow(color: Color(0x24163D32), blurRadius: 3, offset: Offset(0, 1))]
                      : null,
                ),
                child: Text(
                  labelOf(it),
                  style: LefiText.body(
                    fontSize,
                    weight: 700,
                    color: it == selected ? LefiColors.brandDark : LefiColors.muted,
                  ),
                ),
              ),
            ),
          ),
        ],
      ],
    ),
  );
}

/// Round radio indicator (22 px ring with 10 px dot).
class RadioDot extends StatelessWidget {
  const RadioDot({
    super.key,
    required this.selected,
    this.color = LefiColors.brandDark,
    this.idle = LefiColors.checkboxBorder,
    this.fillBackground = false,
  });
  final bool selected;
  final Color color;
  final Color idle;
  final bool fillBackground;

  @override
  Widget build(BuildContext context) => Container(
    width: 22,
    height: 22,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: fillBackground ? Colors.white : null,
      border: Border.all(color: selected ? color : idle, width: 2),
    ),
    child: Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(shape: BoxShape.circle, color: selected ? color : Colors.transparent),
    ),
  );
}

/// Square checkbox (26 px, radius 8).
class CheckSquare extends StatelessWidget {
  const CheckSquare({super.key, required this.checked});
  final bool checked;

  @override
  Widget build(BuildContext context) => Container(
    width: 26,
    height: 26,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: checked ? LefiColors.brandDark : Colors.white,
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: checked ? LefiColors.brandDark : LefiColors.checkboxBorder, width: 2),
    ),
    child: checked ? const Icon(Symbols.check_rounded, size: 18, color: Colors.white) : null,
  );
}
