/// Artificial latency for demo repositories so loading states are exercised.
Future<T> demoDelay<T>(T Function() value, {int ms = 320}) => Future<T>.delayed(Duration(milliseconds: ms), value);
