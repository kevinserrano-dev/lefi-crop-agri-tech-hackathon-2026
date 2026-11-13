/// User roles available on mobile (field operations).
///
/// The canonical RBAC matrix lives in the Brain API; the app mirrors it only to
/// adapt the UI. Hiding a control is never authorisation (see safety rules).
enum Role { manager, grower, supervisor, scout, maint, worker }

/// Capabilities the mobile UI adapts to.
enum Permission {
  haltAi, // emergency stop for Lefi AI
  resumeAi,
  devices,
  devicesAi,
  devicesPower,
  registerDevices,
  onCall,
  team,
  inspect,
  aiInsights,
  camera,
  ackIncidents,
  allZones,
}

const _matrix = <Permission, Set<Role>>{
  Permission.haltAi: {Role.manager, Role.grower, Role.supervisor, Role.maint},
  Permission.resumeAi: {Role.manager},
  Permission.devices: {Role.manager, Role.grower, Role.supervisor, Role.maint},
  Permission.devicesAi: {Role.manager, Role.maint},
  Permission.devicesPower: {Role.maint},
  Permission.registerDevices: {Role.manager, Role.maint},
  Permission.onCall: {Role.manager, Role.grower, Role.supervisor, Role.maint},
  Permission.team: {Role.manager, Role.supervisor},
  Permission.inspect: {Role.grower, Role.supervisor, Role.scout},
  Permission.aiInsights: {Role.manager, Role.grower, Role.supervisor, Role.scout},
  Permission.camera: {Role.manager, Role.grower, Role.supervisor, Role.scout, Role.maint},
  Permission.ackIncidents: {Role.manager, Role.grower, Role.supervisor, Role.maint},
  Permission.allZones: {Role.manager, Role.grower, Role.scout, Role.maint},
};

extension RolePermissions on Role {
  bool can(Permission p) => _matrix[p]!.contains(this);
}

/// Static description of a signed-in user (from the identity service).
class UserProfile {
  const UserProfile({
    required this.role,
    required this.roleName,
    required this.short,
    required this.name,
    required this.email,
    required this.colorValue,
    required this.greenhouseScope,
    required this.shiftLabel,
    required this.shiftStartHour,
    required this.shiftEndHour,
    required this.reportsTo,
    required this.zones,
    required this.nextShift,
    this.fromBrain = false,
  });

  final Role role;
  final String roleName;
  final String short;
  final String name;
  final String email;
  final int colorValue;
  final String greenhouseScope;
  final String shiftLabel;
  final double shiftStartHour;
  final double shiftEndHour;
  final String reportsTo;
  final List<String> zones;
  final String nextShift;

  /// Signed in to the real Lefi Brain (ADR-068). Shift, zones and reporting line are then
  /// unknown (Lefi Brain has no shifts yet) and are not shown.
  final bool fromBrain;

  String get firstName => name.split(' ').first;
  String get initials =>
      name.split(RegExp(r'[\s-]+')).where((w) => w.isNotEmpty).take(2).map((w) => w[0]).join().toUpperCase();
}
