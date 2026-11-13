import 'package:flutter/material.dart';

import '../theme/lefi_colors.dart';
import '../theme/lefi_text.dart';

/// Outlined text field matching the design (52 px, radius 12, border #D5DED8).
class LefiTextField extends StatelessWidget {
  const LefiTextField({
    super.key,
    this.controller,
    this.initialValue,
    this.onChanged,
    this.onSubmitted,
    this.hint,
    this.obscure = false,
    this.keyboardType,
    this.height = 52,
    this.minLines,
    this.mono = false,
    this.radius = 12,
    this.textCapitalization = TextCapitalization.none,
    this.fontSize = 16,
    this.fill = Colors.white,
    this.borderColor = LefiColors.inputBorder,
  });

  final TextEditingController? controller;
  final String? initialValue;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final String? hint;
  final bool obscure;
  final TextInputType? keyboardType;
  final double height;

  /// When set, renders a multi-line text area with this minimum height in lines.
  final int? minLines;
  final bool mono;
  final double radius;
  final TextCapitalization textCapitalization;
  final double fontSize;
  final Color fill;
  final Color borderColor;

  @override
  Widget build(BuildContext context) {
    final style = mono
        ? LefiText.mono(fontSize, color: LefiColors.ink)
        : LefiText.body(fontSize, color: LefiColors.ink);
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(radius),
      borderSide: BorderSide(color: borderColor),
    );
    final field = TextFormField(
      controller: controller,
      initialValue: controller == null ? initialValue : null,
      onChanged: onChanged,
      onFieldSubmitted: onSubmitted,
      obscureText: obscure,
      keyboardType: minLines != null ? TextInputType.multiline : keyboardType,
      minLines: minLines,
      maxLines: minLines != null ? null : 1,
      textCapitalization: textCapitalization,
      style: style,
      cursorColor: LefiColors.brandDark,
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: style.copyWith(color: const Color(0xFF8E9A93)),
        filled: true,
        fillColor: fill,
        isDense: true,
        contentPadding: minLines != null
            ? const EdgeInsets.all(12)
            : EdgeInsets.symmetric(horizontal: 14, vertical: (height - fontSize * 1.4) / 2),
        enabledBorder: border,
        focusedBorder: border,
        border: border,
      ),
    );
    return minLines != null ? field : SizedBox(height: height, child: field);
  }
}

/// Bold label above a field ("Work email").
class FieldLabel extends StatelessWidget {
  const FieldLabel(this.text, {super.key, required this.child});
  final String text;
  final Widget child;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(text, style: LefiText.body(13, weight: 700, color: LefiColors.strong)),
      const SizedBox(height: 6),
      child,
    ],
  );
}
