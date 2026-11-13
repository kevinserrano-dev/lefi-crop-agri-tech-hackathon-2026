import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../theme/lefi_colors.dart';
import '../theme/lefi_text.dart';

/// Skeleton shown while a screen loads (design `v.skeleton`).
class ScreenSkeleton extends StatelessWidget {
  const ScreenSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    Widget b(double h, Color c, {double r = 16, double? w}) => Container(
      height: h,
      width: w,
      decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(r)),
    );
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FractionallySizedBox(widthFactor: .55, child: b(30, LefiColors.skeleton, r: 8)),
          const SizedBox(height: 12),
          b(150, LefiColors.skeleton, r: 20),
          const SizedBox(height: 12),
          b(72, LefiColors.skeletonSoft),
          const SizedBox(height: 12),
          b(72, LefiColors.skeletonSoft),
          const SizedBox(height: 12),
          b(72, LefiColors.skeletonSofter),
        ],
      ),
    );
  }
}

/// Renders an [AsyncValue] with the app's loading and error states.
class AsyncView<T> extends StatelessWidget {
  const AsyncView(this.value, {super.key, required this.data});
  final AsyncValue<T> value;
  final Widget Function(T data) data;

  @override
  Widget build(BuildContext context) => switch (value) {
    AsyncData(:final value) => data(value),
    AsyncError(:final error) => Padding(
      padding: const EdgeInsets.all(24),
      child: Text('Could not load data: $error', style: LefiText.body(14, color: LefiColors.dangerDeep)),
    ),
    _ => const ScreenSkeleton(),
  };
}
