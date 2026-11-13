/// This phone's pairing with one Lefi Brain (ADR-068): the gateway address, the device
/// certificate Lefi Brain issued, the CAs it pins, and the private key that never leaves
/// the phone (kept in the system's secure storage).
class BrainPairing {
  const BrainPairing({
    required this.url,
    required this.deviceId,
    required this.certPem,
    required this.caPem,
    required this.gatewayCaPem,
    required this.keyPem,
    required this.expiresAt,
  });

  /// `https://host:port` of Lefi Gateway, no trailing slash.
  final String url;
  final String deviceId;
  final String certPem;
  final String caPem;

  /// The only CA trusted for HTTPS to Lefi Gateway.
  final String gatewayCaPem;
  final String keyPem;
  final String expiresAt;

  Map<String, String> toJson() => {
    'url': url,
    'device_id': deviceId,
    'cert_pem': certPem,
    'ca_pem': caPem,
    'gateway_ca_pem': gatewayCaPem,
    'key_pem': keyPem,
    'expires_at': expiresAt,
  };

  static BrainPairing? fromJson(Map<String, dynamic> j) {
    String? s(String k) => j[k] is String && (j[k] as String).isNotEmpty ? j[k] as String : null;
    final url = s('url'), id = s('device_id'), cert = s('cert_pem'), ca = s('ca_pem');
    final gw = s('gateway_ca_pem'), key = s('key_pem');
    // A pairing without its key is useless (same rule as Lefi Desktop, ADR-053): discard it.
    if (url == null || id == null || cert == null || ca == null || gw == null || key == null) return null;
    return BrainPairing(
      url: url,
      deviceId: id,
      certPem: cert,
      caPem: ca,
      gatewayCaPem: gw,
      keyPem: key,
      expiresAt: s('expires_at') ?? '',
    );
  }
}

class BrainException implements Exception {
  const BrainException(this.message, {this.code, this.reason, this.status});
  final String message;

  /// Lefi Brain's error code (`INVALID_CREDENTIALS`, `PAIRING_REFUSED`…), when it sent one.
  final String? code;

  /// `error.details.reason` of a device-gate refusal (ADR-056).
  final String? reason;
  final int? status;

  @override
  String toString() => message;
}

/// Accepts what a person types: `lefi-main.local`, `192.168.8.10`, `https://host:8443`.
/// Only HTTPS; the gateway's port 8443 when none is given (ADR-042, ADR-055).
String parseBrainOrigin(String raw) {
  var s = raw.trim();
  if (s.isEmpty) throw const BrainException('Enter the address of Lefi Brain, like lefi-main.local.');
  if (!s.contains('://')) s = 'https://$s';
  final Uri u;
  try {
    u = Uri.parse(s);
  } on FormatException {
    throw const BrainException('That address is not valid.');
  }
  if (u.scheme != 'https') {
    throw const BrainException('Lefi Brain is reached over HTTPS only (Lefi Gateway).');
  }
  if (u.host.isEmpty || u.userInfo.isNotEmpty || (u.path.isNotEmpty && u.path != '/') || u.hasQuery) {
    throw const BrainException('Enter only the address, like lefi-main.local or 192.168.8.10.');
  }
  final port = u.hasPort ? u.port : 8443;
  final host = u.host.contains(':') ? '[${u.host}]' : u.host;
  return 'https://$host:$port';
}
