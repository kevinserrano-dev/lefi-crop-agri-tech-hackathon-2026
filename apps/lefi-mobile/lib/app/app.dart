import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/data_source.dart';
import '../features/auth/application/session.dart';
import '../features/brain/application/brain_connection.dart';
import '../core/platform/platform_style.dart';
import '../core/theme/lefi_colors.dart';
import '../core/theme/lefi_theme.dart';
import '../core/widgets/overlays.dart';
import '../shared/domain/provenance.dart';
import 'router/app_router.dart';

class LefiApp extends ConsumerWidget {
  const LefiApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(goRouterProvider);
    // Truthfulness rule: the ribbon stays until this phone is paired with Lefi Brain or signed in
    // to it; then every tab reads Lefi Brain (ADR-100) and nothing shown is a fixture.
    final onBrain =
        ref.watch(brainConnectionProvider).value != null || (ref.watch(sessionProvider)?.fromBrain ?? false);
    final demo = ref.watch(dataSourceProvider) == DataSourceKind.demo && !onBrain;
    return MaterialApp.router(
      title: 'Lefi Crop',
      debugShowCheckedModeBanner: false,
      theme: buildLefiTheme(platform: platformOverride()),
      routerConfig: router,
      builder: (context, child) {
        Widget app = FeedbackLayer(child: child!);
        // Truthfulness rule: fixture data must never look real.
        if (demo) {
          app = Banner(
            message: 'DEMO DATA',
            location: BannerLocation.topEnd,
            color: LefiColors.simulation,
            textStyle: const TextStyle(
              fontSize: 9,
              fontWeight: FontWeight.w800,
              color: Colors.white,
              letterSpacing: .6,
            ),
            child: app,
          );
        }
        return app;
      },
    );
  }
}
