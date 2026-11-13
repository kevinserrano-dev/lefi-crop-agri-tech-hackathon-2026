import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/router/routes.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/primitives.dart';
import '../application/brain_robots.dart';
import 'brain_robot_screen.dart';

/// The simulated robot on Home (roles with `nav.robots`): what it does; tap = the robot screen.
/// Nothing when the role cannot see robots or Lefi Brain has none.
class BrainRobotCard extends ConsumerWidget {
  const BrainRobotCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(brainRobotRepositoryProvider) == null) return const SizedBox.shrink();
    final robots = ref.watch(brainRobotsProvider).value;
    if (robots == null || robots.isEmpty) return const SizedBox.shrink();
    final r = robots.first;
    final tone = r.online ? (r.mission?.active == true ? Tone.info : Tone.ok) : Tone.off;
    return LefiCard(
      onTap: context.pushRobot,
      child: Row(
        children: [
          IconTile.tone(Symbols.smart_toy_rounded, tone, size: 46, radius: 13, iconSize: 25),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(r.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: LefiText.outfit(16)),
                    ),
                    const SizedBox(width: 6),
                    SimulationBadge(label: r.origin, fontSize: 10),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  robotDoing(r),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: LefiText.body(12.5, color: LefiColors.muted, height: 1.4),
                ),
              ],
            ),
          ),
          const Icon(Symbols.chevron_right_rounded, color: LefiColors.chevron),
        ],
      ),
    );
  }
}
