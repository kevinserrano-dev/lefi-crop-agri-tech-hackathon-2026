/// Lefi AI availability as reported by the Brain (`lefi ai off` kill switch,
/// ADR-021). The app never assumes AI is available.
enum AiAvailability { online, halted, outage }

/// Scope of an emergency stop requested from mobile.
enum HaltScope { aiOnly, aiAndAutomations }

class AiStatus {
  const AiStatus.online() : availability = AiAvailability.online, scope = null, by = null, at = null, reason = null;

  const AiStatus.halted({required HaltScope this.scope, required String this.by, required String this.at, this.reason})
    : availability = AiAvailability.halted;

  const AiStatus.outage({required String this.at})
    : availability = AiAvailability.outage,
      scope = null,
      by = null,
      reason = null;

  final AiAvailability availability;
  final HaltScope? scope;
  final String? by;
  final String? at;
  final String? reason;

  bool get isOnline => availability == AiAvailability.online;
  bool get isHalted => availability == AiAvailability.halted;
}

abstract interface class AiControlRepository {
  Future<AiStatus> status();
  Future<AiStatus> halt(HaltScope scope, String by, String? reason);
  Future<AiStatus> resume(String by);
}
