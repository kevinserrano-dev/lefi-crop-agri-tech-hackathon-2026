import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

/// Pairing proofs (ADR-048, ADR-068): the same bytes as Lefi Brain's
/// `client_devices/domain.py` and Lefi Desktop's `pairing.rs`. The code is never
/// sent: the app proves it knows it with an HMAC over its CSR, and Lefi Brain
/// answers with an HMAC over everything the app will keep and pin.
const _crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const codeChars = 12;
final _label = ascii.encode('LEFIPAIR1');

/// What a person types → the 12-character code, or null. Spaces/dashes and case
/// are ignored; O→0, I/L→1 (Crockford).
String? normaliseCode(String raw) {
  final s = raw
      .trim()
      .toUpperCase()
      .replaceAll('-', '')
      .replaceAll(' ', '')
      .replaceAll('O', '0')
      .replaceAll('I', '1')
      .replaceAll('L', '1');
  if (s.length != codeChars || s.split('').any((c) => !_crockford.contains(c))) return null;
  return s;
}

Uint8List proofKey(String code) =>
    Uint8List.fromList(sha256.convert([..._label, ...ascii.encode('|key|'), ...ascii.encode(code)]).bytes);

String _sha256Hex(List<int> data) => sha256.convert(data).toString();

String requestProof(List<int> key, List<int> csrDer) =>
    Hmac(sha256, key).convert([..._label, ...ascii.encode('|req|'), ...ascii.encode(_sha256Hex(csrDer))]).toString();

String responseProof(List<int> key, String deviceId, String certPem, String caPem, String gatewayCaPem) {
  final parts = [
    deviceId,
    _sha256Hex(utf8.encode(certPem)),
    _sha256Hex(utf8.encode(caPem)),
    _sha256Hex(utf8.encode(gatewayCaPem)),
  ].join('|');
  return Hmac(sha256, key).convert([..._label, ...ascii.encode('|res|'), ...utf8.encode(parts)]).toString();
}

/// Constant-time comparison of two hex proofs.
bool sameProof(String a, String b) {
  final x = ascii.encode(a.trim().toLowerCase());
  final y = ascii.encode(b.trim().toLowerCase());
  if (x.length != y.length) return false;
  var diff = 0;
  for (var i = 0; i < x.length; i++) {
    diff |= x[i] ^ y[i];
  }
  return diff == 0;
}
