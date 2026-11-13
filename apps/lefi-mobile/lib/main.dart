import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'features/auth/application/session.dart';
import 'features/brain/application/brain_connection.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final container = ProviderContainer();
  // Know whether this phone is paired with Lefi Brain before the first screen (ADR-068).
  await container.read(brainConnectionProvider.future);
  // Reopening the app resumes the Lefi Brain session if it is still valid (ADR-075).
  await container.read(sessionProvider.notifier).restore();
  runApp(UncontrolledProviderScope(container: container, child: const LefiApp()));
}
