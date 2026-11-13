import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/router/routes.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/scaffolds.dart';
import '../application/brain_greenhouse.dart';

/// A plant's NFC tag opened the app (`leficrop://lefi/plant/<id or code>`, ADR-109). Lefi Brain is
/// asked for the plant first; only a plant it has opens. An unknown id, or Lefi Brain not answering,
/// shows one plain screen: the plant cannot be found right now, try again later.
class PlantTagScreen extends ConsumerStatefulWidget {
  const PlantTagScreen({super.key, required this.plantRef});
  final String plantRef;

  @override
  ConsumerState<PlantTagScreen> createState() => _PlantTagScreenState();
}

class _PlantTagScreenState extends ConsumerState<PlantTagScreen> {
  bool _went = false;

  void _open(String id) {
    _went = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.go(Routes.greenhouse);
      context.push('${Routes.greenhouse}/plant/$id');
    });
  }

  @override
  Widget build(BuildContext context) {
    // Without Lefi Brain (demo data) a tag finds nothing: never a made-up plant.
    if (ref.watch(brainGreenhouseRepositoryProvider) == null) return const PlantNotFound(canRetry: false);
    final p = brainPlantByRefProvider(widget.plantRef);
    final async = ref.watch(p);
    // An error first (Riverpod keeps retrying, so a failed lookup is also "loading").
    if (async.hasError) return PlantNotFound(onRetry: () => ref.invalidate(p));
    if (!async.hasValue) {
      return const _Shell(child: Center(child: CircularProgressIndicator(strokeWidth: 2)));
    }
    final plant = async.value;
    if (plant == null) return PlantNotFound(onRetry: () => ref.invalidate(p));
    if (!_went) _open(plant.id);
    return const _Shell(child: Center(child: CircularProgressIndicator(strokeWidth: 2)));
  }
}

/// "We can't find this plant right now" — for an unknown tag or when Lefi Brain does not answer.
class PlantNotFound extends StatelessWidget {
  const PlantNotFound({super.key, this.onRetry, this.canRetry = true});
  final VoidCallback? onRetry;
  final bool canRetry;

  @override
  Widget build(BuildContext context) => _Shell(
    child: Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset('assets/brand/mascot-sad.png', width: 132),
            const SizedBox(height: 18),
            Text('We can’t find this plant right now', textAlign: TextAlign.center, style: LefiText.outfit(22)),
            const SizedBox(height: 8),
            Text(
              'Please try again later.',
              textAlign: TextAlign.center,
              style: LefiText.body(15, color: LefiColors.muted, height: 1.45),
            ),
            const SizedBox(height: 24),
            if (canRetry && onRetry != null) ...[
              LefiButton(label: 'Try again', icon: Symbols.refresh_rounded, onPressed: onRetry),
              const SizedBox(height: 10),
            ],
            LefiOutlineButton(
              label: 'Go to Greenhouse',
              icon: Symbols.yard_rounded,
              onPressed: () => context.go(Routes.greenhouse),
            ),
          ],
        ),
      ),
    ),
  );
}

class _Shell extends StatelessWidget {
  const _Shell({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: LefiColors.screen,
    body: PushedScreen(title: 'Plant tag', backLabel: 'Home', onBack: () => context.go(Routes.home), body: child),
  );
}
