import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/navigation/open_target.dart';
import '../../../core/feedback/feedback.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/overlays.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../shared/domain/role.dart';
import '../../auth/application/session.dart';
import '../../home/domain/dashboard.dart';
import '../../home/presentation/home_screen.dart';
import '../application/notifications_controller.dart';
import '../domain/app_notification.dart';
import 'alerts_screen.dart';
import 'notification_style.dart';

/// Opens a notification (marks it read) in a bottom sheet.
Future<void> showNotificationSheet(BuildContext context, String id) async {
  final container = ProviderScope.containerOf(context);
  container.read(notificationsControllerProvider.notifier).markRead(id);
  final action = await showLefiSheet<NotificationAction>(context, builder: (_) => _NotificationSheet(id));
  if (action == null || !context.mounted) return;
  final target = switch (action.kind) {
    NotificationActionKind.handover => const HandoverTarget() as AppTarget,
    NotificationActionKind.task => TaskTarget(action.targetId!),
    NotificationActionKind.plant => PlantTarget(action.targetId!),
    NotificationActionKind.zone => ZoneTarget(action.targetId!),
    NotificationActionKind.robot => null,
  };
  if (target == null) return showRobotPhotosSheet(context);
  await openTarget(context, target);
}

class _NotificationSheet extends ConsumerWidget {
  const _NotificationSheet(this.id);
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(notificationsControllerProvider).requireValue;
    final n = s.items.firstWhere((x) => x.id == id);
    final role = ref.watch(currentUserProvider).role;
    final ack = s.ackLine(n);
    final critical = n.category == NotificationCategory.critical;
    final tone = categoryTone(n.category);
    final esc = [
      ...n.escalation,
      if (s.acked.containsKey(n.id))
        EscalationStep(
          '10:24',
          'Acknowledged by ${ref.read(currentUserProvider).name} via mobile',
          'Escalation stopped',
        ),
    ];

    return Gap(
      gap: 14,
      children: [
        Row(
          children: [
            IconTile.tone(categoryIcon(n.category), tone),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                n.category.label.toUpperCase(),
                style: LefiText.body(12.5, weight: 800, color: LefiColors.muted, letterSpacing: .6),
              ),
            ),
            Text(n.time, style: LefiText.body(12.5, color: LefiColors.subtle)),
          ],
        ),
        Text(n.title, style: LefiText.outfit(21, height: 1.25)),
        Text(n.body, style: LefiText.body(15, color: LefiColors.strong, height: 1.5)),
        Wrap(
          spacing: 5,
          runSpacing: 5,
          children: [
            for (final (l, t) in notificationTags(n, s)) ToneChip(l, tone: t),
            if (n.incident != null) ToneChip(n.incident!, mono: true),
          ],
        ),
        if (esc.isNotEmpty)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(color: LefiColors.surfaceMuted, borderRadius: BorderRadius.circular(14)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text('ESCALATION', style: LefiText.body(12, weight: 800, color: LefiColors.muted)),
                ),
                for (final e in esc)
                  Container(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    decoration: const BoxDecoration(
                      border: Border(top: BorderSide(color: LefiColors.hairline)),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(
                          width: 54,
                          child: Text(e.time, style: LefiText.mono(13, weight: 400, color: LefiColors.faint)),
                        ),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(e.what, style: LefiText.body(13, weight: 700)),
                              Text(e.status, style: LefiText.body(12, color: LefiColors.subtle)),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        if (critical && ack == null && role.can(Permission.ackIncidents))
          LefiButton(
            label: 'Acknowledge incident',
            icon: Symbols.check_circle_rounded,
            background: LefiColors.danger,
            onPressed: () async {
              await ref
                  .read(busyProvider.notifier)
                  .run('Acknowledging…', () => ref.read(notificationsControllerProvider.notifier).acknowledge(n.id));
              ref.read(toastProvider.notifier).show('${n.incident ?? n.title} acknowledged.');
            },
          ),
        if (critical && ack == null && !role.can(Permission.ackIncidents))
          const InfoNote(text: 'Your role can view but not acknowledge incidents.'),
        if (ack != null && critical)
          InfoNote(
            text: 'Acknowledged · $ack',
            icon: Symbols.verified_rounded,
            iconSize: 19,
            background: const Color(0xFFE4F4EA),
            foreground: const Color(0xFF1F7A4D),
            fontSize: 13.5,
            fontWeight: 700,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
          ),
        if (n.action != null && n.action!.kind != NotificationActionKind.robot)
          LefiOutlineButton(
            label: n.action!.label,
            height: 52,
            fontWeight: 800,
            onPressed: () => Navigator.pop(context, n.action),
          ),
        if (n.category == NotificationCategory.robot)
          LefiButton(
            label: 'Open robot mission',
            icon: Symbols.smart_toy_rounded,
            iconSize: 18,
            height: 48,
            fontSize: 14,
            fontWeight: 700,
            background: LefiColors.simulation,
            onPressed: () => Navigator.pop(context, n.action),
          ),
      ],
    );
  }
}
