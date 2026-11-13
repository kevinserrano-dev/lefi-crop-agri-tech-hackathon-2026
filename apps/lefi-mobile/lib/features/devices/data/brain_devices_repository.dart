import '../../brain/data/brain_auth_repository.dart';
import '../domain/field_device.dart';

/// Lefi Brain's field devices and their sensors, read-only (`nav.devices`, ADR-058). The phone
/// never adds, changes or commands a device.
class BrainDevicesRepository {
  BrainDevicesRepository(this.brain);
  final BrainAuthRepository brain;

  Future<List<FieldDevice>> devices() async {
    final a = await brain.api('GET', '/field-devices');
    final list = a.body is List ? a.body! as List : const [];
    return [
      for (final d in list)
        if (d is Map<String, dynamic>) FieldDevice.fromJson(d),
    ];
  }

  Future<FieldDevice> device(String id) async {
    final a = await brain.api('GET', '/field-devices/${Uri.encodeComponent(id)}');
    return FieldDevice.fromJson(a.json);
  }
}
