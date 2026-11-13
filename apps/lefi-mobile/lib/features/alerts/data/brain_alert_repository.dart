import '../../brain/data/brain_auth_repository.dart';
import '../domain/brain_alert.dart';

/// Lefi Brain's alerts and incidents through Lefi Gateway (ADR-068, 071). Lefi Brain checks
/// `nav.alerts`, `incident.ack` and `incident.resolve` on every request.
class BrainAlertRepository {
  BrainAlertRepository(this.brain);
  final BrainAuthRepository brain;

  /// [status]: active · resolved · all
  Future<BrainAlertList> list({String status = 'active'}) async {
    final a = await brain.api('GET', '/alerts?status=$status&limit=100');
    return BrainAlertList.fromJson(a.json);
  }

  Future<BrainAlert> detail(String id) async {
    final a = await brain.api('GET', '/alerts/$id');
    return BrainAlert.fromJson(a.json);
  }

  Future<BrainAlert> acknowledge(String id) async {
    final a = await brain.api('POST', '/alerts/$id/acknowledge');
    return BrainAlert.fromJson(a.json);
  }

  Future<BrainAlert> resolve(String id, {String? note}) async {
    final a = await brain.api(
      'POST',
      '/alerts/$id/resolve',
      body: {'note': note?.trim().isEmpty ?? true ? null : note!.trim()},
    );
    return BrainAlert.fromJson(a.json);
  }
}
