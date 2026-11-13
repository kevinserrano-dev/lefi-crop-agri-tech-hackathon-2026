import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/core/theme/tone.dart';
import 'package:lefi_mobile/shared/domain/role.dart';

void main() {
  test('only managers can resume AI; workers and scouts cannot stop it', () {
    expect(Role.values.where((r) => r.can(Permission.resumeAi)), [Role.manager]);
    expect(Role.worker.can(Permission.haltAi), isFalse);
    expect(Role.scout.can(Permission.haltAi), isFalse);
    expect(Role.supervisor.can(Permission.haltAi), isTrue);
  });

  test('device power cut is maintenance-only', () {
    expect(Role.values.where((r) => r.can(Permission.devicesPower)), [Role.maint]);
  });

  test('workers do not see AI insights', () {
    expect(Role.worker.can(Permission.aiInsights), isFalse);
    expect(Role.maint.can(Permission.aiInsights), isFalse);
  });

  test('health tone thresholds follow the design (85 / 70)', () {
    expect(Tone.ofHealth(85), Tone.ok);
    expect(Tone.ofHealth(84), Tone.warn);
    expect(Tone.ofHealth(70), Tone.warn);
    expect(Tone.ofHealth(69), Tone.crit);
  });
}
