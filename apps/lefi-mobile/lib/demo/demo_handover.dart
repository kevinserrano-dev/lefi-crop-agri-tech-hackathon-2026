// DEMO FIXTURES — fictional data from the design prototype (see demo_users.dart).
import '../features/handover/domain/handover.dart';
import '../features/home/domain/dashboard.dart';
import '../shared/domain/glyph.dart';

const _ok = Severity.ok, _w = Severity.warn, _c = Severity.crit, _i = Severity.info, _a = Severity.ai;

const demoHandover = ShiftHandover(
  fromShift: 'Evening · Oct 27',
  fromPerson: 'Owen MacLeod',
  toShift: 'Day · Oct 28',
  summaryTime: '10:34',
  summary: 'A quiet evening, then a busy morning. At 10:12 Zone B lost irrigation on drip line B-3. LEFI-R1 (simulation) confirmed wilting at B-03, maintenance is repairing valve V-B3, and hand-watering is under way. EC in GH2-Z3 is recovering after the flush.',
  sections: [
    HandoverSection('Previous shift activity', Glyph.history, [
      HandoverItem(_ok, '12 tasks completed, none left open', 'Evening'),
      HandoverItem(_ok, 'Harvest of B-2611 finished — 29,270 heads to cooler 2', '21:40'),
      HandoverItem(_i, 'GH-2 vents closed at 19:40 for frost forecast (−1 °C)', '19:40'),
      HandoverItem(_ok, 'Zone C mildew area re-checked: no new lesions', '18:15'),
    ]),
    HandoverSection('Active incidents', Glyph.incident, [
      HandoverItem(_c, 'INC-0187 · Zone B moisture 19 % · investigating', '10:12'),
      HandoverItem(_c, 'INC-0186 · EC 2.31 in GH2-Z3 · flush in progress', '08:40'),
      HandoverItem(_w, 'INC-0185 · Humidity 77 % in GH2-Z2', '09:15'),
      HandoverItem(_w, 'INC-0182 · Moisture probe offline, GH2-Z3', '06:12'),
    ]),
    HandoverSection('Completed tasks', Glyph.task, [
      HandoverItem(_ok, 'T-1176 · Seed trays for B-2629 · Mei Chen', '21:10'),
      HandoverItem(_ok, 'T-1175 · Transplant row 3 · Amrit Gill', '13:40'),
      HandoverItem(_w, 'T-1174 · HAF fan belt · awaiting verification', '09:00'),
    ]),
    HandoverSection('Pending plant inspections', Glyph.search, [
      HandoverItem(_w, 'Tipburn check rows 14–18 · Hana Kim', '11:00'),
      HandoverItem(_c, 'Root check P-0433 · Sofia Marchetti', '12:00'),
      HandoverItem(_w, 'Aphid confirmation P-0419 · Hana Kim', '13:00'),
    ]),
    HandoverSection('Environmental changes', Glyph.temperature, [
      HandoverItem(_c, 'Zone B moisture 42 % → 19 %', 'Critical'),
      HandoverItem(_w, 'GH2-Z3 EC 2.31 → 1.92 mS/cm', 'Improving'),
      HandoverItem(_w, 'GH2-Z2 humidity peaked at 77 %', '05:40'),
      HandoverItem(_ok, 'Outside low −1 °C; heating normal', 'Overnight'),
    ]),
    HandoverSection('Robot missions', Glyph.robot, [
      HandoverItem(_a, 'M-1042 · Imaging run Zone B · 1,240 images, 3 flags', '07:58'),
      HandoverItem(_a, 'M-1043 · Wilting inspection B-03 · 14 photos (simulation)', '10:31'),
    ]),
  ],
  recommendations: [
    'Confirm WO-2207 is done and Zone B is back above 45 % by 15:00',
    'Keep HAF fans running in GH2-Z2 until humidity is below 75 %',
    'Do not enter Zone D before 14:00 (spray re-entry)',
    'Review 2 unconfirmed AI flags: tipburn and aphids',
  ],
);
