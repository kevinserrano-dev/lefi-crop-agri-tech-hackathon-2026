import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/lefi_colors.dart';
import '../theme/lefi_text.dart';

/// Diagonal-striped block standing in for an image (exactly like the design's
/// `repeating-linear-gradient(135deg, …)` placeholders). Used until real photos
/// arrive from cameras; it never pretends to be a photo.
class StripedPlaceholder extends StatelessWidget {
  const StripedPlaceholder({
    super.key,
    this.a = LefiColors.photoA,
    this.b = LefiColors.photoB,
    this.stripe = 8,
    this.radius = 12,
    this.child,
    this.aspectRatio,
    this.height,
    this.width,
  });

  const StripedPlaceholder.dark({Key? key, double stripe = 8, double radius = 12, Widget? child, double? aspectRatio})
    : this(
        key: key,
        a: LefiColors.photoDarkA,
        b: LefiColors.photoDarkB,
        stripe: stripe,
        radius: radius,
        child: child,
        aspectRatio: aspectRatio,
      );

  final Color a;
  final Color b;

  /// Width of one stripe in logical pixels (the CSS colour-stop length).
  final double stripe;
  final double radius;
  final Widget? child;
  final double? aspectRatio;
  final double? height;
  final double? width;

  @override
  Widget build(BuildContext context) {
    Widget box = ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: CustomPaint(painter: _StripePainter(a, b, stripe), child: child ?? const SizedBox.expand()),
    );
    if (aspectRatio != null) box = AspectRatio(aspectRatio: aspectRatio!, child: box);
    if (height != null || width != null) box = SizedBox(height: height, width: width, child: box);
    return box;
  }
}

class _StripePainter extends CustomPainter {
  _StripePainter(this.a, this.b, this.stripe);
  final Color a;
  final Color b;
  final double stripe;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = a);
    final p = Paint()..color = b;
    // 135° gradient: stripes run perpendicular to the top-left → bottom-right axis.
    final period = stripe * 2;
    final diag = size.width + size.height;
    canvas.save();
    canvas.clipRect(Offset.zero & size);
    for (double d = 0; d < diag * math.sqrt2; d += period) {
      final off = d + stripe; // second colour starts after the first stop
      final path = Path()
        ..moveTo(off * math.sqrt2, 0)
        ..lineTo((off + stripe) * math.sqrt2, 0)
        ..lineTo((off + stripe) * math.sqrt2 - diag, diag)
        ..lineTo(off * math.sqrt2 - diag, diag)
        ..close();
      canvas.drawPath(path, p);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_StripePainter old) => old.a != a || old.b != b || old.stripe != stripe;
}

/// Small monospace caption on a translucent white chip (image labels).
class ImageLabel extends StatelessWidget {
  const ImageLabel(this.text, {super.key, this.fontSize = 10, this.dark = false, this.background});
  final String text;
  final double fontSize;
  final bool dark;
  final Color? background;

  @override
  Widget build(BuildContext context) => Container(
    padding: EdgeInsets.symmetric(horizontal: fontSize * .6, vertical: fontSize * .2),
    decoration: BoxDecoration(
      color: background ?? (dark ? const Color(0x80000000) : const Color(0xD1FFFFFF)),
      borderRadius: BorderRadius.circular(4),
    ),
    child: Text(text, style: LefiText.mono(fontSize, color: dark ? LefiColors.mintSoft : LefiColors.photoLabel)),
  );
}

/// Simple sparkline path (design `pth` helper).
class Sparkline extends StatelessWidget {
  const Sparkline({
    super.key,
    required this.values,
    this.color = const Color(0xFF2E9A63),
    this.aspect = 300 / 56,
    this.strokeWidth = 2.5,
  });
  final List<double> values;
  final Color color;
  final double aspect;
  final double strokeWidth;

  @override
  Widget build(BuildContext context) => AspectRatio(
    aspectRatio: aspect,
    child: CustomPaint(painter: _SparkPainter(values, color, strokeWidth)),
  );
}

class _SparkPainter extends CustomPainter {
  _SparkPainter(this.v, this.color, this.w);
  final List<double> v;
  final Color color;
  final double w;

  @override
  void paint(Canvas canvas, Size size) {
    if (v.length < 2) return;
    final lo = v.reduce(math.min) - 3, hi = v.reduce(math.max) + 3;
    final path = Path();
    for (var i = 0; i < v.length; i++) {
      final x = i / (v.length - 1) * size.width;
      final y = size.height - (v[i] - lo) / (hi - lo) * size.height;
      i == 0 ? path.moveTo(x, y) : path.lineTo(x, y);
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = w * size.width / 300
        ..strokeJoin = StrokeJoin.round
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  bool shouldRepaint(_SparkPainter old) => old.v != v;
}
