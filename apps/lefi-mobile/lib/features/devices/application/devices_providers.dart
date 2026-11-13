import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../data/brain_devices_repository.dart';
import '../domain/field_device.dart';

part 'devices_providers.g.dart';

/// Devices refresh while their screen is open (no WebSocket yet). Telemetry arrives at 1 Hz.
const devicesPoll = Duration(seconds: 10);
const devicePoll = Duration(seconds: 3);

/// Lefi Brain's devices when signed in to it with `nav.devices`; null otherwise.
@Riverpod(keepAlive: true)
BrainDevicesRepository? brainDevicesRepository(Ref ref) {
  final auth = ref.watch(activeAuthRepositoryProvider);
  ref.watch(sessionProvider); // permissions change with who is signed in
  if (auth is! BrainAuthRepository || !auth.permissions.contains('nav.devices')) return null;
  return BrainDevicesRepository(auth);
}

@riverpod
Future<List<FieldDevice>> fieldDevices(Ref ref) async {
  final repo = ref.watch(brainDevicesRepositoryProvider);
  if (repo == null) throw StateError('Devices & health needs Lefi Brain and a role that sees devices.');
  final timer = Timer(devicesPoll, ref.invalidateSelf);
  ref.onDispose(timer.cancel);
  return repo.devices();
}

@riverpod
Future<FieldDevice> fieldDevice(Ref ref, String id) async {
  final repo = ref.watch(brainDevicesRepositoryProvider);
  if (repo == null) throw StateError('Devices & health needs Lefi Brain and a role that sees devices.');
  final timer = Timer(devicePoll, ref.invalidateSelf);
  ref.onDispose(timer.cancel);
  return repo.device(id);
}
