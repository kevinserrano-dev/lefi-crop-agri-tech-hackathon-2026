import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'feedback.g.dart';

class ToastMessage {
  const ToastMessage(this.text, {this.bad = false});
  final String text;
  final bool bad;
}

/// Transient bottom toast (design: dark pill above the tab bar, 2.8 s).
@Riverpod(keepAlive: true)
class Toast extends _$Toast {
  Timer? _timer;

  @override
  ToastMessage? build() {
    ref.onDispose(() => _timer?.cancel());
    return null;
  }

  void show(String text, {bool bad = false}) {
    _timer?.cancel();
    state = ToastMessage(text, bad: bad);
    _timer = Timer(const Duration(milliseconds: 2800), () => state = null);
  }
}

/// Blocking "working…" overlay while an operation runs.
@Riverpod(keepAlive: true)
class Busy extends _$Busy {
  @override
  String? build() => null;

  Future<T> run<T>(String label, Future<T> Function() action) async {
    state = label;
    try {
      return await action();
    } finally {
      state = null;
    }
  }
}
