import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../core/theme/lefi_colors.dart';
import '../domain/brain_robot.dart';

/// The simulated greenhouse seen from above (ADR-091's 2D map, drawn on the phone): benches, the
/// stations a mission can go to, the path driven while this screen is open, the target and the
/// robot with its heading. y grows upwards, as in the simulator.
class RobotMap extends StatelessWidget {
  const RobotMap({super.key, required this.scene, required this.pose, required this.trail, this.targetId});
  final RobotScene scene;
  final RobotPose pose;
  final List<RobotPose> trail;
  final String? targetId;

  @override
  Widget build(BuildContext context) {
    final w = scene.xMax - scene.xMin;
    final h = scene.yMax - scene.yMin;
    return AspectRatio(
      aspectRatio: w > 0 && h > 0 ? w / h : 1.6,
      child: Semantics(
        label: 'Map of the simulated greenhouse: ${robotWhere(pose, scene)}',
        child: CustomPaint(painter: _MapPainter(scene, pose, trail, targetId)),
      ),
    );
  }
}

class _MapPainter extends CustomPainter {
  _MapPainter(this.scene, this.pose, this.trail, this.targetId);
  final RobotScene scene;
  final RobotPose pose;
  final List<RobotPose> trail;
  final String? targetId;

  @override
  void paint(Canvas canvas, Size size) {
    final sx = size.width / (scene.xMax - scene.xMin);
    final sy = size.height / (scene.yMax - scene.yMin);
    Offset p(double x, double y) => Offset((x - scene.xMin) * sx, (scene.yMax - y) * sy);

    final r = RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(14));
    canvas.drawRRect(r, Paint()..color = LefiColors.surfaceTint);
    canvas.drawRRect(
      r,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = LefiColors.border,
    );

    final bench = Paint()..color = const Color(0xFFD9C7AE);
    for (final b in scene.benches) {
      final c = p(b.x, b.y);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromCenter(center: c, width: b.length * sx, height: b.width * sy),
          const Radius.circular(4),
        ),
        bench,
      );
      _label(canvas, b.label, c, const Color(0xFF7A4A22), 9.5);
    }

    if (trail.length > 1) {
      final path = Path()..moveTo(p(trail.first.x, trail.first.y).dx, p(trail.first.x, trail.first.y).dy);
      for (final t in trail.skip(1)) {
        final o = p(t.x, t.y);
        path.lineTo(o.dx, o.dy);
      }
      canvas.drawPath(
        path,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..strokeCap = StrokeCap.round
          ..color = LefiColors.brand.withValues(alpha: .6),
      );
    }

    for (final s in scene.stations) {
      final c = p(s.x, s.y);
      final target = s.id == targetId;
      final dock = s.kind == 'dock';
      canvas.drawCircle(
        c,
        target ? 8 : 6,
        Paint()..color = dock ? const Color(0xFF3C84C0) : (target ? const Color(0xFFE0A21B) : LefiColors.leaf),
      );
      if (target) {
        canvas.drawCircle(
          c,
          12,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2
            ..color = const Color(0xFFE0A21B),
        );
      }
      _label(canvas, s.label, c + const Offset(0, 14), LefiColors.strong, 9.5);
    }

    final rc = p(pose.x, pose.y);
    final yaw = -pose.yawDeg * math.pi / 180; // canvas y points down
    canvas.drawCircle(rc, 11, Paint()..color = LefiColors.brandDark);
    final tip = rc + Offset(math.cos(yaw), math.sin(yaw)) * 17;
    canvas.drawLine(
      rc,
      tip,
      Paint()
        ..strokeWidth = 3
        ..strokeCap = StrokeCap.round
        ..color = LefiColors.brandDark,
    );
    canvas.drawCircle(rc, 4, Paint()..color = Colors.white);
  }

  void _label(Canvas canvas, String text, Offset center, Color color, double size) {
    final tp = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(fontSize: size, fontWeight: FontWeight.w700, color: color),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, center - Offset(tp.width / 2, tp.height / 2));
  }

  @override
  bool shouldRepaint(_MapPainter old) =>
      old.pose != pose || old.trail.length != trail.length || old.targetId != targetId || old.scene != scene;
}
