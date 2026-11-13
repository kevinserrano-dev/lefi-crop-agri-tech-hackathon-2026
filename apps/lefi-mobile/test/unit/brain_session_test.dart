import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/auth/domain/auth_repository.dart';
import 'package:lefi_mobile/features/brain/data/brain_auth_repository.dart';
import 'package:lefi_mobile/features/brain/data/brain_http.dart';
import 'package:lefi_mobile/features/brain/data/session_store.dart';
import 'package:lefi_mobile/features/brain/domain/brain_pairing.dart';
import 'package:lefi_mobile/shared/domain/role.dart';

const _paired = BrainPairing(
  url: 'https://lefi-main.local:8443',
  deviceId: '11111111-2222-3333-4444-555555555555',
  certPem: 'TEST',
  caPem: 'TEST',
  gatewayCaPem: 'TEST',
  keyPem: 'TEST',
  expiresAt: '2027-11-10T00:00:00Z',
);

Map<String, dynamic> _session({bool mustChange = false, String? token}) => {
  'user': {'username': 'fake.grower', 'display_name': 'Fake Grower'},
  'role': {'id': 'grower', 'name': 'Grower', 'short': 'GR'},
  'permissions': ['nav.dashboard'],
  'must_change_password': mustChange,
  'token': ?token,
};

/// Answers by path; records the token each request carried. Test only.
class _FakeHttp implements BrainHttp {
  _FakeHttp(this.answers);
  final Map<String, BrainAnswer Function()> answers;
  final List<(String, String?)> calls = [];

  @override
  Future<BrainAnswer> call(String method, Uri url, {Object? body, String? token}) async {
    final path = url.path.replaceFirst('/api/v1', '');
    calls.add((path, token));
    final a = answers[path];
    if (a == null) throw const BrainException('unreachable (test)', code: 'UNREACHABLE');
    return a();
  }

  @override
  void close() {}
}

BrainAuthRepository _repo(_FakeHttp http, SessionStore store) =>
    BrainAuthRepository(_paired, http: (_) => http, sessions: store);

BrainAnswer _unauthorised() => const BrainAnswer(401, {
  'error': {'code': 'UNAUTHENTICATED', 'message': 'Not signed in.', 'details': {}},
});

void main() {
  group('the Lefi Brain session survives closing the app (ADR-075)', () {
    test('signing in keeps the token; the next launch resumes it with /auth/session', () async {
      final store = MemorySessionStore();
      await _repo(
        _FakeHttp({'/auth/login': () => BrainAnswer(200, _session(token: 'tok-1'))}),
        store,
      ).signIn('fake.grower', 'secret-pass');
      expect(store.token, 'tok-1');

      final http = _FakeHttp({'/auth/session': () => BrainAnswer(200, _session())});
      final next = _repo(http, store);
      final user = await next.resume();
      expect(user?.name, 'Fake Grower');
      expect(user?.role, Role.grower);
      expect(next.permissions, ['nav.dashboard']);
      expect(http.calls.single, ('/auth/session', 'tok-1'));
    });

    test('a session Lefi Brain refuses is forgotten', () async {
      final store = MemorySessionStore('old');
      final user = await _repo(_FakeHttp({'/auth/session': _unauthorised}), store).resume();
      expect(user, isNull);
      expect(store.token, isNull);
    });

    test('offline at launch: not signed in, but the token is kept for later', () async {
      final store = MemorySessionStore('tok-1');
      expect(await _repo(_FakeHttp({}), store).resume(), isNull);
      expect(store.token, 'tok-1');
    });

    test('a forced password change is never kept as a session', () async {
      final store = MemorySessionStore();
      final repo = _repo(
        _FakeHttp({'/auth/login': () => BrainAnswer(200, _session(mustChange: true, token: 't'))}),
        store,
      );
      await expectLater(repo.signIn('fake.grower', 'secret-pass'), throwsA(isA<PasswordChangeRequired>()));
      expect(store.token, isNull);
    });

    test('signing out forgets it', () async {
      final store = MemorySessionStore();
      final repo = _repo(
        _FakeHttp({
          '/auth/login': () => BrainAnswer(200, _session(token: 'tok-1')),
          '/auth/logout': () => const BrainAnswer(200, null),
        }),
        store,
      );
      await repo.signIn('fake.grower', 'secret-pass');
      await repo.signOut();
      expect(store.token, isNull);
    });

    test('a session that ends while in use sends the person back to sign in', () async {
      final store = MemorySessionStore();
      var ended = false;
      final repo = _repo(
        _FakeHttp({'/auth/login': () => BrainAnswer(200, _session(token: 'tok-1')), '/overview': _unauthorised}),
        store,
      )..onSessionEnded = () => ended = true;
      await repo.signIn('fake.grower', 'secret-pass');
      await expectLater(repo.api('GET', '/overview'), throwsA(isA<AuthException>()));
      expect(ended, isTrue);
      expect(store.token, isNull);
    });

    test('a device refusal is not taken for an ended session', () async {
      final store = MemorySessionStore();
      var ended = false;
      final repo = _repo(
        _FakeHttp({
          '/auth/login': () => BrainAnswer(200, _session(token: 'tok-1')),
          '/overview': () => const BrainAnswer(401, {
            'error': {
              'code': 'DEVICE_REFUSED',
              'message': 'refused',
              'details': {'reason': 'revoked'},
            },
          }),
        }),
        store,
      )..onSessionEnded = () => ended = true;
      await repo.signIn('fake.grower', 'secret-pass');
      await expectLater(repo.api('GET', '/overview'), throwsA(isA<AuthException>()));
      expect(ended, isFalse);
      expect(store.token, 'tok-1');
    });
  });
}
