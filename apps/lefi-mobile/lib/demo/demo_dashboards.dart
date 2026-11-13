// DEMO FIXTURES — fictional data from the design prototype (see demo_users.dart).
import '../features/home/domain/dashboard.dart';
import '../features/tasks/domain/task.dart';
import '../shared/domain/glyph.dart';
import '../shared/domain/role.dart';
import 'demo_users.dart';

String _hm(double hours) {
  final h = hours.floor();
  final m = ((hours - h) * 60).round();
  return '$h h ${m.toString().padLeft(2, '0')} m';
}

Severity _pri(TaskPriority p) => switch (p) {
  TaskPriority.critical => Severity.crit,
  TaskPriority.high => Severity.warn,
  TaskPriority.normal => Severity.info,
};

String _priLabel(TaskPriority p) => switch (p) {
  TaskPriority.critical => 'Critical',
  TaskPriority.high => 'High',
  TaskPriority.normal => 'Normal',
};

DashboardRow _r(Glyph g, Severity s, String title, String sub, String chip, Severity cs, AppTarget t) =>
    DashboardRow(glyph: g, severity: s, title: title, sub: sub, chip: chip, chipSeverity: cs, target: t);

DashboardRow _taskRow(FieldTask t) => _r(
  t.origin == TaskOrigin.ai ? Glyph.aiFinding : Glyph.task,
  _pri(t.priority),
  t.title,
  '${t.zoneId} · ${t.assignee.split(' ').first} · ${t.due}',
  _priLabel(t.priority),
  _pri(t.priority),
  TaskTarget(t.id),
);

Dashboard demoDashboard(UserProfile u, List<FieldTask> tasks, bool Function(String) inScope) {
  final shiftPct = ((demoNowHours - u.shiftStartHour) / (u.shiftEndHour - u.shiftStartHour)).clamp(0.0, 1.0);
  final left = _hm(u.shiftEndHour - demoNowHours);
  final mine = tasks.where((t) => t.assignee == u.name && t.isActive).map(_taskRow).toList();
  final team = tasks
      .where((t) => t.isActive && inScope(t.zoneId) && t.assignee != u.name)
      .take(4)
      .map(_taskRow)
      .toList();
  final critical = [
    _r(
      Glyph.ec,
      Severity.crit,
      'EC 2.31 mS/cm in GH2-Z3',
      'Flush in progress · Luis Ortega',
      'Ack’d',
      Severity.warn,
      const ZoneTarget('GH2-Z3'),
    ),
  ];

  return switch (u.role) {
    Role.manager => Dashboard(
      hero: const DashboardHero(
        label: 'Greenhouse health score',
        value: '89',
        unit: '/ 100',
        sub: '−1 vs yesterday · 3 greenhouses · 486,200 plants',
        progress: .89,
        chips: [
          HeroChip('6 healthy zones', Severity.ok),
          HeroChip('2 warning', Severity.warn),
          HeroChip('1 critical', Severity.crit),
        ],
      ),
      quickActions: const [
        QuickAction('Team tasks', Glyph.groups, TabTarget('tasks', teamScope: true)),
        QuickAction('Devices', Glyph.devices, PlannedTarget('Devices & health')),
        QuickAction('Handover', Glyph.handover, HandoverTarget()),
        QuickAction('Alerts', Glyph.notifications, TabTarget('alerts')),
      ],
      sections: [
        DashboardSection('Critical issues', critical),
        DashboardSection('Escalated incidents', [
          _r(
            Glyph.escalation,
            Severity.warn,
            'INC-0182 escalated to Maintenance',
            'Probe offline · acknowledged 06:30',
            'Ack’d',
            Severity.ok,
            const TaskTarget('T-1182'),
          ),
        ]),
      ],
      kpis: const [
        Kpi('92.3 %', 'Plants healthy', '448,930 of 486,200'),
        Kpi('5', 'Open incidents', '2 critical'),
        Kpi('18 / 27', 'Tasks done today', '67 % complete'),
        Kpi('2', 'Harvest-ready', 'B-2611 · B-2615'),
      ],
      showRobotCard: true,
    ),
    Role.grower => Dashboard(
      hero: const DashboardHero(
        label: 'Crop health',
        value: '92.3',
        unit: '% healthy',
        sub: '31,640 warning · 5,630 critical · 18 crop batches',
        progress: .92,
      ),
      quickActions: const [
        QuickAction('Inspect plant', Glyph.search, InspectTarget()),
        QuickAction('Greenhouse', Glyph.plant, TabTarget('greenhouse')),
        QuickAction('Handover', Glyph.handover, HandoverTarget()),
      ],
      sections: [
        DashboardSection('AI observations', [
          _r(
            Glyph.aiFinding,
            Severity.warn,
            'Possible tipburn · B-14',
            'GH1-Z2 · 87 % · prediction',
            'Unconfirmed',
            Severity.warn,
            const PlantTarget('P-0412'),
          ),
          _r(
            Glyph.aiFinding,
            Severity.warn,
            'Possible aphids · P-0419',
            'GH2-Z2 · 71 % · prediction',
            'Unconfirmed',
            Severity.warn,
            const PlantTarget('P-0419'),
          ),
        ]),
        DashboardSection('Environmental alerts', [
          _r(
            Glyph.ec,
            Severity.crit,
            'EC 2.31 → 1.92 mS/cm',
            'GH2-Z3 · range 1.2–1.8 · improving',
            'Critical',
            Severity.crit,
            const ZoneTarget('GH2-Z3'),
          ),
          _r(
            Glyph.humidity,
            Severity.warn,
            'Humidity 77 %',
            'GH2-Z2 · max 75 %',
            'Warning',
            Severity.warn,
            const ZoneTarget('GH2-Z2'),
          ),
        ]),
        DashboardSection('Plants requiring attention', [
          _r(
            Glyph.plant,
            Severity.crit,
            'P-0433 · possible root rot',
            'GH2-Z3 · root check at 12:00',
            '64 %',
            Severity.crit,
            const PlantTarget('P-0433'),
          ),
          _r(
            Glyph.plant,
            Severity.warn,
            'P-0426 · downy mildew area',
            'GH1-Z3 · re-scan Oct 29',
            'Confirmed',
            Severity.ok,
            const PlantTarget('P-0426'),
          ),
        ]),
      ],
    ),
    Role.supervisor => Dashboard(
      hero: DashboardHero(
        label: 'Day shift · 06:00–14:30',
        value: '9',
        unit: 'of 10 crew on site',
        sub: '1 on break · $left left · Owen MacLeod takes over at 14:00',
        progress: shiftPct,
      ),
      quickActions: const [
        QuickAction('Team tasks', Glyph.groups, TabTarget('tasks', teamScope: true)),
        QuickAction('Report issue', Glyph.report, ReportTarget()),
        QuickAction('Devices', Glyph.devices, PlannedTarget('Devices & health')),
        QuickAction('Handover', Glyph.handover, HandoverTarget()),
      ],
      sections: [DashboardSection('Critical alerts', critical), DashboardSection('Team tasks', team)],
      showRobotCard: true,
    ),
    Role.scout => Dashboard(
      hero: const DashboardHero(
        label: 'Inspections today',
        value: '2',
        unit: 'of 5 done',
        sub: 'Next: tipburn check, rows 14–18 at 11:00',
        progress: .4,
      ),
      quickActions: const [
        QuickAction('Start inspection', Glyph.camera, InspectTarget('P-0412')),
        QuickAction('Find plant', Glyph.search, InspectTarget()),
        QuickAction('Alerts', Glyph.notifications, TabTarget('alerts')),
      ],
      sections: [
        DashboardSection('Inspection schedule', [
          _r(
            Glyph.schedule,
            Severity.warn,
            '11:00 · Tipburn check rows 14–18',
            'GH1-Z2 · T-1184 · AI flag 87 %',
            'High',
            Severity.warn,
            const TaskTarget('T-1184'),
          ),
          _r(
            Glyph.schedule,
            Severity.warn,
            '13:00 · Confirm aphids · P-0419',
            'GH2-Z2 · T-1185',
            'High',
            Severity.warn,
            const TaskTarget('T-1185'),
          ),
          _r(
            Glyph.schedule,
            Severity.info,
            '14:00 · Sticky-trap count',
            'GH2-Z2 · T-1178',
            'Normal',
            Severity.info,
            const TaskTarget('T-1178'),
          ),
        ]),
        DashboardSection('Plant health findings', [
          _r(
            Glyph.aiFinding,
            Severity.warn,
            'P-0412 · tipburn',
            'GH1-Z2 · awaiting your inspection',
            'AI',
            Severity.ai,
            const PlantTarget('P-0412'),
          ),
          _r(
            Glyph.humanCheck,
            Severity.ok,
            'P-0426 · downy mildew',
            'GH1-Z3 · confirmed by you and Sofia, Oct 26',
            'Human',
            Severity.ok,
            const PlantTarget('P-0426'),
          ),
        ]),
      ],
    ),
    Role.maint => Dashboard(
      hero: const DashboardHero(
        label: 'Equipment status',
        value: '61',
        unit: 'of 63 devices online',
        sub: '1 offline · 1 low battery · 3 pumps running',
        progress: .97,
      ),
      quickActions: const [
        QuickAction('Scan device', Glyph.qrScan, PlannedTarget('Device label scanner')),
        QuickAction('Devices', Glyph.devices, PlannedTarget('Devices & health')),
        QuickAction('My tasks', Glyph.task, TabTarget('tasks')),
        QuickAction('Report issue', Glyph.report, ReportTarget()),
      ],
      sections: [
        DashboardSection('Irrigation issues', [
          _r(
            Glyph.pump,
            Severity.warn,
            'EC dosing overshoot · tank B',
            'GH2-Z3 · duty cycle +38 %',
            'High',
            Severity.warn,
            const TaskTarget('T-1179'),
          ),
        ]),
        DashboardSection('Maintenance tasks', mine),
        DashboardSection('Sensor anomalies', [
          _r(
            Glyph.offline,
            Severity.crit,
            'SM-GH2-Z3-02 offline',
            'GH2-Z3 · since 06:12 · battery 9 %',
            'Offline',
            Severity.crit,
            const PlannedTarget('Device detail'),
          ),
          _r(
            Glyph.battery,
            Severity.warn,
            'PAR-GH2-Z2-01 low battery',
            '14 % · replace this week',
            'Warning',
            Severity.warn,
            const ZoneTarget('GH2-Z2'),
          ),
          _r(
            Glyph.lab,
            Severity.ai,
            'pH probes not installed',
            'GH-1 · GH-2 · values simulated',
            'Info',
            Severity.info,
            const ZoneTarget('GH1-Z1'),
          ),
        ]),
      ],
    ),
    Role.worker => Dashboard(
      hero: DashboardHero(
        label: 'Your shift today',
        value: '06:00–14:30',
        sub: 'Supervisor Marcus Okafor · Zones GH1-Z2, GH1-Z3 · $left left',
        progress: shiftPct,
      ),
      sections: [DashboardSection('Assigned to you', mine)],
      instructions: const [
        Instruction(Glyph.warning, Severity.warn, 'Zone D is closed for spraying until 14:00. Do not enter.'),
        Instruction(Glyph.moisture, Severity.info, 'Zone B irrigation fault: hand-water only with the blue hose cart.'),
        Instruction(Glyph.hygiene, Severity.ok, 'Change gloves when moving between Zone B and Zone C.'),
        Instruction(Glyph.cold, Severity.info, 'Close cooler 2 door fully — the alarm is sensitive.'),
      ],
      showReportIssue: true,
    ),
  };
}
