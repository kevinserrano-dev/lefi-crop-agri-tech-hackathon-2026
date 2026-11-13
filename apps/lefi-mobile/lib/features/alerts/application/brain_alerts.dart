import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../auth/application/session.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../data/brain_alert_repository.dart';
import '../domain/brain_alert.dart';

part 'brain_alerts.g.dart';

/// How often an open Alerts tab asks Lefi Brain again (no WebSocket yet).
const brainAlertsPoll = Duration(seconds: 15);

/// Lefi Brain's alerts when signed in to it with `nav.alerts`; null on demo data or without it.
@Riverpod(keepAlive: true)
BrainAlertRepository? brainAlertRepository(Ref ref) {
  final auth = ref.watch(activeAuthRepositoryProvider);
  ref.watch(sessionProvider); // permissions change with who is signed in
  if (auth is! BrainAuthRepository || !auth.permissions.contains('nav.alerts')) return null;
  return BrainAlertRepository(auth);
}

/// Lefi Brain, when the signed-in person may report an issue (`incident.report`: every role).
@Riverpod(keepAlive: true)
BrainAuthRepository? brainReporter(Ref ref) {
  final auth = ref.watch(activeAuthRepositoryProvider);
  ref.watch(sessionProvider);
  if (auth is! BrainAuthRepository || !auth.can('incident.report')) return null;
  return auth;
}

/// [status]: active · resolved · all
@riverpod
Future<BrainAlertList> brainAlerts(Ref ref, String status) async {
  final repo = ref.watch(brainAlertRepositoryProvider);
  if (repo == null) throw StateError('Not connected to Lefi Brain.');
  final timer = Timer(brainAlertsPoll, ref.invalidateSelf);
  ref.onDispose(timer.cancel);
  return repo.list(status: status);
}

@riverpod
Future<BrainAlert> brainAlertDetail(Ref ref, String id) async {
  final repo = ref.watch(brainAlertRepositoryProvider);
  if (repo == null) throw StateError('Not connected to Lefi Brain.');
  return repo.detail(id);
}
