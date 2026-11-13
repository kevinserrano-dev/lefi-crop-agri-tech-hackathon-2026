import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/demo_latency.dart';
import '../../../demo/demo_handover.dart';
import '../domain/handover.dart';

part 'demo_handover_repository.g.dart';

class DemoHandoverRepository implements HandoverRepository {
  @override
  Future<ShiftHandover> current() => demoDelay(() => demoHandover);

  @override
  Future<void> acknowledge(String by) => demoDelay(() {}, ms: 600);
}

@Riverpod(keepAlive: true)
HandoverRepository handoverRepository(Ref ref) => DemoHandoverRepository();
