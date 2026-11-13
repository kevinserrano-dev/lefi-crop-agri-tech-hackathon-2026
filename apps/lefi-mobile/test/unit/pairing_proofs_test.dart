import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/brain/data/device_key.dart';
import 'package:lefi_mobile/features/brain/data/pairing_proofs.dart';

/// Vectors computed with Lefi Brain's own Python functions
/// (`lefi_brain.modules.client_devices.domain`): the app and Lefi Brain must agree byte for byte.
void main() {
  test('codes are read as a person types them', () {
    expect(normaliseCode('abcd-efgh-jkmn'), 'ABCDEFGHJKMN');
    expect(normaliseCode('o1il-abcd-efgh'), '0111ABCDEFGH');
    expect(normaliseCode('ABCD-EFGH'), isNull);
    expect(normaliseCode('ABCD-EFGH-JKMU'), isNull); // U is not Crockford
  });

  test('proofs match Lefi Brain', () {
    final key = proofKey('ABCDEFGHJKMN');
    expect(hex(key), '084e917b7c7d1786c421fab3ab3215c836392ba3616b27bd4d6726c76e646d5b');
    expect(
      requestProof(key, [0x30, 0x03, 0x02, 0x01, 0x01]),
      'bd75abe5d50159b4b2d3666d9412122d898d27a5fed851c6e88bc9246f90811a',
    );
    expect(
      responseProof(key, '11111111-2222-3333-4444-555555555555', 'CERT', 'CA', 'GW'),
      '0dbe752ef24d2fa229da83a7a7eb3b2b703c887b822c5eb86e945d647a2d5841',
    );
    expect(sameProof('ABCDEF', 'abcdef'), isTrue);
    expect(sameProof('abcdef', 'abcde0'), isFalse);
  });

  test('a new device key has a P-256 CSR whose DER is decoded whole (CRLF PEM)', () {
    final k = DeviceKey.generate('TEST phone');
    expect(k.csrPem, startsWith('-----BEGIN CERTIFICATE REQUEST-----'));
    expect(k.keyPem, contains('EC PRIVATE KEY'));
    expect(k.csrDer.first, 0x30); // an ASN.1 SEQUENCE
    // The DER's own length header matches the bytes decoded (nothing lost or added).
    final d = k.csrDer;
    final len = switch (d[1]) {
      0x81 => d[2] + 3,
      0x82 => (d[2] << 8 | d[3]) + 4,
      _ => d[1] + 2,
    };
    expect(k.csrDer.length, len);
  });
}

String hex(List<int> bytes) => bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
