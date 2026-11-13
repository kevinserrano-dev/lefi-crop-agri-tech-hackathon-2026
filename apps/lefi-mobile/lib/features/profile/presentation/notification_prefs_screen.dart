import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../core/feedback/feedback.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/rows.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../alerts/domain/app_notification.dart';
import '../../alerts/presentation/notification_style.dart';
import '../../auth/application/session.dart';
import '../application/notification_prefs.dart';

class NotificationPrefsScreen extends ConsumerWidget {
  const NotificationPrefsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final u = ref.watch(currentUserProvider);
    final p = ref.watch(notificationPrefsProvider);
    final ctl = ref.read(notificationPrefsProvider.notifier);
    final toast = ref.read(toastProvider.notifier);

    Widget toggleRow(String title, String sub, Widget trailing, {bool last = false}) => Container(
      constraints: const BoxConstraints(minHeight: 58),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        border: last ? null : const Border(bottom: BorderSide(color: LefiColors.divider)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: LefiText.body(14.5, weight: 700)),
                Text(sub, style: LefiText.body(12, color: LefiColors.subtle)),
              ],
            ),
          ),
          trailing,
        ],
      ),
    );

    return PushedScreen(
      title: 'Notifications',
      backLabel: 'Profile',
      body: ScrollBody(
        children: [
          Text(
            'Your role decides which notifications you can receive. Locked categories go to other roles.',
            style: LefiText.body(13.5, color: LefiColors.muted, height: 1.5),
          ),
          CardList(
            children: [
              for (final c in NotificationCategory.values)
                Opacity(
                  opacity: c.audience.contains(u.role) ? 1 : .55,
                  child: NavRow(
                    icon: categoryIcon(c),
                    tone: categoryTone(c),
                    tileSize: 38,
                    iconSize: 20,
                    minHeight: 64,
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    subtitleSize: 12,
                    title: c.label,
                    subtitle: c.audience.contains(u.role) ? c.description : 'Not available for your role',
                    trailing: c.audience.contains(u.role)
                        ? LefiToggle(
                            value: p.isOn(u.role, c),
                            onChanged: () {
                              if (c == NotificationCategory.critical && p.isOn(u.role, c)) {
                                return toast.show(
                                  'Critical incident alerts can’t be turned off while you’re on the escalation chain.',
                                  bad: true,
                                );
                              }
                              ctl.toggle(u.role, c);
                            },
                          )
                        : IconButton(
                            onPressed: () => toast.show('${c.label} aren’t sent to ${u.short}s.', bad: true),
                            icon: const Icon(Symbols.lock_rounded, size: 20, color: LefiColors.faint),
                          ),
                  ),
                ),
            ],
          ),
          if (NotificationCategory.critical.audience.contains(u.role)) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(2, 4, 2, 0),
              child: Text('Critical incident delivery', style: LefiText.outfit(17)),
            ),
            CardList(
              children: [
                toggleRow(
                  'Push notification',
                  'Required while on the escalation chain',
                  const Icon(Symbols.check_circle_rounded, size: 20, color: LefiColors.success),
                ),
                toggleRow(
                  'SMS',
                  '(519) 326-41xx · if push isn’t acknowledged',
                  LefiToggle(value: p.sms, onChanged: ctl.toggleSms),
                ),
                toggleRow(
                  'Voice call',
                  'Escalation only · press 1 to acknowledge',
                  LefiToggle(value: p.voice, onChanged: ctl.toggleVoice),
                  last: true,
                ),
              ],
            ),
          ],
          CardList(
            children: [
              toggleRow(
                'Quiet hours · 22:00–06:00',
                'Critical incidents still come through',
                LefiToggle(value: p.quietHours, onChanged: ctl.toggleQuiet),
                last: true,
              ),
            ],
          ),
          const InfoNote(
            icon: Symbols.info_rounded,
            text: 'Push, SMS and voice need an external provider. On the offline LAN they are disabled; alerts arrive in-app while you are connected to the Brain.',
          ),
        ],
      ),
    );
  }
}
