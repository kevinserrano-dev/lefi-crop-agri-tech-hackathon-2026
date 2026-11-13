import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';

/// Load the real bundled fonts so widget tests measure text like the app does.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  for (final (family, file) in [
    ('Manrope', 'assets/fonts/Manrope-Variable.ttf'),
    ('Outfit', 'assets/fonts/Outfit-Variable.ttf'),
    ('JetBrainsMono', 'assets/fonts/JetBrainsMono-Variable.ttf'),
  ]) {
    final loader = FontLoader(family)..addFont(Future.value(ByteData.sublistView(File(file).readAsBytesSync())));
    await loader.load();
  }
  await testMain();
}
