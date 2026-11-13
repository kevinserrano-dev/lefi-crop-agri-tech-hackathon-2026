import '../../brain/data/brain_auth_repository.dart';
import '../domain/brain_handover.dart';

/// The shift handover through Lefi Gateway (ADR-095): reading `nav.handover`, signing and asking
/// Lefi AI again `handover.sign`, acknowledging `handover.ack` (never by who signed).
class BrainHandoverRepository {
  BrainHandoverRepository(this.brain);
  final BrainAuthRepository brain;

  String get userId => brain.userId;
  String get roleId => brain.roleId;

  Future<HandoverView> current() async => HandoverView.fromJson((await brain.api('GET', '/handover/current')).json);

  Future<List<BrainHandover>> recent({int limit = 10}) async {
    final body = (await brain.api('GET', '/handovers?limit=$limit')).body;
    return [
      for (final h in body is List ? body : const [])
        if (h is Map<String, dynamic>) BrainHandover.fromJson(h),
    ];
  }

  Map<String, dynamic> _note(String? n) => {'note': n == null || n.trim().isEmpty ? null : n.trim()};

  Future<BrainHandover> sign(String id, String? note) async =>
      BrainHandover.fromJson((await brain.api('POST', '/handovers/$id/sign', body: _note(note))).json);

  Future<BrainHandover> acknowledge(String id, String? note) async =>
      BrainHandover.fromJson((await brain.api('POST', '/handovers/$id/acknowledge', body: _note(note))).json);

  /// Lefi AI writes the summary again from the facts of now (only while open).
  Future<BrainHandover> rewriteSummary(String id) async =>
      BrainHandover.fromJson((await brain.api('POST', '/handovers/$id/summary')).json);
}
