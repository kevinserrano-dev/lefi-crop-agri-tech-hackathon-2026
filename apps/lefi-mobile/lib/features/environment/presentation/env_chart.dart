import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../core/theme/lefi_colors.dart';

/// A variable's history as a line (bucket averages, gaps where no reading was stored) over the band
/// of the range that applies. Draws only what Lefi Brain sent: no smoothing, no filled gaps.
class EnvChart extends StatelessWidget {
  const EnvChart({super.key, required this.values, this.min, this.max, this.height = 120});
  final List<double?> values;
  final double? min;
  final double? max;
  final double height;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: height,
    width: double.infinity,
    child: CustomPaint(painter: _Painter(values, min, max)),
  );
}

class _Painter extends CustomPainter {
  _Painter(this.values, this.min, this.max);
  final List<double?> values;
  final double? min;
  final double? max;

  @override
  void paint(Canvas canvas, Size size) {
    final pts = [for (final v in values) ?v];
    if (pts.isEmpty || values.length < 2) return;
    var lo = [...pts, ?min, ?max].reduce(math.min);
    var hi = [...pts, ?min, ?max].reduce(math.max);
    if (hi - lo < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    final pad = (hi - lo) * .08;
    lo -= pad;
    hi += pad;
    double y(double v) => size.height - (v - lo) / (hi - lo) * size.height;
    double x(int i) => i / (values.length - 1) * size.width;

    if (min != null || max != null) {
      final top = y(max ?? hi);
      final bottom = y(min ?? lo);
      canvas.drawRect(Rect.fromLTRB(0, top, size.width, bottom), Paint()..color = LefiColors.brandTint);
      final edge = Paint()
        ..color = LefiColors.brandBorder
        ..strokeWidth = 1;
      if (max != null) canvas.drawLine(Offset(0, top), Offset(size.width, top), edge);
      if (min != null) canvas.drawLine(Offset(0, bottom), Offset(size.width, bottom), edge);
    }

    final line = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..strokeJoin = StrokeJoin.round
      ..strokeCap = StrokeCap.round
      ..color = LefiColors.leaf;
    final dot = Paint()..color = LefiColors.leaf;
    Path? path;
    for (var i = 0; i < values.length; i++) {
      final v = values[i];
      if (v == null) {
        if (path != null) canvas.drawPath(path, line);
        path = null;
        continue;
      }
      final o = Offset(x(i), y(v));
      final alone = (i == 0 || values[i - 1] == null) && (i == values.length - 1 || values[i + 1] == null);
      if (alone) canvas.drawCircle(o, 2.2, dot);
      if (path == null) {
        path = Path()..moveTo(o.dx, o.dy);
      } else {
        path.lineTo(o.dx, o.dy);
      }
    }
    if (path != null) canvas.drawPath(path, line);
  }

  @override
  bool shouldRepaint(_Painter old) => old.values != values || old.min != min || old.max != max;
}
