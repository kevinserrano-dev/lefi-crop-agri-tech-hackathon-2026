import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../core/platform/platform_style.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/media.dart';
import '../../tasks/application/tasks_controller.dart';

enum CameraPurpose {
  task('Task evidence', 'Hold steady · good light'),
  inspection('Inspection photo', 'Fill the frame with the leaf, 20–30 cm away'),
  report('Issue photo', 'Hold steady · good light');

  const CameraPurpose(this.label, this.hint);
  final String label;
  final String hint;
}

/// Capture screen. The device camera plugin is not wired yet: this is the
/// design's viewfinder with a placeholder preview, and the returned id refers to
/// a demo photo — nothing is presented as a real image.
class CameraScreen extends ConsumerStatefulWidget {
  const CameraScreen({super.key, required this.purpose});
  final CameraPurpose purpose;

  @override
  ConsumerState<CameraScreen> createState() => _CameraScreenState();
}

class _CameraScreenState extends ConsumerState<CameraScreen> {
  bool _shot = false;

  Widget _round(IconData icon, {VoidCallback? onTap, double size = 44, double iconSize = 24}) => Material(
    color: const Color(0x1FFFFFFF),
    shape: const CircleBorder(),
    child: InkWell(
      customBorder: const CircleBorder(),
      onTap: onTap,
      child: SizedBox(
        width: size,
        height: size,
        child: Icon(icon, color: Colors.white, size: iconSize),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final ios = context.isCupertino;
    return AnnotatedRegion(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: LefiColors.cameraBg,
        body: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 6, 16, 12),
                child: Row(
                  children: [
                    _round(Symbols.close_rounded, onTap: () => Navigator.pop(context)),
                    Expanded(
                      child: Text(
                        widget.purpose.label,
                        textAlign: TextAlign.center,
                        style: LefiText.body(14, weight: 700, color: Colors.white),
                      ),
                    ),
                    _round(Symbols.flash_auto_rounded, iconSize: 22),
                  ],
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: StripedPlaceholder(
                    a: const Color(0xFF21402F),
                    b: const Color(0xFF264837),
                    stripe: 16,
                    radius: 0,
                    child: Stack(
                      children: [
                        // Rule-of-thirds grid
                        for (final f in [1 / 3, 2 / 3]) ...[
                          Positioned.fill(
                            child: FractionallySizedBox(
                              alignment: Alignment.centerLeft,
                              widthFactor: f,
                              child: const DecoratedBox(
                                decoration: BoxDecoration(
                                  border: Border(right: BorderSide(color: Color(0x2EFFFFFF))),
                                ),
                              ),
                            ),
                          ),
                          Positioned.fill(
                            child: FractionallySizedBox(
                              alignment: Alignment.topCenter,
                              heightFactor: f,
                              child: const DecoratedBox(
                                decoration: BoxDecoration(
                                  border: Border(bottom: BorderSide(color: Color(0x2EFFFFFF))),
                                ),
                              ),
                            ),
                          ),
                        ],
                        Center(
                          child: Container(
                            width: 150,
                            height: 150,
                            decoration: BoxDecoration(
                              border: Border.all(color: const Color(0xFFFFD27A), width: 2),
                              borderRadius: BorderRadius.circular(14),
                            ),
                          ),
                        ),
                        Positioned(
                          left: 12,
                          bottom: 12,
                          right: 12,
                          child: Align(
                            alignment: Alignment.centerLeft,
                            child: ImageLabel(
                              'CAMERA VIEWFINDER · ${widget.purpose.hint} · DEMO',
                              fontSize: 10.5,
                              dark: true,
                              background: const Color(0x73000000),
                            ),
                          ),
                        ),
                        if (_shot)
                          Positioned.fill(
                            child: ColoredBox(
                              color: const Color(0x1FFFFFFF),
                              child: Center(
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                                  decoration: BoxDecoration(
                                    color: const Color(0x99000000),
                                    borderRadius: BorderRadius.circular(999),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Icon(Symbols.check_circle_rounded, size: 20, color: LefiColors.brand),
                                      const SizedBox(width: 6),
                                      Text(
                                        'Photo captured',
                                        style: LefiText.body(14, weight: 700, color: Colors.white),
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
                ),
              ),
              SizedBox(
                height: 126,
                child: _shot
                    ? Padding(
                        padding: const EdgeInsets.fromLTRB(20, 0, 20, 0),
                        child: Row(
                          children: [
                            Expanded(
                              child: LefiOutlineButton(
                                label: 'Retake',
                                height: 54,
                                background: Colors.transparent,
                                borderColor: const Color(0x4DFFFFFF),
                                foreground: Colors.white,
                                onPressed: () => setState(() => _shot = false),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              flex: 13,
                              child: LefiButton(
                                label: 'Use photo',
                                fontSize: 15,
                                background: LefiColors.brand,
                                foreground: LefiColors.brandDeep,
                                onPressed: () =>
                                    Navigator.pop(context, ref.read(photoSequenceProvider.notifier).next()),
                              ),
                            ),
                          ],
                        ),
                      )
                    : Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 30),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceAround,
                          children: [
                            Container(
                              width: 48,
                              height: 48,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: const Color(0x4DFFFFFF), width: 2),
                              ),
                              child: const StripedPlaceholder.dark(stripe: 6, radius: 10),
                            ),
                            Semantics(
                              button: true,
                              label: 'Take photo',
                              child: GestureDetector(
                                onTap: () => setState(() => _shot = true),
                                child: Container(
                                  width: 78,
                                  height: 78,
                                  padding: const EdgeInsets.all(5),
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    border: Border.all(color: Colors.white, width: 4),
                                  ),
                                  child: const DecoratedBox(
                                    decoration: BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                                  ),
                                ),
                              ),
                            ),
                            _round(
                              ios ? Symbols.flip_camera_ios_rounded : Symbols.flip_camera_android_rounded,
                              size: 48,
                            ),
                          ],
                        ),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
