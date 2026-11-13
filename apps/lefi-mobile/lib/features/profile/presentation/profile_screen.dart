import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/navigation/open_target.dart';
import '../../../app/router/routes.dart';
import '../../../core/feedback/feedback.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/overlays.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/rows.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../../shared/domain/role.dart';
import '../../ai_control/presentation/ai_widgets.dart';
import '../../alerts/domain/app_notification.dart';
import '../../auth/application/session.dart';
import '../../auth/data/demo_auth_repository.dart';
import '../../brain/application/brain_connection.dart';
import '../../devices/application/devices_providers.dart';
import '../../handover/application/handover_controller.dart';
import '../../home/domain/dashboard.dart';
import '../application/brain_profile.dart';
import '../application/notification_prefs.dart';
import 'brain_profile_view.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  String _hm(double h) => '${h.floor()} h ${((h - h.floor()) * 60).round().toString().padLeft(2, '0')} m';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final u = ref.watch(currentUserProvider);
    if (u.fromBrain) {
      return RootScreen(
        title: 'Profile',
        subtitle: '${u.short} · Lefi Brain',
        onRefresh: () async {
          ref.invalidate(myShiftsProvider);
          ref.invalidate(notificationLevelProvider);
          await ref.read(myShiftsProvider.future);
        },
        children: const [BrainProfileView()],
      );
    }
    final brainDevices = ref.watch(brainDevicesRepositoryProvider) != null;
    final demoNowHours = ref.watch(clockHoursProvider);
    final prefs = ref.watch(notificationPrefsProvider);
    final hoAck = ref.watch(handoverAckProvider) != null;
    final allowed = NotificationCategory.values.where((c) => c.audience.contains(u.role)).toList();
    final on = allowed.where((c) => prefs.isOn(u.role, c)).length;
    final pct = ((demoNowHours - u.shiftStartHour) / (u.shiftEndHour - u.shiftStartHour)).clamp(0.0, 1.0);
    final onCall = prefs.onCall.contains(u.role);
    final pairing = ref.watch(brainConnectionProvider).value;

    Widget menuRow(
      IconData icon,
      String title, {
      String? sub,
      Widget? trailing,
      VoidCallback? onTap,
      bool last = false,
    }) => Material(
      color: Colors.white,
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: BoxConstraints(minHeight: onTap == null ? 54 : 58),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            border: last ? null : const Border(bottom: BorderSide(color: LefiColors.divider)),
          ),
          child: Row(
            children: [
              Icon(icon, size: 22, color: LefiColors.leaf),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: LefiText.body(15, weight: 700)),
                    if (sub != null) Text(sub, style: LefiText.body(12, color: LefiColors.subtle)),
                  ],
                ),
              ),
              ?trailing,
              if (onTap != null) ...[const SizedBox(width: 12), const Chevron()],
            ],
          ),
        ),
      ),
    );

    return RootScreen(
      title: 'Profile',
      subtitle: '${u.short} · ${u.greenhouseScope}',
      top: const AiOfflineBar(),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
          child: Gap(
            gap: 14,
            children: [
              LefiCard(
                radius: 20,
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Avatar(initials: u.initials, color: Color(u.colorValue), size: 64, fontSize: 22),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(u.name, style: LefiText.outfit(20)),
                          const SizedBox(height: 4),
                          ToneChip(
                            u.roleName,
                            tone: Tone.brand,
                            fontSize: 12,
                            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            u.email,
                            overflow: TextOverflow.ellipsis,
                            style: LefiText.body(12.5, color: LefiColors.subtle),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              if (u.fromBrain && pairing != null)
                LefiCard(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                  child: Column(
                    children: [
                      KeyValueRow('Signed in to', 'Lefi Brain'),
                      KeyValueRow('Address', pairing.url),
                      KeyValueRow('This phone', pairing.deviceId.split('-').first),
                      KeyValueRow('Other screens', 'DEMO DATA until connected', last: true),
                    ],
                  ),
                ),
              if (!u.fromBrain)
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: LefiColors.brandDark, borderRadius: BorderRadius.circular(20)),
                  child: Gap(
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text('CURRENT SHIFT', style: LefiText.overline(color: LefiColors.mint)),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                            decoration: BoxDecoration(
                              color: const Color(0x4054B985),
                              borderRadius: BorderRadius.circular(7),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  width: 7,
                                  height: 7,
                                  decoration: const BoxDecoration(color: LefiColors.brand, shape: BoxShape.circle),
                                ),
                                const SizedBox(width: 5),
                                Text('On shift', style: LefiText.body(12, weight: 800, color: const Color(0xFFBFF0D3))),
                              ],
                            ),
                          ),
                        ],
                      ),
                      Text(u.shiftLabel, style: LefiText.outfit(22, color: Colors.white)),
                      LefiProgress(value: pct, track: LefiColors.heroTrack),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            '${_hm(u.shiftEndHour - demoNowHours)} remaining',
                            style: LefiText.body(12.5, color: LefiColors.mintSoft),
                          ),
                          Flexible(
                            child: Text(
                              u.nextShift,
                              textAlign: TextAlign.right,
                              style: LefiText.body(12.5, color: LefiColors.mintSoft),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              if (!u.fromBrain)
                LefiCard(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                  child: Column(
                    children: [
                      KeyValueRow('Assigned greenhouse', u.greenhouseScope),
                      KeyValueRow(
                        'Zones',
                        '',
                        valueWidget: Wrap(
                          spacing: 5,
                          runSpacing: 5,
                          alignment: WrapAlignment.end,
                          children: [
                            for (final z in u.zones)
                              ToneChip(
                                z,
                                mono: true,
                                fontSize: 12,
                                foreground: LefiColors.text,
                                radius: 6,
                                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                              ),
                          ],
                        ),
                      ),
                      KeyValueRow('Reports to', u.reportsTo, last: true),
                    ],
                  ),
                ),
              if (u.role.can(Permission.onCall))
                LefiCard(
                  child: Gap(
                    children: [
                      Row(
                        children: [
                          IconTile.tone(Symbols.support_agent_rounded, Tone.crit, iconSize: 22),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Available 24/7 for critical alerts', style: LefiText.body(15, weight: 800)),
                                const SizedBox(height: 2),
                                Text(
                                  onCall
                                      ? 'Lefi AI may call you outside your shift when you’re next in line for a critical alert.'
                                      : 'You only get critical alerts during your shift.',
                                  style: LefiText.body(12, color: LefiColors.subtle, height: 1.4),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 12),
                          LefiToggle(
                            value: onCall,
                            onChanged: () {
                              ref.read(notificationPrefsProvider.notifier).toggleOnCall(u.role);
                              ref
                                  .read(toastProvider.notifier)
                                  .show(
                                    onCall
                                        ? 'Removed from the 24/7 roster. Your supervisor has been notified.'
                                        : 'Added to the 24/7 on-call roster.',
                                  );
                            },
                          ),
                        ],
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
                        decoration: BoxDecoration(
                          color: LefiColors.surfaceMuted,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Row(
                          children: [
                            const Icon(Symbols.event_rounded, size: 18, color: LefiColors.leaf),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'Primary on-call today: Tyler Brooks · backups Owen MacLeod, Daniel Tremblay',
                                style: LefiText.body(12.5, color: LefiColors.strong),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              CardList(
                children: [
                  if (brainDevices)
                    menuRow(
                      Symbols.device_hub_rounded,
                      'Devices & health',
                      sub: 'Lefi Brain · boards, sensors and their data',
                      onTap: () => context.pushDetail<void>(Routes.devices),
                    )
                  else if (!u.fromBrain && u.role.can(Permission.devices))
                    menuRow(
                      Symbols.device_hub_rounded,
                      'Devices & health',
                      sub: 'Sensors, cameras, robots · power & AI access',
                      onTap: () => openTarget(context, const PlannedTarget('Devices & health')),
                    ),
                  menuRow(
                    Symbols.sync_alt_rounded,
                    'Shift handover',
                    trailing: ToneChip(hoAck ? 'Acknowledged' : 'New', tone: hoAck ? Tone.ok : Tone.crit),
                    onTap: () => openTarget(context, const HandoverTarget()),
                  ),
                  menuRow(
                    Symbols.notifications_active_rounded,
                    'Notification preferences',
                    sub: '$on of ${allowed.length} categories on',
                    onTap: () => context.pushDetail<void>(Routes.prefs),
                  ),
                  menuRow(
                    Symbols.language_rounded,
                    'Language',
                    trailing: Text('English (Canada)', style: LefiText.body(14, color: LefiColors.subtle)),
                  ),
                  menuRow(
                    Symbols.thermostat_rounded,
                    'Units',
                    trailing: Text('Celsius · metric', style: LefiText.body(14, color: LefiColors.subtle)),
                    last: true,
                  ),
                ],
              ),
              LefiOutlineButton(
                label: 'Sign out',
                height: 52,
                fontWeight: 800,
                borderColor: LefiColors.dangerBorder,
                foreground: LefiColors.dangerDeep,
                onPressed: () async {
                  final ok = await showLefiConfirm(
                    context,
                    title: 'Sign out?',
                    body: 'You’ll stop receiving push notifications on this device until you sign in again.',
                    confirmLabel: 'Sign out',
                    confirmColor: LefiColors.dangerDeep,
                  );
                  if (ok) await ref.read(sessionProvider.notifier).signOut();
                },
              ),
              if (pairing != null)
                LefiOutlineButton(
                  label: 'Forget this Lefi Brain',
                  height: 48,
                  onPressed: () async {
                    final ok = await showLefiConfirm(
                      context,
                      title: 'Forget this Lefi Brain?',
                      body: 'You will be signed out and this phone will need a new pairing code to connect again.',
                      confirmLabel: 'Forget',
                      confirmColor: LefiColors.dangerDeep,
                    );
                    if (ok) await ref.read(brainConnectionProvider.notifier).forget();
                  },
                ),
              Text(
                pairing != null
                    ? 'Lefi Crop 0.2.0 · signed in to Lefi Brain · other screens show demo data'
                    : 'Lefi Crop 0.2.0 · demo build · data stays on the local network',
                textAlign: TextAlign.center,
                style: LefiText.body(11.5, color: LefiColors.faint),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
