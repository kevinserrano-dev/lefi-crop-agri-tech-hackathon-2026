// DEMO FIXTURES — fictional data from the design prototype (see demo_users.dart).
import 'dart:math' as math;

import '../features/greenhouse/domain/greenhouse.dart';
import '../shared/domain/provenance.dart';

const demoGreenhouses = [
  Greenhouse(id: 'GH-1', name: 'North Range', system: 'Deep-water culture rafts', health: 84, area: '1.8 ha'),
  Greenhouse(id: 'GH-2', name: 'South Range', system: 'NFT gutters', health: 79, area: '1.4 ha'),
  Greenhouse(id: 'GH-3', name: 'Propagation House', system: 'Ebb & flood benches', health: 95, area: '0.4 ha'),
];

Zone _z(
  String id,
  String gh,
  String code,
  String label,
  String crop,
  int plants,
  int health,
  double temp,
  double rh,
  double ppfd,
  double? moist,
  double ec,
  double ph, {
  bool rei = false,
}) {
  // pH probes are not installed in GH-1/GH-2 in the design → values are simulated.
  final phOrigin = gh != 'GH-3' ? DataOrigin.simulated : DataOrigin.live;
  return Zone(
    id: id,
    greenhouseId: gh,
    code: code,
    label: label,
    crop: crop,
    plantCount: plants,
    health: health,
    reEntryRestricted: rei,
    readings: {
      Metric.temp: Reading(temp, DataOrigin.live),
      Metric.rh: Reading(rh, DataOrigin.live),
      Metric.ppfd: Reading(ppfd, DataOrigin.live),
      Metric.moisture: Reading(moist, moist == null ? DataOrigin.offline : DataOrigin.live),
      Metric.ec: Reading(ec, DataOrigin.live),
      Metric.ph: Reading(ph, phOrigin),
    },
  );
}

final demoZones = [
  _z('GH1-Z1', 'GH-1', 'A', 'Zone A', 'Green Butterhead', 54200, 94, 21.3, 66, 405, 56, 1.54, 5.92),
  _z('GH1-Z2', 'GH-1', 'B', 'Zone B', 'Red Oakleaf', 53800, 90, 21.8, 73, 398, 42, 1.62, 5.88),
  _z('GH1-Z3', 'GH-1', 'C', 'Zone C', 'Lollo Rosso', 52600, 92, 21.1, 67, 412, 54, 1.58, 5.95),
  _z('GH1-Z4', 'GH-1', 'D', 'Zone D', 'Baby Romaine', 51800, 90, 21.5, 65, 420, 53, 1.49, 6.01, rei: true),
  _z('GH2-Z1', 'GH-2', 'E', 'Gutter block 1', 'Spring Mesclun Mix', 57400, 88, 22.4, 70, 388, 55, 1.66, 5.84),
  _z('GH2-Z2', 'GH-2', 'F', 'Gutter block 2', 'Green Oakleaf', 56100, 80, 23.1, 77, 375, 57, 1.71, 5.9),
  _z('GH2-Z3', 'GH-2', 'G', 'Gutter block 3', 'Red Butterhead', 54800, 68, 23.6, 74, 366, null, 1.92, 5.79),
  _z('GH3-P1', 'GH-3', 'H', 'Benches 1–12', 'Seedlings · green varieties', 58300, 96, 20.4, 74, 220, 62, 1.18, 5.86),
  _z('GH3-P2', 'GH-3', 'J', 'Benches 13–24', 'Seedlings · red varieties', 47200, 94, 20.1, 73, 210, 61, 1.21, 5.82),
];

const _positions = [3, 7, 11, 14, 18, 22];
const _offsets = [4, -3, 6, 2, -5, 3];
const _special = <String, Map<int, (String, int, PlantFlag?)>>{
  'GH1-Z2': {0: ('P-0408', 91, null), 3: ('P-0412', 74, PlantFlag.tipburn)},
  'GH2-Z2': {1: ('P-0419', 77, PlantFlag.aphid)},
  'GH2-Z3': {2: ('P-0433', 61, PlantFlag.rootRot)},
  'GH1-Z3': {4: ('P-0426', 70, PlantFlag.mildew)},
};

final demoPlants = [
  for (final (zi, z) in demoZones.indexed)
    for (final (k, p) in _positions.indexed)
      () {
        final sp = _special[z.id]?[k];
        final health = sp?.$2 ?? (z.health + _offsets[k] + (z.id == 'GH2-Z3' ? 18 : 0)).clamp(60, 98);
        final seedling = z.greenhouseId == 'GH-3';
        return Plant(
          id: sp?.$1 ?? 'P-${(520 + zi * 12 + k).toString().padLeft(4, '0')}',
          zoneId: z.id,
          position: '${z.code}-${p.toString().padLeft(2, '0')}',
          health: health,
          variety: z.crop,
          stage: seedling ? 'Seedling' : const ['Vegetative', 'Vegetative', 'Harvest-ready'][(zi + k) % 3],
          ageDays: seedling ? 9 + k : 18 + ((zi * 3 + k) % 10),
          flag: sp?.$3,
        );
      }(),
];

const _ai = ObservationSource.ai;
const _human = ObservationSource.human;

const demoObservations = <PlantFlag?, List<Observation>>{
  PlantFlag.wilt: [
    Observation(
      source: _ai,
      author: 'LEFI-R1 + Lefi Vision',
      time: 'Today · 10:24',
      text: 'Wilting confirmed visually on 14 of 16 plants around B-03. On-board probe reads 18 % VWC. No lesions or pests.',
      confidence: '88 %',
      simulated: true,
    ),
    Observation(
      source: _ai,
      author: 'Lefi Vision v2.3',
      time: 'Today · 10:11',
      text: 'Probable wilting — leaf turgor loss.',
      confidence: '91 %',
    ),
    Observation(
      source: _human,
      author: 'Amrit Gill · Worker',
      time: 'Today · 09:50',
      text: 'Leaves drooping in row B-3. Drip line looks dry.',
    ),
  ],
  PlantFlag.tipburn: [
    Observation(
      source: _ai,
      author: 'Lefi Vision v2.3',
      time: 'Today · 07:54',
      text: 'Possible leaf-margin tipburn on 3 inner leaves.',
      confidence: '87 %',
    ),
    Observation(
      source: _human,
      author: 'Hana Kim · Crop Scout',
      time: 'Oct 27 · 14:20',
      text: 'Slight browning on inner leaf margins; monitoring. Bay B fans running.',
    ),
  ],
  PlantFlag.aphid: [
    Observation(
      source: _ai,
      author: 'Lefi Vision v2.3',
      time: 'Oct 27 · 15:12',
      text: 'Possible aphid colony on leaf underside.',
      confidence: '71 %',
    ),
    Observation(
      source: _human,
      author: 'Fatima Haddad · Crop Scout',
      time: 'Oct 27 · 16:05',
      text: 'Sticky-trap counts in block 2 up 40 % week over week.',
    ),
  ],
  PlantFlag.rootRot: [
    Observation(
      source: _ai,
      author: 'Lefi Vision v2.3',
      time: 'Today · 06:40',
      text: 'Possible root rot (Pythium) — midday wilting and lower-leaf yellowing.',
      confidence: '64 %',
    ),
    Observation(
      source: _human,
      author: 'Sofia Marchetti · Grower',
      time: 'Today · 08:15',
      text: 'Solution at 24.8 °C. Pulling 5 plants for a root check at 12:00.',
    ),
  ],
  PlantFlag.mildew: [
    Observation(
      source: _ai,
      author: 'Lefi Vision v2.3',
      time: 'Oct 26 · 08:20',
      text: 'Downy mildew lesions on two leaves.',
      confidence: '91 %',
      confirmed: true,
    ),
    Observation(
      source: _human,
      author: 'Sofia Marchetti · Grower',
      time: 'Oct 26 · 10:05',
      text: 'Confirmed downy mildew. 46 nearby plants removed.',
    ),
  ],
  null: [
    Observation(
      source: _ai,
      author: 'Lefi Vision v2.3',
      time: 'Today · 07:54',
      text: 'No anomalies detected. Leaf colour within variety range.',
      confidence: '95 %',
    ),
    Observation(
      source: _human,
      author: 'Hana Kim · Crop Scout',
      time: 'Oct 27 · 14:20',
      text: 'Uniform colour and turgor; no pests on undersides.',
    ),
  ],
};

List<double> demoHealthHistory(Plant p) {
  final h = <double>[
    for (var i = 0; i < 14; i++)
      p.flag == PlantFlag.wilt
          ? p.health + (i < 11 ? 30 - i * .5 : 30 - (i - 10) * 10.0)
          : p.health + math.sin(i / 2 + p.health) * 2.5 + (13 - i) * .15,
  ];
  h[13] = p.health.toDouble();
  return h;
}
