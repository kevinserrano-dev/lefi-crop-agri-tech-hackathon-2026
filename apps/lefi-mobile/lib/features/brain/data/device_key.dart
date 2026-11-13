import 'dart:convert';
import 'dart:typed_data';

import 'package:basic_utils/basic_utils.dart';

/// A new ECDSA P-256 key for this phone and its certificate request (PKCS#10), as Lefi Brain
/// asks (ADR-048). The private key stays on the phone; only the CSR is sent.
class DeviceKey {
  const DeviceKey({required this.keyPem, required this.csrPem, required this.csrDer});
  final String keyPem;
  final String csrPem;
  final Uint8List csrDer;

  static DeviceKey generate(String deviceName) {
    while (true) {
      final pair = CryptoUtils.generateEcKeyPair(curve: 'prime256v1');
      final priv = pair.privateKey as ECPrivateKey;
      final pub = pair.publicKey as ECPublicKey;
      // SEC1 needs the private scalar as exactly 32 bytes; this encoder writes it without
      // leading zeros, so a shorter one (about 1 in 256 keys) is simply drawn again.
      if ((priv.d!.bitLength + 7) ~/ 8 != 32) continue;
      final cn = deviceName.replaceAll(RegExp(r'[^A-Za-z0-9 ._-]'), '').trim();
      final csrPem = X509Utils.generateEccCsrPem({'CN': cn.isEmpty ? 'Lefi Crop mobile' : cn}, priv, pub);
      return DeviceKey(keyPem: CryptoUtils.encodeEcPrivateKeyToPem(priv), csrPem: csrPem, csrDer: _der(csrPem));
    }
  }

  static Uint8List _der(String pem) {
    // The encoder writes CRLF line ends: every kind of line end and blank is dropped.
    final body = const LineSplitter()
        .convert(pem)
        .map((l) => l.trim())
        .where((l) => l.isNotEmpty && !l.startsWith('-----'))
        .join();
    return base64.decode(body);
  }
}
