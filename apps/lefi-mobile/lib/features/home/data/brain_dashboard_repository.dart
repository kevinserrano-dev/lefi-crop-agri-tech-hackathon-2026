import '../../../shared/domain/glyph.dart';
import '../../../shared/domain/role.dart';
import '../../auth/domain/auth_repository.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../../tasks/domain/task.dart';
import '../domain/dashboard.dart';
import '../domain/dashboard_repository.dart';

/// Said on a Lefi Brain home when its tasks could not be read (no `nav.tasks`, or refused).
const tasksUnavailable = 'Tasks could not be read from Lefi Brain.';
const dashboardNotAllowed =
    'Your role does not see the greenhouse overview. Alerts addressed to you are in the Alerts tab.';

int _i(Object? v) => v is num ? v.toInt() : 0;
Map<String, dynamic> _m(Object? v) => v is Map<String, dynamic> ? v : const {};
List<Map<String, dynamic>> _l(Object? v) => [
  for (final x in v is List ? v : const [])
    if (x is Map<String, dynamic>) x,
];
String _s(Object? v, [String fallback = '']) => v is String ? v : fallback;

String _hm(String iso) {
  final t = DateTime.tryParse(iso)?.toLocal();
  if (t == null) return '—';
  String two(int v) => v.toString().padLeft(2, '0');
  return '${two(t.hour)}:${two(t.minute)}';
}

String _when(String iso, DateTime now) {
  final t = DateTime.tryParse(iso)?.toLocal();
  if (t == null) return '—';
  final sameDay = t.year == now.year && t.month == now.month && t.day == now.day;
  return sameDay ? _hm(iso) : '${t.day}/${t.month} ${_hm(iso)}';
}

String _plural(int n, String one, [String? many]) => '$n ${n == 1 ? one : (many ?? '${one}s')}';

const _alertsTab = TabTarget('alerts');
const _brainOnly = PlannedTarget('This detail on the phone');

// ---------------------------------------------------------------- rows

DashboardRow _alertRow(Map<String, dynamic> a, DateTime now) {
  final crit = a['severity'] == 'critical';
  final status = _s(a['status']);
  final simulated = a['origin'] == 'SIMULATED';
  return DashboardRow(
    glyph: crit ? Glyph.incident : Glyph.warning,
    severity: crit ? Severity.crit : Severity.warn,
    title: _s(a['title'], 'Alert'),
    sub: [
      _s(a['subject']),
      _when(_s(a['updated_at']), now),
      if (simulated) 'SIMULATED',
    ].where((x) => x.isNotEmpty).join(' · '),
    chip: switch (status) {
      'open' => crit ? 'Critical' : 'Warning',
      'acknowledged' => 'Ack’d',
      _ => status,
    },
    chipSeverity: status == 'acknowledged' ? Severity.ok : (crit ? Severity.crit : Severity.warn),
    target: _alertsTab,
  );
}

Glyph _readingGlyph(String variable) => switch (variable) {
  final v when v.contains('temp') => Glyph.temperature,
  final v when v.contains('humid') => Glyph.humidity,
  final v when v.contains('ec') || v.contains('tds') => Glyph.ec,
  final v when v.contains('moist') || v.contains('water') => Glyph.moisture,
  final v when v.contains('ph') => Glyph.lab,
  _ => Glyph.devices,
};

/// One enabled sensor. Provenance first: LIVE, SIMULATED, STALE, ERROR or NO DATA (ADR-012, 059).
DashboardRow readingRow(Map<String, dynamic> r) {
  final state = _s(r['state']);
  final simulated = r['origin'] == 'SIMULATED';
  final values = _l(r['values']);
  final shown = [
    for (final v in values)
      if (v['value'] != null) '${v['value']} ${_s(v['unit'])}'.trim(),
  ];
  final (chip, sev) = switch (state) {
    'receiving' when simulated => ('SIMULATED', Severity.ai),
    'receiving' => ('LIVE', Severity.ok),
    'not_receiving' => ('STALE', Severity.warn),
    'error' => ('ERROR', Severity.crit),
    _ => ('NO DATA', Severity.off),
  };
  return DashboardRow(
    glyph: values.isEmpty ? Glyph.devices : _readingGlyph(_s(values.first['variable'])),
    severity: sev,
    title: shown.isEmpty ? _s(r['sensor'], 'Sensor') : '${_s(r['sensor'])} · ${shown.join(' · ')}',
    sub: [_s(r['device']), _s(r['place'])].where((x) => x.isNotEmpty).join(' · '),
    chip: chip,
    chipSeverity: sev,
    target: _brainOnly,
  );
}

DashboardRow _observationRow(Map<String, dynamic> o, DateTime now) {
  final health = _s(o['health']);
  final sev = switch (health) {
    'healthy' => Severity.ok,
    'watch' => Severity.warn,
    'problem' => Severity.crit,
    _ => Severity.info,
  };
  final issues = [for (final i in o['issues'] is List ? o['issues'] as List : const []) i.toString()];
  return DashboardRow(
    glyph: Glyph.humanCheck,
    severity: sev,
    title: '${_s(o['plant'], '?')} · ${health.isEmpty ? 'observed' : health}',
    sub: [
      if (issues.isNotEmpty) issues.join(', '),
      'by ${_s(o['by'], 'unknown person')}',
      _when(_s(o['at']), now),
    ].join(' · '),
    chip: 'Human',
    chipSeverity: Severity.ok,
    target: _brainOnly,
  );
}

/// One task from `/tasks` (ADR-093) → a home row that opens it.
DashboardRow taskRow(Map<String, dynamic> t, DateTime now) {
  final priority = _s(t['priority'], 'normal');
  final status = _s(t['status'], 'open');
  final sev = switch (priority) {
    'urgent' => Severity.crit,
    'high' => Severity.warn,
    _ => Severity.info,
  };
  final due = DateTime.tryParse(_s(t['due_at']))?.toLocal();
  final overdue = due != null && due.isBefore(now) && (status == 'open' || status == 'in_progress');
  return DashboardRow(
    glyph: t['source'] == 'ai' ? Glyph.aiFinding : Glyph.task,
    severity: overdue ? Severity.crit : sev,
    title: _s(t['title'], 'Task'),
    sub: [
      _s(t['number']),
      _s(t['zone']),
      if (due != null) overdue ? 'overdue' : 'due ${_when(_s(t['due_at']), now)}',
      if (t['origin'] == 'SIMULATED') 'SIMULATED',
    ].where((x) => x.isNotEmpty).join(' · '),
    chip: switch (status) {
      'open' => 'Open',
      'in_progress' => 'In progress',
      'awaiting' => 'To verify',
      _ => status,
    },
    chipSeverity: status == 'awaiting' ? Severity.warn : (status == 'in_progress' ? Severity.info : Severity.off),
    target: TaskTarget(_s(t['id'])),
  );
}

/// The tasks a person calls "mine" (assigned to them, or unassigned for their role), to do first.
List<Map<String, dynamic>> myTasks(Map<String, dynamic> list, String userId, String roleId) => [
  for (final t in _l(list['tasks']))
    if (t['assigned_to'] == userId || (t['assigned_to'] == null && t['assignee'] != 'robot' && t['for_role'] == roleId))
      t,
];

/// The home's tasks: the person's own, and for who sees every task the team's to verify.
({List<DashboardSection> sections, Kpi kpi, QuickAction action}) _tasksPart(
  Map<String, dynamic> list,
  UserProfile user,
  String userId,
  String roleId,
  DateTime now,
) {
  final counts = _m(list['counts']);
  final mine = myTasks(list, userId, roleId).where((t) => t['status'] != 'awaiting').toList();
  final toVerify = list['can_verify'] == true
      ? _l(list['tasks']).where((t) => t['status'] == 'awaiting').toList()
      : const <Map<String, dynamic>>[];
  return (
    sections: [
      DashboardSection('My tasks', [for (final t in mine.take(6)) taskRow(t, now)]),
      if (toVerify.isNotEmpty) DashboardSection('Work to verify', [for (final t in toVerify.take(6)) taskRow(t, now)]),
    ],
    kpi: Kpi(
      '${_i(counts['open']) + _i(counts['in_progress'])}',
      'Tasks to do',
      '${_i(counts['awaiting'])} to verify · ${_i(counts['urgent'])} urgent',
    ),
    action: QuickAction(
      mine.isEmpty ? 'Tasks' : 'Tasks · ${mine.length}',
      Glyph.task,
      TabTarget('tasks', teamScope: list['can_see_all'] == true && user.role != Role.worker && mine.isEmpty),
    ),
  );
}

DashboardRow _zoneRow(Map<String, dynamic> z) {
  final status = _s(z['status']);
  final active = status == 'active';
  return DashboardRow(
    glyph: Glyph.plant,
    severity: active ? Severity.ok : Severity.off,
    title: _s(z['name'], 'Zone'),
    sub: '${_s(z['greenhouse'])} · ${_plural(_i(z['plants']), 'plant')} · ${_plural(_i(z['active_crops']), 'crop')}',
    chip: status.isEmpty ? '—' : status[0].toUpperCase() + status.substring(1),
    chipSeverity: active ? Severity.ok : Severity.off,
    target: _brainOnly,
  );
}

DashboardRow _cropRow(Map<String, dynamic> c) => DashboardRow(
  glyph: Glyph.plant,
  severity: Severity.ok,
  title: _s(c['crop'], 'Crop'),
  sub: _plural(_i(c['assignments']), 'assignment'),
  chip: _plural(_i(c['plants']), 'plant'),
  chipSeverity: Severity.info,
  target: _brainOnly,
);

// ---------------------------------------------------------------- dashboard

/// Lefi Brain's `/overview` (ADR-070) → the home for this person's role. Nothing is invented:
/// what Lefi Brain does not hold is listed in [Dashboard.unavailable].
///
/// [tasks] is Lefi Brain's `/tasks` answer; null when it could not be read.
Dashboard dashboardFromOverview(
  Map<String, dynamic> o,
  UserProfile user, {
  DateTime? now,
  Map<String, dynamic>? tasks,
  String userId = '',
  String roleId = '',
  bool canReport = false,
  bool canHandover = false,
}) {
  final today = now ?? DateTime.now();
  final work = tasks == null ? null : _tasksPart(tasks, user, userId, roleId, today);
  final places = _m(o['places']);
  final health = _m(o['plant_health']);
  final devices = _m(o['devices']);
  final alerts = _m(o['alerts']);
  final ai = _m(o['ai']);
  final people = _m(o['people']);
  final sensors = _m(devices['sensors']);
  final readings = _l(o['readings']);

  final plants = _i(health['plants']);
  final healthy = _i(health['healthy']);
  final watch = _i(health['watch']);
  final problem = _i(health['problem']);
  final notChecked = _i(health['not_checked']);
  final openRequests = _i(health['open_requests']);
  final active = _i(alerts['active']);
  final critical = _i(alerts['critical']);
  final warning = _i(alerts['warning']);
  final unack = _i(alerts['unacknowledged']);
  final total = _i(devices['total']);
  final online = _i(devices['online']);
  final offline = _i(devices['offline']);
  final never = _i(devices['never_connected']);
  final pending = _i(devices['pending']);
  final sensorErrors = _i(sensors['error']);
  final sensorStale = _i(sensors['not_receiving']);

  final alertRows = [for (final a in _l(alerts['latest'])) _alertRow(a, today)];
  final readingRows = [for (final r in readings) readingRow(r)];
  final anomalyRows = [
    for (final r in readings)
      if (r['state'] != 'receiving') readingRow(r),
  ];
  final observationRows = [for (final x in _l(health['recent'])) _observationRow(x, today)];
  final zoneRows = [for (final z in _l(o['zones'])) _zoneRow(z)];
  final cropRows = [for (final c in _l(o['crops'])) _cropRow(c)];

  final vision = _m(health['vision']);
  final unavailable = <String>[
    if (vision['available'] == false) 'AI vision: ${_s(vision['reason'], 'not available')}',
    if (work == null) tasksUnavailable,
  ];

  final healthHero = DashboardHero(
    label: 'Plant health · recorded by people',
    value: '$healthy',
    unit: 'of ${_plural(plants, 'plant')} healthy',
    sub: '$watch watch · $problem problem · $notChecked not checked',
    progress: plants == 0 ? 0 : healthy / plants,
    chips: [
      if (critical > 0) HeroChip('$critical critical', Severity.crit),
      if (warning > 0) HeroChip('$warning warning', Severity.warn),
      if (active == 0) const HeroChip('No active alerts', Severity.ok),
      HeroChip('$online of $total devices online', online == total ? Severity.ok : Severity.warn),
    ],
  );

  const alertsAction = QuickAction('Alerts', Glyph.notifications, _alertsTab);

  final dash = switch (user.role) {
    Role.manager => Dashboard(
      hero: healthHero,
      quickActions: const [alertsAction],
      sections: [
        DashboardSection('Active alerts', alertRows),
        DashboardSection('Zones', zoneRows),
        DashboardSection('Crops', cropRows),
      ],
      kpis: [
        Kpi(
          '${_i(places['greenhouses'])} · ${_i(places['zones'])}',
          'Greenhouses · zones',
          _plural(_i(places['locations']), 'growing location'),
        ),
        Kpi(
          '${_i(places['crop_plants'])}',
          'Plants in crops',
          _plural(_i(places['active_crops']), 'active crop assignment'),
        ),
        Kpi('$online / $total', 'Devices online', '$offline offline · $never never connected'),
        Kpi(
          '${_i(people['signed_in_now'])}',
          'Signed in now',
          'of ${_plural(_i(people['active_users']), 'active user')}',
        ),
      ],
    ),
    Role.grower => Dashboard(
      hero: healthHero,
      quickActions: const [alertsAction],
      sections: [
        DashboardSection('Active alerts', alertRows),
        DashboardSection('Current readings', readingRows),
        DashboardSection('Latest observations', observationRows),
        DashboardSection('Crops', cropRows),
      ],
    ),
    Role.supervisor => Dashboard(
      hero: DashboardHero(
        label: 'Active alerts',
        value: '$active',
        unit: active == 1 ? 'alert' : 'alerts',
        sub: '$unack not acknowledged · ${_s(alerts['monitor_reason'], 'rules engine status unknown')}',
        progress: active == 0 ? 1 : (active - unack) / active,
        chips: [
          if (critical > 0) HeroChip('$critical critical', Severity.crit),
          if (warning > 0) HeroChip('$warning warning', Severity.warn),
          HeroChip('${_i(people['signed_in_now'])} signed in', Severity.info),
        ],
      ),
      quickActions: const [alertsAction],
      sections: [
        DashboardSection('Active alerts', alertRows),
        DashboardSection('Sensors needing attention', anomalyRows),
        DashboardSection('Zones', zoneRows),
      ],
    ),
    Role.scout => Dashboard(
      hero: DashboardHero(
        label: 'Inspection requests',
        value: '$openRequests',
        unit: 'open',
        sub: '${_plural(notChecked, 'plant')} not checked yet · $watch watch · $problem problem',
        progress: plants == 0 ? 0 : (plants - notChecked) / plants,
      ),
      quickActions: const [alertsAction],
      sections: [
        DashboardSection('Latest observations', observationRows),
        DashboardSection('Active alerts', alertRows),
      ],
    ),
    Role.maint => Dashboard(
      hero: DashboardHero(
        label: 'Equipment status',
        value: '$online',
        unit: 'of ${_plural(total, 'device')} online',
        sub:
            '$offline offline · $never never connected · $pending pending'
            ' · ${_plural(sensorErrors, 'sensor error')} · $sensorStale stale',
        progress: total == 0 ? 0 : online / total,
      ),
      quickActions: const [alertsAction],
      sections: [
        DashboardSection('Sensor anomalies', anomalyRows),
        DashboardSection('Active alerts', alertRows),
        DashboardSection('Current readings', readingRows),
      ],
    ),
    // Workers do not see the overview (nav.dashboard); see [BrainDashboardRepository].
    Role.worker => Dashboard(
      hero: healthHero,
      quickActions: const [alertsAction],
      sections: [DashboardSection('Active alerts', alertRows)],
    ),
  };

  return Dashboard(
    hero: dash.hero,
    quickActions: [
      ?work?.action,
      ...dash.quickActions,
      if (canHandover) const QuickAction('Handover', Glyph.handover, HandoverTarget()),
    ],
    sections: [
      // Alerts stay first; the person's tasks come right after.
      ...dash.sections.take(1),
      ...?work?.sections,
      ...dash.sections.skip(1),
    ],
    kpis: [...dash.kpis, if (work != null && dash.kpis.isNotEmpty) work.kpi],
    showReportIssue: canReport,
    source: DashboardSource(label: 'Lefi Brain', at: _hm(_s(o['brain_time']))),
    ai: DashboardAi(
      available: ai['state'] == 'available' && ai['kill_switch'] != true,
      state: _s(ai['state'], 'unknown'),
      reason: _s(ai['reason']),
      model: ai['model'] as String?,
      stopped: ai['kill_switch'] == true,
    ),
    unavailable: unavailable,
  );
}

/// A person whose role has no `nav.dashboard` (workers): their tasks, no overview, no sample data.
Dashboard dashboardWithoutOverview(
  DateTime now, {
  UserProfile? user,
  Map<String, dynamic>? tasks,
  String userId = '',
  String roleId = '',
  bool canReport = false,
}) {
  String two(int v) => v.toString().padLeft(2, '0');
  final work = tasks == null || user == null ? null : _tasksPart(tasks, user, userId, roleId, now);
  final mine = tasks == null ? const <Map<String, dynamic>>[] : myTasks(tasks, userId, roleId);
  final todo = mine.where((t) => t['status'] == 'open' || t['status'] == 'in_progress').length;
  return Dashboard(
    hero: work == null
        ? const DashboardHero(
            label: 'Connected to Lefi Brain',
            value: 'Signed in',
            sub: dashboardNotAllowed,
            progress: 1,
          )
        : DashboardHero(
            label: 'My tasks',
            value: '$todo',
            unit: 'to do',
            sub: '${mine.where((t) => t['status'] == 'awaiting').length} waiting for verification · from Lefi Brain',
            progress: mine.isEmpty ? 1 : (mine.length - todo) / mine.length,
          ),
    quickActions: [?work?.action],
    sections: [...?work?.sections],
    showReportIssue: canReport,
    source: DashboardSource(label: 'Lefi Brain', at: '${two(now.hour)}:${two(now.minute)}'),
    unavailable: [if (work == null) tasksUnavailable],
  );
}

/// The home summary from Lefi Brain's `/overview`, through Lefi Gateway (ADR-068, 070).
class BrainDashboardRepository implements DashboardRepository {
  BrainDashboardRepository(this.brain);

  final BrainAuthRepository brain;

  @override
  Future<Dashboard> dashboardFor(UserProfile user, List<FieldTask> tasks, bool Function(String zoneId) inScope) async {
    Map<String, dynamic>? tasks;
    if (brain.can('nav.tasks')) {
      try {
        tasks = (await brain.api('GET', '/tasks?status=active')).json;
      } on AuthException {
        tasks = null; // said on the home as "could not be read"; the rest still shows
      }
    }
    final canReport = brain.can('incident.report');
    if (!brain.can('nav.dashboard')) {
      return dashboardWithoutOverview(
        DateTime.now(),
        user: user,
        tasks: tasks,
        userId: brain.userId,
        roleId: brain.roleId,
        canReport: canReport,
      );
    }
    final a = await brain.api('GET', '/overview');
    return dashboardFromOverview(
      a.json,
      user,
      tasks: tasks,
      userId: brain.userId,
      roleId: brain.roleId,
      canReport: canReport,
      canHandover: brain.can('nav.handover'),
    );
  }
}
