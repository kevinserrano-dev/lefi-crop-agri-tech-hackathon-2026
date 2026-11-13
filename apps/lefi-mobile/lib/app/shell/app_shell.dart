import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../core/feedback/feedback.dart';
import '../../core/platform/platform_style.dart';
import '../../core/theme/lefi_colors.dart';
import '../../core/theme/lefi_text.dart';
import '../../features/alerts/application/notifications_controller.dart';
import '../../features/alerts/domain/app_notification.dart';
import '../../features/auth/application/session.dart';
import '../../features/tasks/application/tasks_controller.dart';

class _Tab {
  const _Tab(this.label, this.icon);
  final String label;
  final IconData icon;
}

const _tabs = [
  _Tab('Home', Symbols.home_rounded),
  _Tab('Tasks', Symbols.task_alt_rounded),
  _Tab('Greenhouse', Symbols.potted_plant_rounded),
  _Tab('Alerts', Symbols.notifications_rounded),
  _Tab('Profile', Symbols.person_rounded),
];

/// Bottom navigation shell. Each tab keeps its own navigation stack
/// (go_router `StatefulShellRoute.indexedStack`).
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final myOpen =
        ref.watch(tasksControllerProvider).value?.where((t) => t.assignee == user.name && t.isActive).length ?? 0;
    final unread = ref.watch(notificationsControllerProvider).value?.unread ?? 0;
    // A notification that arrives while the app is open is announced once (ADR-072); what was
    // already there when the list first loaded is only counted on the Alerts tab.
    ref.listen(notificationsControllerProvider, (prev, next) {
      final before = prev?.value?.items.map((n) => n.id).toSet();
      final now = next.value;
      if (before == null || now == null) return;
      final fresh = now.items.where((n) => !before.contains(n.id) && !now.read.contains(n.id));
      if (fresh.isEmpty) return;
      final n = fresh.first;
      final more = fresh.length > 1 ? ' (+${fresh.length - 1} more)' : '';
      ref.read(toastProvider.notifier).show('${n.title}$more', bad: n.category == NotificationCategory.critical);
    });
    final badges = [0, myOpen, 0, unread, 0];
    void go(int i) => shell.goBranch(i, initialLocation: i == shell.currentIndex);

    return Scaffold(
      backgroundColor: LefiColors.screen,
      body: shell,
      bottomNavigationBar: context.isCupertino
          ? _IosTabBar(index: shell.currentIndex, badges: badges, onTap: go)
          : _AndroidNavBar(index: shell.currentIndex, badges: badges, onTap: go),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge(this.count, {required this.ios});
  final int count;
  final bool ios;

  @override
  Widget build(BuildContext context) => Container(
    constraints: BoxConstraints(minWidth: ios ? 19 : 17),
    height: ios ? 19 : 17,
    padding: EdgeInsets.symmetric(horizontal: ios ? 5 : 4),
    decoration: BoxDecoration(
      color: ios ? LefiColors.danger : const Color(0xFFB3261E),
      borderRadius: BorderRadius.circular(10),
      border: ios ? Border.all(color: Colors.white, width: 2) : null,
    ),
    child: Center(
      widthFactor: 1,
      heightFactor: 1,
      child: Text('$count', style: LefiText.body(ios ? 11 : 10.5, weight: 800, color: Colors.white, height: 1)),
    ),
  );
}

class _IosTabBar extends StatelessWidget {
  const _IosTabBar({required this.index, required this.badges, required this.onTap});
  final int index;
  final List<int> badges;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) => Container(
    decoration: const BoxDecoration(
      color: Color(0xF7FFFFFF),
      border: Border(top: BorderSide(color: LefiColors.border)),
    ),
    padding: const EdgeInsets.fromLTRB(6, 6, 6, 0),
    child: Padding(
      // Design: 26 px below the items; on notched iPhones the home-indicator inset (34) wins.
      padding: EdgeInsets.only(bottom: math.max(26, MediaQuery.paddingOf(context).bottom - 8)),
      child: Row(
        children: [
          for (final (i, t) in _tabs.indexed)
            Expanded(
              child: Semantics(
                selected: i == index,
                button: true,
                label: t.label,
                child: InkResponse(
                  onTap: () => onTap(i),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 52),
                    child: Stack(
                      clipBehavior: Clip.none,
                      alignment: Alignment.topCenter,
                      children: [
                        Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              t.icon,
                              size: 27,
                              fill: i == index ? 1 : 0,
                              color: i == index ? LefiColors.brandDark : LefiColors.tabInactive,
                            ),
                            const SizedBox(height: 1),
                            Text(
                              t.label,
                              style: LefiText.body(
                                10.5,
                                weight: 700,
                                color: i == index ? LefiColors.brandDark : LefiColors.tabInactive,
                              ),
                            ),
                          ],
                        ),
                        if (badges[i] > 0)
                          Positioned(
                            top: -2,
                            left: 0,
                            right: 0,
                            child: Align(
                              alignment: Alignment.topCenter,
                              child: Transform.translate(
                                offset: const Offset(14, 0),
                                child: _Badge(badges[i], ios: true),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    ),
  );
}

class _AndroidNavBar extends StatelessWidget {
  const _AndroidNavBar({required this.index, required this.badges, required this.onTap});
  final int index;
  final List<int> badges;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: const Color(0xFFEEF3EF),
    child: SafeArea(
      top: false,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 78),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(4, 12, 4, 10),
          child: Row(
            children: [
              for (final (i, t) in _tabs.indexed)
                Expanded(
                  child: Semantics(
                    selected: i == index,
                    button: true,
                    label: t.label,
                    child: InkResponse(
                      onTap: () => onTap(i),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            width: 62,
                            height: 32,
                            decoration: BoxDecoration(
                              color: i == index ? LefiColors.brandPill : Colors.transparent,
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: Stack(
                              clipBehavior: Clip.none,
                              alignment: Alignment.center,
                              children: [
                                Icon(
                                  t.icon,
                                  size: 24,
                                  fill: i == index ? 1 : 0,
                                  color: i == index ? LefiColors.brandDark : LefiColors.tabInactive,
                                ),
                                if (badges[i] > 0) Positioned(top: 1, right: 10, child: _Badge(badges[i], ios: false)),
                              ],
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            t.label,
                            style: LefiText.body(
                              12,
                              weight: i == index ? 800 : 600,
                              color: i == index ? LefiColors.brandDark : LefiColors.tabInactive,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    ),
  );
}
