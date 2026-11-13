import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../domain/brain_pairing.dart';

const _timeout = Duration(seconds: 20);
const _userAgent = 'lefi-mobile/0.3.0';

class BrainAnswer {
  const BrainAnswer(this.status, this.body);
  final int status;
  final Object? body;

  Map<String, dynamic> get json => body is Map<String, dynamic> ? body as Map<String, dynamic> : const {};

  BrainException error(String fallback) {
    final err = json['error'];
    if (err is Map) {
      final details = err['details'];
      return BrainException(
        err['message'] is String ? err['message'] as String : fallback,
        code: err['code'] as String?,
        reason: details is Map ? details['reason'] as String? : null,
        status: status,
      );
    }
    return BrainException(fallback, status: status);
  }
}

/// HTTPS to Lefi Gateway with `dart:io` only (no proxy, LAN only).
class BrainHttp {
  BrainHttp._(this._client);
  final HttpClient _client;

  /// Pairing only: no CA is pinned yet, so the server certificate is not checked; the answer
  /// is authenticated by its HMAC instead and nothing secret is sent (ADR-048).
  factory BrainHttp.firstContact() {
    final c = HttpClient()
      ..badCertificateCallback = ((_, _, _) => true)
      ..findProxy = ((_) => 'DIRECT')
      ..connectionTimeout = const Duration(seconds: 5)
      ..userAgent = _userAgent;
    return BrainHttp._(c);
  }

  /// Every other request: trusts only the gateway CA pinned at pairing, and presents this
  /// phone's certificate (mTLS) so the device gate recognises it.
  factory BrainHttp.paired(BrainPairing p) {
    final ctx = SecurityContext(withTrustedRoots: false)
      ..setTrustedCertificatesBytes(utf8.encode(p.gatewayCaPem))
      ..useCertificateChainBytes(utf8.encode(p.certPem))
      ..usePrivateKeyBytes(utf8.encode(p.keyPem));
    final c = HttpClient(context: ctx)
      ..findProxy = ((_) => 'DIRECT')
      ..connectionTimeout = const Duration(seconds: 5)
      ..userAgent = _userAgent;
    return BrainHttp._(c);
  }

  Future<BrainAnswer> call(String method, Uri url, {Object? body, String? token}) async {
    try {
      final req = await _client.openUrl(method, url).timeout(_timeout);
      req.followRedirects = false;
      req.headers.set(HttpHeaders.acceptHeader, 'application/json');
      if (token != null) req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      if (body != null) {
        req.headers.contentType = ContentType.json;
        req.write(jsonEncode(body));
      }
      final res = await req.close().timeout(_timeout);
      final text = await res.transform(utf8.decoder).join().timeout(_timeout);
      Object? parsed;
      try {
        parsed = text.isEmpty ? null : jsonDecode(text);
      } on FormatException {
        parsed = null;
      }
      return BrainAnswer(res.statusCode, parsed);
    } on HandshakeException catch (e) {
      throw BrainException('The secure connection to Lefi Gateway failed: ${e.message}', code: 'TLS');
    } on SocketException catch (e) {
      throw BrainException(
        'Lefi Brain could not be reached (${e.osError?.message ?? e.message}).',
        code: 'UNREACHABLE',
      );
    } on TimeoutException {
      throw const BrainException('Lefi Brain did not answer in time.', code: 'UNREACHABLE');
    }
  }

  void close() => _client.close(force: true);
}
