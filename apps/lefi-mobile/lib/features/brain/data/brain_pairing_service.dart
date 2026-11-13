import '../domain/brain_pairing.dart';
import 'brain_http.dart';
import 'device_key.dart';
import 'pairing_proofs.dart';

/// Pairs this phone with Lefi Brain through Lefi Gateway with a pairing code (ADR-048, ADR-068).
/// Same protocol as Lefi Desktop: `POST /api/v1/devices/pair` with an HMAC over the CSR; the
/// answer is accepted only when its HMAC matches, then the gateway CA it names is pinned.
class BrainPairingService {
  const BrainPairingService([this._firstContact]);
  final BrainHttp Function()? _firstContact;

  Future<BrainPairing> pair({required String address, required String code, required String deviceName}) async {
    final origin = parseBrainOrigin(address);
    final c = normaliseCode(code);
    if (c == null) {
      throw const BrainException('That code is not complete: it has 12 letters and digits, like ABCD-EFGH-JKMN.');
    }
    final key = proofKey(c);
    final device = DeviceKey.generate(deviceName);
    final http = (_firstContact ?? BrainHttp.firstContact)();
    final BrainAnswer a;
    try {
      a = await http.call(
        'POST',
        Uri.parse('$origin/api/v1/devices/pair'),
        body: {
          'csr_pem': device.csrPem,
          'proof': requestProof(key, device.csrDer),
          'device_name': deviceName,
          'platform': 'mobile',
        },
      );
    } finally {
      http.close();
    }
    if (a.status != 200) {
      final e = a.error('Lefi Brain answered ${a.status}.');
      throw switch (e.code) {
        'PAIRING_REFUSED' => const BrainException(
          'Lefi Brain refused this code: it is wrong, used or expired. Create a new one in Lefi Crop Helper.',
          code: 'PAIRING_REFUSED',
        ),
        'PAIRING_THROTTLED' => const BrainException(
          'Too many wrong codes. Wait a few minutes, then try again.',
          code: 'PAIRING_THROTTLED',
        ),
        _ => e,
      };
    }
    final j = a.json;
    String s(String k) => j[k] is String ? j[k] as String : '';
    final id = s('device_id'), cert = s('cert_pem'), ca = s('ca_pem'), gw = s('gateway_ca_pem');
    if (id.isEmpty || cert.isEmpty || ca.isEmpty || gw.isEmpty) {
      throw const BrainException('That address did not answer like Lefi Brain.');
    }
    if (!sameProof(responseProof(key, id, cert, ca, gw), s('proof'))) {
      // Something between the phone and the main PC changed the answer, or it is not our Brain.
      throw const BrainException(
        'The answer could not be verified with this code. Nothing was saved. '
        'Check that this phone is on the greenhouse Wi-Fi and try again.',
        code: 'PROOF_MISMATCH',
      );
    }
    return BrainPairing(
      url: origin,
      deviceId: id,
      certPem: cert,
      caPem: ca,
      gatewayCaPem: gw,
      keyPem: device.keyPem,
      expiresAt: s('expires_at'),
    );
  }
}

/// One sentence per device-gate refusal reason (ADR-056), as Lefi Desktop says it.
String deviceRefusal(String? reason) => switch (reason) {
  'revoked' => 'An administrator removed this phone from Lefi Brain. Forget this Lefi Brain and pair again.',
  'replaced' => 'This phone was paired again; this older pairing no longer works. Forget it and pair again.',
  'expired' => 'This phone’s certificate has ended. Forget this Lefi Brain and pair again.',
  'unknown_certificate' =>
    'Lefi Brain does not know this phone (it was installed again or this is another installation). '
        'Forget this Lefi Brain and pair again.',
  'no_certificate' =>
    'Lefi Gateway did not pass on this phone’s certificate. On the main PC, run setup again in Lefi Crop Helper.',
  'not_through_gateway' => 'This address goes to Lefi Brain without Lefi Gateway. Use the gateway address (port 8443).',
  _ => 'Lefi Brain refused this phone. Forget this Lefi Brain and pair again.',
};
