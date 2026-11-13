import 'package:flutter/widgets.dart';

/// Rounded-rectangle dashed border (CSS `border-style: dashed`).
class DashedBorder extends StatelessWidget {
  const DashedBorder({
    super.key,
    required this.child,
    required this.color,
    this.radius = 12,
    this.width = 1.5,
    this.dash = 6,
    this.gap = 4,
  });
  final Widget child;
  final Color color;
  final double radius;
  final double width;
  final double dash;
  final double gap;

  @override
  Widget build(BuildContext context) => CustomPaint(
    foregroundPainter: _DashedPainter(color, radius, width, dash, gap),
    child: ClipRRect(borderRadius: BorderRadius.circular(radius), child: child),
  );
}

class _DashedPainter extends CustomPainter {
  _DashedPainter(this.color, this.radius, this.width, this.dash, this.gap);
  final Color color;
  final double radius;
  final double width;
  final double dash;
  final double gap;

  @override
  void paint(Canvas canvas, Size size) {
    final r = RRect.fromRectAndRadius((Offset.zero & size).deflate(width / 2), Radius.circular(radius - width / 2));
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = width;
    for (final m in (Path()..addRRect(r)).computeMetrics()) {
      for (double d = 0; d < m.length; d += dash + gap) {
        canvas.drawPath(m.extractPath(d, d + dash), paint);
      }
    }
  }

  @override
  bool shouldRepaint(_DashedPainter o) => o.color != color || o.radius != radius;
}
