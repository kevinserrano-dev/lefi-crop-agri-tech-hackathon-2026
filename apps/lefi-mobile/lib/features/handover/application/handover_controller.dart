import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../data/demo_handover_repository.dart';
import '../domain/handover.dart';

part 'handover_controller.g.dart';

@Riverpod(keepAlive: true)
Future<ShiftHandover> currentHandover(Ref ref) => ref.watch(handoverRepositoryProvider).current();

/// Acknowledgement line once the current user acknowledged the handover.
@Riverpod(keepAlive: true)
class HandoverAck extends _$HandoverAck {
  @override
  String? build() {
    ref.watch(sessionProvider); // reset on user change
    return null;
  }

  Future<void> acknowledge() async {
    final who = ref.read(currentUserProvider).name;
    await ref.read(handoverRepositoryProvider).acknowledge(who);
    state = 'Acknowledged by $who · 10:41';
  }
}
