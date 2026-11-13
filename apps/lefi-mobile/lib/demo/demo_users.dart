// DEMO FIXTURES — copied from the "Lefi Crop Mobile App" design prototype.
// These people, greenhouses and numbers are FICTIONAL. They exist only so the
// UI can be reviewed against the design before the Brain API exists. Never
// present them as real data; the app shows a DEMO DATA ribbon while they are used.
import '../shared/domain/role.dart';

/// Fixed demo clock (10:24) used by the design.
const demoNowHours = 10.4;

String demoEmail(String name) =>
    '${name.toLowerCase().replaceAll(RegExp(r'[^a-z\s-]'), '').replaceAll(RegExp(r'\s+'), '.')}@leficrop.ca';

UserProfile _u(
  Role r,
  String roleName,
  String short,
  String name,
  int color,
  String gh,
  String shift,
  double s,
  double e,
  String sup,
  List<String> zones,
) => UserProfile(
  role: r,
  roleName: roleName,
  short: short,
  name: name,
  email: demoEmail(name),
  colorValue: color,
  greenhouseScope: gh,
  shiftLabel: shift,
  shiftStartHour: s,
  shiftEndHour: e,
  reportsTo: sup,
  zones: zones,
  nextShift: r == Role.worker || r == Role.scout
      ? 'Next: Thu, Oct 29 · Evening 14:00–22:30'
      : 'Next: Thu, Oct 29 · $shift',
);

final demoUsers = <Role, UserProfile>{
  Role.manager: _u(
    Role.manager,
    'Greenhouse Manager',
    'Manager',
    'Daniel Tremblay',
    0xFF2E6B57,
    'All greenhouses · Leamington',
    'Day · 07:00–15:30',
    7,
    15.5,
    '—',
    ['All zones'],
  ),
  Role.grower: _u(
    Role.grower,
    'Grower / Crop Manager',
    'Grower',
    'Sofia Marchetti',
    0xFF3F8F5E,
    'All greenhouses',
    'Day · 06:30–15:00',
    6.5,
    15,
    'Daniel Tremblay',
    ['All zones'],
  ),
  Role.supervisor: _u(
    Role.supervisor,
    'Greenhouse Supervisor',
    'Supervisor',
    'Marcus Okafor',
    0xFF7A4A22,
    'North & South Range',
    'Day · 06:00–14:30',
    6,
    14.5,
    'Daniel Tremblay',
    ['GH-1', 'GH-2'],
  ),
  Role.scout: _u(
    Role.scout,
    'Crop Scout / Plant Health Technician',
    'Crop Scout',
    'Hana Kim',
    0xFF3C7EA6,
    'All greenhouses',
    'Day · 06:00–14:30',
    6,
    14.5,
    'Sofia Marchetti',
    ['All zones'],
  ),
  Role.maint: _u(
    Role.maint,
    'Irrigation / Maintenance Technician',
    'Maintenance',
    'Luis Ortega',
    0xFF8A6D1E,
    'All greenhouses',
    'Day · 06:00–14:30',
    6,
    14.5,
    'Marcus Okafor',
    ['All zones'],
  ),
  Role.worker: _u(
    Role.worker,
    'Greenhouse Worker',
    'Worker',
    'Amrit Gill',
    0xFF5E6B65,
    'North Range · GH-1',
    'Day · 06:00–14:30',
    6,
    14.5,
    'Marcus Okafor',
    ['GH1-Z2', 'GH1-Z3'],
  ),
};

/// Zones each role may see (access policy mirrored from the design).
bool demoZoneInScope(Role role, String zoneId, String greenhouseId) => switch (role) {
  Role.worker => zoneId == 'GH1-Z2' || zoneId == 'GH1-Z3',
  Role.supervisor => greenhouseId != 'GH-3',
  _ => true,
};
