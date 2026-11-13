import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/rows.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../core/widgets/selectors.dart';
import '../../ai_control/presentation/ai_widgets.dart';
import '../application/brain_alerts.dart';
import '../application/notifications_controller.dart';
import '../domain/app_notification.dart';
import 'brain_alerts_view.dart';
import 'notification_sheet.dart';
import 'notification_style.dart';

class AlertsScreen extends ConsumerStatefulWidget {
  const AlertsScreen({super.key});

  @override
  ConsumerState<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends ConsumerState<AlertsScreen> {
  NotificationCategory? _filter; // null = All
  bool _showAlerts = true; // Lefi Brain: its alerts first, then this person's notifications

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(notificationsControllerProvider);
    final s = async.value;
    final unread = s?.unread ?? 0;
    final brain = ref.watch(brainAlertRepositoryProvider) != null;
    final alerts = brain && _showAlerts;
    final switcher = brain
        ? SegmentedTabs<bool>(
            items: const [true, false],
            selected: _showAlerts,
            labelOf: (a) => a ? 'Alerts' : 'Notifications${unread > 0 ? ' · $unread' : ''}',
            onSelected: (a) => setState(() => _showAlerts = a),
          )
        : null;
    if (alerts) {
      return RootScreen(
        title: 'Alerts',
        subtitle: 'From Lefi Brain',
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
            child: Gap(gap: 12, children: [switcher!, const BrainAlertsView()]),
          ),
        ],
      );
    }
    return RootScreen(
      title: 'Alerts',
      subtitle: '$unread unread',
      action: unread > 0
          ? LefiTextButton('Mark all read', onPressed: ref.read(notificationsControllerProvider.notifier).markAllRead)
          : null,
      top: const AiOfflineBar(),
      children: [
        AsyncView(
          async,
          data: (s) {
            final cats = [null, ...NotificationCategory.values.where((c) => s.items.any((n) => n.category == c))];
            final f = cats.contains(_filter) ? _filter : null;
            final list = s.items.where((n) => f == null || n.category == f).toList();
            final groups = [
              ('Today', list.where((n) => n.today).toList()),
              ('Earlier', list.where((n) => !n.today).toList()),
            ].where((g) => g.$2.isNotEmpty);
            return Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
              child: Gap(
                gap: 12,
                children: [
                  ?switcher,
                  FilterPills<NotificationCategory?>(
                    items: cats,
                    selected: f,
                    labelOf: (c) => c == null ? 'All · ${s.items.length}' : c.short,
                    onSelected: (c) => setState(() => _filter = c),
                    horizontalPadding: 13,
                  ),
                  for (final (label, items) in groups) ...[
                    Padding(padding: const EdgeInsets.fromLTRB(2, 4, 2, 0), child: Overline(label, size: 12)),
                    CardList(children: [for (final n in items) _NotificationRow(n, s)]),
                  ],
                  if (list.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 12),
                      child: Column(
                        children: [
                          Image.asset('assets/brand/mascot-calm.png', width: 120),
                          const SizedBox(height: 8),
                          Text('Nothing here', style: LefiText.outfit(18)),
                          const SizedBox(height: 8),
                          Text(
                            'No notifications in this category.',
                            style: LefiText.body(14, color: LefiColors.subtle),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            );
          },
        ),
      ],
    );
  }
}

/// Tags shown under a notification (Escalated / Acknowledged / Simulation / zone).
List<(String, Tone)> notificationTags(AppNotification n, NotificationsState s) => [
  if (s.ackLine(n) != null) ('Acknowledged', Tone.ok),
  if (n.simulated) ('Simulation', Tone.ai),
  if (n.zoneId != null) (n.zoneId!, Tone.neutral),
];

class _NotificationRow extends ConsumerWidget {
  const _NotificationRow(this.n, this.s);
  final AppNotification n;
  final NotificationsState s;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = !s.read.contains(n.id);
    return Material(
      color: unread ? const Color(0xFFF5FAF7) : Colors.white,
      child: InkWell(
        onTap: () => showNotificationSheet(context, n.id),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: LefiColors.divider)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              IconTile.tone(categoryIcon(n.category), categoryTone(n.category)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            n.title,
                            style: LefiText.body(14.5, weight: 700, color: LefiColors.ink, height: 1.3),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(n.time, style: LefiText.body(12, color: LefiColors.subtle)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(n.body, style: LefiText.body(13, color: LefiColors.secondary, height: 1.45)),
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 5,
                      runSpacing: 5,
                      children: [
                        for (final (l, t) in notificationTags(n, s))
                          ToneChip(
                            l,
                            tone: t,
                            fontSize: 10.5,
                            radius: 6,
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              if (unread) ...[
                const SizedBox(width: 12),
                Container(
                  width: 9,
                  height: 9,
                  margin: const EdgeInsets.only(top: 6),
                  decoration: const BoxDecoration(color: LefiColors.success, shape: BoxShape.circle),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
