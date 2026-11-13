import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/router/routes.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/overlays.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/rows.dart';
import '../../../core/widgets/scaffolds.dart';
import '../../alerts/presentation/brain_report_sheet.dart';
import '../../alerts/application/brain_alerts.dart';
import '../../auth/application/session.dart';
import '../../brain/application/brain_connection.dart';
import '../../devices/application/devices_providers.dart';
import '../../assistant/application/brain_chat.dart';
import '../../ai_control/application/brain_ai_control.dart';
import '../../handover/application/brain_handover.dart';
import '../../handover/domain/brain_handover.dart';
import '../../tasks/presentation/brain_task_sheets.dart';
import '../application/brain_profile.dart';
import '../data/brain_profile_repository.dart';

/// Version shown in the footer (pubspec `version`).
const mobileVersion = '0.3.0';

/// The Profile tab on Lefi Brain (ADR-100): who is signed in, their own shifts from the roster,
/// their notification preference, and this phone's connection. No sample data.
class BrainProfileView extends ConsumerWidget {
  const BrainProfileView({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final u = ref.watch(currentUserProvider);
    final pairing = ref.watch(brainConnectionProvider).value;
    final shifts = ref.watch(myShiftsProvider);
    final level = ref.watch(notificationLevelProvider);
    final devices = ref.watch(brainDevicesRepositoryProvider) != null;
    final canReport = ref.watch(brainReporterProvider) != null;
    final handover = ref.watch(brainHandoverRepositoryProvider) != null;
    final handoverNow = handover ? ref.watch(brainHandoverCurrentProvider).value?.handover : null;
    final chat = ref.watch(brainChatRepositoryProvider) != null;
    final aiControl = ref.watch(brainAiControlRepositoryProvider) != null;
    final aiNow = aiControl ? ref.watch(brainAiControlProvider).value : null;

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

    return Padding(
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
          switch (shifts) {
            AsyncData(:final value) => _ShiftCard(value),
            AsyncError(:final error) => InfoNote(text: 'Shifts could not be read: ${brainError(error)}'),
            _ => const SizedBox(height: 120, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
          },
          if (shifts.value case final s? when s.onCall)
            InfoNote(
              text: s.onCallPrimaryToday
                  ? 'You are the primary on call today: critical alerts reach you outside your shift.'
                  : 'You are in the on-call roster. Managers change it in Lefi Desktop.',
              icon: Symbols.support_agent_rounded,
              background: Tone.crit.bg,
              foreground: Tone.crit.fg,
              fontWeight: 600,
            ),
          _NotificationCard(level),
          CardList(
            children: [
              if (devices)
                menuRow(
                  Symbols.device_hub_rounded,
                  'Devices & health',
                  sub: 'Boards, sensors and their data',
                  onTap: () => context.pushDetail<void>(Routes.devices),
                ),
              if (handover)
                menuRow(
                  Symbols.sync_alt_rounded,
                  'Shift handover',
                  sub: switch (handoverNow) {
                    final h? => '${h.shift} · ${handoverStatusLabel(h.status).toLowerCase()}',
                    null => 'Facts of the shift, sign and acknowledge',
                  },
                  trailing: switch (handoverNow?.status) {
                    'open' => const ToneChip('To sign', tone: Tone.warn),
                    'signed' => const ToneChip('New', tone: Tone.crit),
                    'acknowledged' => const ToneChip('Acknowledged', tone: Tone.ok),
                    _ => null,
                  },
                  onTap: () => context.pushHandover(),
                ),
              if (chat)
                menuRow(
                  Symbols.chat_rounded,
                  'Ask Lefi',
                  sub: 'Lefi AI answers from Lefi Brain’s data your role can see',
                  onTap: () => context.pushChat(),
                ),
              if (aiControl)
                menuRow(
                  Symbols.shield_rounded,
                  'AI control & safety',
                  sub: switch (aiNow) {
                    final a? when a.stopped => 'Lefi AI is stopped',
                    final a? when a.available => 'Lefi AI available · emergency stop',
                    final _? => 'Lefi AI unavailable',
                    null => 'Lefi AI’s state and the emergency stop',
                  },
                  trailing: switch (aiNow) {
                    final a? when a.stopped => const ToneChip('Stopped', tone: Tone.crit),
                    final a? when !a.available => const ToneChip('Unavailable', tone: Tone.warn),
                    _ => null,
                  },
                  onTap: () => context.pushAiControl(),
                ),
              if (canReport)
                menuRow(
                  Symbols.report_rounded,
                  'Report an issue',
                  sub: 'Becomes an alert for the people who handle them',
                  onTap: () => showBrainReportSheet(context),
                ),
              menuRow(
                Symbols.language_rounded,
                'Language',
                trailing: Text('English', style: LefiText.body(14, color: LefiColors.subtle)),
              ),
              menuRow(
                Symbols.thermostat_rounded,
                'Units',
                trailing: Text('As Lefi Brain sends them', style: LefiText.body(14, color: LefiColors.subtle)),
                last: true,
              ),
            ],
          ),
          if (pairing != null)
            LefiCard(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
              child: Column(
                children: [
                  KeyValueRow('Connected to', 'Lefi Brain'),
                  KeyValueRow('Address', pairing.url),
                  KeyValueRow('This phone', pairing.deviceId.split('-').first, last: true),
                ],
              ),
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
                body: 'This phone stops receiving Lefi Brain’s notifications until you sign in again.',
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
            'Lefi Crop $mobileVersion · connected to Lefi Brain on the local network',
            textAlign: TextAlign.center,
            style: LefiText.body(11.5, color: LefiColors.faint),
          ),
        ],
      ),
    );
  }
}

class _ShiftCard extends StatelessWidget {
  const _ShiftCard(this.s);
  final MyShifts? s;

  String _left(Duration d) => '${d.inHours} h ${(d.inMinutes % 60).toString().padLeft(2, '0')} m';

  @override
  Widget build(BuildContext context) {
    final s = this.s;
    if (s == null) {
      return const InfoNote(
        text: 'This Lefi Brain does not share your shifts with the phone yet. Updating Lefi Brain adds it.',
        icon: Symbols.update_rounded,
      );
    }
    final now = DateTime.now();
    final on = s.now;
    final next = s.nextShift(now);
    final pct = on == null || s.nowStart == null || s.nowEnd == null
        ? 0.0
        : (now.difference(s.nowStart!).inSeconds / s.nowEnd!.difference(s.nowStart!).inSeconds).clamp(0.0, 1.0);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: LefiColors.brandDark, borderRadius: BorderRadius.circular(20)),
      child: Gap(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(on == null ? 'SHIFTS' : 'CURRENT SHIFT', style: LefiText.overline(color: LefiColors.mint)),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                decoration: BoxDecoration(color: const Color(0x4054B985), borderRadius: BorderRadius.circular(7)),
                child: Text(
                  on == null ? (s.days.firstOrNull?.leave ?? false ? 'On leave' : 'Off shift') : 'On shift',
                  style: LefiText.body(12, weight: 800, color: const Color(0xFFBFF0D3)),
                ),
              ),
            ],
          ),
          Text(
            on == null
                ? (next == null ? 'No shift in the next 7 days' : 'Next: ${next.shift!.name}')
                : '${on.name} · ${on.start}–${on.end}',
            style: LefiText.outfit(22, color: Colors.white),
          ),
          if (on != null) ...[
            LefiProgress(value: pct, track: LefiColors.heroTrack),
            Text(
              '${_left(s.nowEnd!.difference(now))} remaining',
              style: LefiText.body(12.5, color: LefiColors.mintSoft),
            ),
          ] else if (next != null)
            Text(
              '${next.label} · ${next.shift!.start}–${next.shift!.end}',
              style: LefiText.body(12.5, color: LefiColors.mintSoft),
            ),
          const SizedBox(height: 2),
          Row(
            children: [
              for (final d in s.days)
                Expanded(
                  child: Container(
                    margin: const EdgeInsets.symmetric(horizontal: 2),
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    decoration: BoxDecoration(
                      color: d.today ? const Color(0x3354B985) : const Color(0x14FFFFFF),
                      borderRadius: BorderRadius.circular(9),
                    ),
                    child: Column(
                      children: [
                        Text(
                          d.label.split(' ').first,
                          style: LefiText.body(10.5, weight: 700, color: LefiColors.mintSoft),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          d.leave ? 'Leave' : (d.shift == null ? 'Off' : d.shift!.start),
                          style: LefiText.body(10.5, weight: 800, color: Colors.white),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
          Text('Greenhouse time · ${s.timezone}', style: LefiText.body(11.5, color: LefiColors.mintSoft)),
        ],
      ),
    );
  }
}

class _NotificationCard extends ConsumerWidget {
  const _NotificationCard(this.level);
  final AsyncValue<String> level;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = level.value;
    return LefiCard(
      child: Gap(
        gap: 8,
        children: [
          Row(
            children: [
              const Icon(Symbols.notifications_active_rounded, size: 22, color: LefiColors.leaf),
              const SizedBox(width: 10),
              Expanded(child: Text('Notifications', style: LefiText.body(15, weight: 800))),
            ],
          ),
          Text(
            'Which alerts reach you in this app. Assignments to you, and alerts you can see becoming critical, '
            'always arrive unless off. '
            'No push to a closed app: they arrive while it is open and connected.',
            style: LefiText.body(12.5, color: LefiColors.subtle, height: 1.4),
          ),
          if (level.hasError) Text(brainError(level.error!), style: LefiText.body(12.5, color: LefiColors.dangerDeep)),
          for (final l in notificationLevels)
            InkWell(
              borderRadius: BorderRadius.circular(10),
              onTap: current == null || current == l
                  ? null
                  : () async {
                      final ok = await runBrain(
                        ref,
                        'Saving…',
                        () => ref.read(brainProfileRepositoryProvider)!.setNotificationLevel(l),
                        done: 'Notifications: ${notificationLevelLabel(l).toLowerCase()}.',
                      );
                      if (ok) ref.invalidate(notificationLevelProvider);
                    },
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 2),
                child: Row(
                  children: [
                    Container(
                      width: 22,
                      height: 22,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: current == l ? LefiColors.brandDark : LefiColors.checkboxBorder,
                          width: 2,
                        ),
                      ),
                      child: Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: current == l ? LefiColors.brandDark : Colors.transparent,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text(notificationLevelLabel(l), style: LefiText.body(14.5, weight: 600)),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
