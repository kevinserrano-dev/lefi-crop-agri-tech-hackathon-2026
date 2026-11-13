/**
 * Mock computer-vision detections: the prototype's five detections (design AI0). FAKE —
 * there is no vision model and no image behind them; every record is `simulated: true`,
 * frames have no image, and the Brain's model field says so. Reviews are human decisions
 * recorded by the Brain; "request inspection" creates a task (allowlisted, no actuator).
 */
import { MockError } from './incidents.ts';
import { addTask } from './tasks.ts';

type Status = 'unconfirmed' | 'inspection' | 'confirmed' | 'rejected';
interface Det {
  id: string;
  zone: string;
  batch: string;
  plant: string;
  variety: string;
  camera: string;
  at: string;
  finding: string;
  cat: string;
  conf: number;
  sev: 'warning' | 'critical';
  status: Status;
  reviewer: string | null;
  boxes: Array<[string, number, number, number, number, 'warn' | 'crit' | 'ok']>;
  leaf: Array<[string, string, number]>;
  growth: Array<[string, string, string]>;
  symptoms: string[];
  evidence: string[];
  rec: string;
  diff: Array<[string, string]>;
}

const D: Det[] = [
  {
    id: 'AI-1028-0142',
    zone: 'GH1-Z2',
    batch: 'B-2613',
    plant: 'P-0412',
    variety: 'Red Oakleaf',
    camera: 'CAM-GH1-03 · rail',
    at: '2026-10-28T07:54',
    finding: 'Leaf-margin tipburn',
    cat: 'Physiological stress',
    conf: 87,
    sev: 'warning',
    status: 'unconfirmed',
    reviewer: null,
    boxes: [
      ['Tipburn 87%', 20, 16, 24, 22, 'warn'],
      ['Tipburn 74%', 57, 28, 18, 18, 'warn'],
      ['Healthy leaf 96%', 34, 52, 30, 30, 'ok'],
    ],
    leaf: [
      ['anthocyanin', 'Anthocyanin red (expected)', 55],
      ['healthy', 'Healthy green', 29],
      ['chlorotic', 'Pale / chlorotic', 9],
      ['necrotic', 'Necrotic brown', 7],
    ],
    growth: [
      ['Height', '11.8 cm', '+2.1 cm / 7 d'],
      ['Leaf count (est.)', '14', 'batch avg 15'],
      ['Canopy area', '86 cm²', '+18 %'],
    ],
    symptoms: [
      'Brown necrotic edges on 3 inner leaves',
      'Mild cupping of youngest leaves',
      'No webbing, frass or insects detected',
    ],
    evidence: [
      'Calcium-transport pattern: damage limited to young, fast-growing leaves',
      'Zone RH 73–78 % overnight for 3 nights — low transpiration',
      'Similar flags on 11 neighbouring plants in rows 14–18',
    ],
    rec: 'Human inspection of 20 plants in raft rows 14–18. If confirmed: increase horizontal airflow overnight and verify Ca in nutrient solution.',
    diff: [
      ['Necrotic area', '0.4 → 2.6 cm²'],
      ['Red pigment coverage', '58 → 55 %'],
      ['Height', '9.7 → 11.8 cm'],
    ],
  },
  {
    id: 'AI-1028-0137',
    zone: 'GH2-Z3',
    batch: 'B-2623',
    plant: 'P-0433',
    variety: 'Red Butterhead',
    camera: 'CAM-GH2-07 · fixed',
    at: '2026-10-28T06:40',
    finding: 'Possible root rot (Pythium)',
    cat: 'Potential disease',
    conf: 64,
    sev: 'critical',
    status: 'inspection',
    reviewer: null,
    boxes: [
      ['Wilting 81%', 26, 22, 40, 34, 'crit'],
      ['Chlorosis 66%', 60, 56, 22, 20, 'warn'],
    ],
    leaf: [
      ['anthocyanin', 'Anthocyanin red (expected)', 41],
      ['healthy', 'Healthy green', 22],
      ['chlorotic', 'Pale / chlorotic', 26],
      ['necrotic', 'Necrotic brown', 11],
    ],
    growth: [
      ['Height', '8.9 cm', '−0.3 cm / 7 d'],
      ['Leaf count (est.)', '10', 'batch avg 13'],
      ['Canopy area', '54 cm²', '−6 %'],
    ],
    symptoms: [
      'Midday wilting despite adequate solution flow',
      'Lower-leaf yellowing',
      'Stunted growth vs batch average',
    ],
    evidence: [
      'Growth stalled over 5 days',
      'Solution temperature 24.8 °C (above 22 °C target)',
      'Visual pattern only — roots not visible to camera',
    ],
    rec: 'Human inspection required: pull 5 plants and inspect roots for browning/sloughing. Do not treat until confirmed by lab or scout.',
    diff: [
      ['Wilted leaf area', '4 → 31 %'],
      ['Chlorotic coverage', '9 → 26 %'],
      ['Height', '9.2 → 8.9 cm'],
    ],
  },
  {
    id: 'AI-1027-0119',
    zone: 'GH2-Z2',
    batch: 'B-2621',
    plant: 'P-0419',
    variety: 'Green Oakleaf',
    camera: 'CAM-GH2-04 · rail',
    at: '2026-10-27T15:12',
    finding: 'Possible aphid colony',
    cat: 'Potential pest',
    conf: 71,
    sev: 'warning',
    status: 'unconfirmed',
    reviewer: null,
    boxes: [['Aphid cluster 71%', 44, 30, 16, 14, 'warn']],
    leaf: [
      ['healthy', 'Healthy green', 84],
      ['chlorotic', 'Pale / chlorotic', 11],
      ['necrotic', 'Necrotic brown', 5],
    ],
    growth: [
      ['Height', '10.4 cm', '+1.6 cm / 7 d'],
      ['Leaf count (est.)', '13', 'batch avg 13'],
      ['Canopy area', '72 cm²', '+12 %'],
    ],
    symptoms: ['Small clustered objects on leaf underside', 'Slight leaf curling'],
    evidence: [
      'Shape and clustering consistent with green peach aphid',
      'Sticky-trap count up 40 % week-over-week in this block',
    ],
    rec: 'Scout to confirm with hand lens; check 3 adjacent gutters. Consider biological control release if confirmed.',
    diff: [
      ['Cluster count', '0 → 1'],
      ['Leaf curl index', '0.08 → 0.14'],
      ['Height', '8.8 → 10.4 cm'],
    ],
  },
  {
    id: 'AI-1027-0102',
    zone: 'GH1-Z4',
    batch: 'B-2617',
    plant: 'P-0405',
    variety: 'Baby Romaine',
    camera: 'CAM-GH1-06 · rail',
    at: '2026-10-27T09:03',
    finding: 'Interveinal chlorosis',
    cat: 'Nutrient stress',
    conf: 58,
    sev: 'warning',
    status: 'rejected',
    reviewer: 'Hana Kim',
    boxes: [['Chlorosis 58%', 30, 30, 30, 26, 'warn']],
    leaf: [
      ['healthy', 'Healthy green', 88],
      ['chlorotic', 'Pale / chlorotic', 10],
      ['necrotic', 'Necrotic brown', 2],
    ],
    growth: [
      ['Height', '12.6 cm', '+2.4 cm / 7 d'],
      ['Leaf count (est.)', '15', 'batch avg 15'],
      ['Canopy area', '91 cm²', '+21 %'],
    ],
    symptoms: ['Lighter green tissue between veins'],
    evidence: ['Low confidence — glare from supplemental lighting at capture time'],
    rec: 'Rejected by scout: lighting artefact. Model feedback submitted.',
    diff: [
      ['Chlorotic coverage', '8 → 10 %'],
      ['Height', '10.2 → 12.6 cm'],
    ],
  },
  {
    id: 'AI-1026-0088',
    zone: 'GH1-Z3',
    batch: 'B-2615',
    plant: 'P-0426',
    variety: 'Lollo Rosso',
    camera: 'CAM-GH1-05 · rail',
    at: '2026-10-26T08:20',
    finding: 'Downy mildew lesions',
    cat: 'Disease',
    conf: 91,
    sev: 'critical',
    status: 'confirmed',
    reviewer: 'Sofia Marchetti',
    boxes: [
      ['Lesion 91%', 24, 40, 20, 16, 'crit'],
      ['Lesion 83%', 58, 24, 16, 14, 'crit'],
    ],
    leaf: [
      ['anthocyanin', 'Anthocyanin red (expected)', 61],
      ['healthy', 'Healthy green', 24],
      ['chlorotic', 'Pale / chlorotic', 10],
      ['necrotic', 'Necrotic brown', 5],
    ],
    growth: [
      ['Height', '10.9 cm', '+1.8 cm / 7 d'],
      ['Leaf count (est.)', '14', 'batch avg 14'],
      ['Canopy area', '80 cm²', '+15 %'],
    ],
    symptoms: ['Angular yellow lesions bounded by veins', 'Grey sporulation on underside'],
    evidence: [
      'Lesion geometry matches Bremia lactucae reference set',
      'Leaf wetness > 6 h on Oct 24–25',
    ],
    rec: 'Confirmed. 46 plants removed; dehumidification setpoint lowered. Re-scan scheduled Oct 29.',
    diff: [
      ['Lesion count', '0 → 2'],
      ['Height', '9.1 → 10.9 cm'],
    ],
  },
];

const DESIGN_NOW = Date.parse('2026-10-28T09:42:00');
const shift = (now: Date, at: string) => new Date(now.getTime() - (DESIGN_NOW - Date.parse(at)));
const AWAITING: Status[] = ['unconfirmed', 'inspection'];
const FILTER: Record<string, (d: Det) => boolean> = {
  awaiting: (d) => AWAITING.includes(d.status),
  confirmed: (d) => d.status === 'confirmed',
  rejected: (d) => d.status === 'rejected',
};

interface Actor {
  name: string;
  permissions: string[];
}

function availability(d: Det, a: Actor) {
  const open = AWAITING.includes(d.status);
  const gate = (perm: string, label: string, ok: boolean, why: string) =>
    !a.permissions.includes(perm)
      ? { allowed: false, reason: `Requires permission: ${label}` }
      : ok
        ? { allowed: true, reason: null }
        : { allowed: false, reason: why };
  return {
    confirm: gate('ai.confirm', 'Confirm / reject AI diagnosis', open, 'Already reviewed.'),
    reject: gate('ai.confirm', 'Confirm / reject AI diagnosis', open, 'Already reviewed.'),
    request_inspection: gate(
      'ai.request',
      'Request human inspection',
      d.status === 'unconfirmed',
      d.status === 'inspection'
        ? 'Inspection already requested for this detection.'
        : 'Already reviewed.',
    ),
  };
}

function row(d: Det, now: Date) {
  return {
    id: d.id,
    zone_id: d.zone,
    plant_id: d.plant,
    finding: d.finding,
    severity: d.sev,
    confidence: d.conf,
    status: d.status,
    captured_at: shift(now, d.at).toISOString(),
    origin: 'SIMULATED',
    simulated: true,
  };
}

const fmtDay = (dt: Date) => dt.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });

function detail(d: Det, now: Date, a: Actor) {
  const at = shift(now, d.at);
  return {
    ...row(d, now),
    category: d.cat,
    variety: d.variety,
    batch: d.batch,
    camera: d.camera,
    reviewer: d.reviewer,
    frame: {
      image_url: null,
      label: `SIMULATED FRAME · ${d.camera}`,
      resolution: '1920×1440 · RGB + NIR',
    },
    comparison: {
      interval: '7-day interval · same camera position',
      before: `SIMULATED FRAME · ${d.plant} · ${fmtDay(new Date(at.getTime() - 7 * 86_400_000))}`,
      after: `SIMULATED FRAME · ${d.plant} · ${fmtDay(at)}`,
      changes: d.diff.map(([metric, value]) => ({ metric, value })),
    },
    boxes: d.boxes.map(([label, x, y, w, h, tone]) => ({ label, x, y, w, h, tone })),
    leaf_colour: d.leaf.map(([key, label, pct]) => ({ key, label, pct })),
    growth: d.growth.map(([metric, value, delta]) => ({ metric, value, delta })),
    symptoms: d.symptoms,
    evidence: d.evidence,
    review_threshold: 60,
    recommendation: { text: d.rec, simulated: true },
    actions: availability(d, a),
  };
}

const find = (id: string) => {
  const d = D.find((x) => x.id === id);
  if (!d) throw new MockError(404, 'not_found', `Detection ${id} not found.`);
  return d;
};

export const list = (now: Date, q: URLSearchParams) => {
  const f = q.get('filter');
  return D.filter((d) => !f || FILTER[f]?.(d)).map((d) => row(d, now));
};

export const summary = () => ({
  awaiting_review: D.filter(FILTER.awaiting!).length,
  confirmed_7d: D.filter(FILTER.confirmed!).length,
  images_today: 1240,
  model: null,
  model_note: 'Mock Brain — no vision model connected; detections are simulated.',
  counts: {
    all: D.length,
    awaiting: D.filter(FILTER.awaiting!).length,
    confirmed: D.filter(FILTER.confirmed!).length,
    rejected: D.filter(FILTER.rejected!).length,
  },
});

export const unconfirmedCount = () => D.filter((d) => d.status === 'unconfirmed').length;
export const get = (now: Date, id: string, a: Actor) => detail(find(id), now, a);

function refuse(av: { allowed: boolean; reason: string | null }, perm: string, a: Actor) {
  if (av.allowed) return;
  const forbidden = !a.permissions.includes(perm);
  throw new MockError(
    forbidden ? 403 : 409,
    forbidden ? 'forbidden' : 'invalid_state',
    av.reason ?? 'Not allowed.',
  );
}

export function review(now: Date, id: string, a: Actor, decision: string) {
  const d = find(id);
  if (decision !== 'confirm' && decision !== 'reject')
    throw new MockError(422, 'invalid_decision', 'Decision must be confirm or reject.');
  refuse(availability(d, a)[decision], 'ai.confirm', a);
  d.status = decision === 'confirm' ? 'confirmed' : 'rejected';
  d.reviewer = a.name;
  return {
    item: detail(d, now, a),
    message:
      decision === 'confirm'
        ? `Diagnosis confirmed for ${d.plant}. It is now a confirmed record.`
        : 'Prediction rejected and recorded as reviewer feedback (no training pipeline exists yet).',
  };
}

export function requestInspection(now: Date, id: string, a: Actor) {
  const d = find(id);
  refuse(availability(d, a).request_inspection, 'ai.request', a);
  const task = addTask({
    title: `Inspect ${d.finding.toLowerCase()} — ${d.plant}`,
    zone: d.zone,
    assignee: 'Hana Kim',
    due: 'Today 16:00',
    priority: d.sev === 'critical' ? 'Critical' : 'High',
    status: 'Open',
  });
  d.status = 'inspection';
  return {
    item: detail(d, now, a),
    message: `Inspection task ${task.id} created and assigned to Hana Kim.`,
  };
}

/** Detections recorded for a plant (used by the plant profile). */
export const forPlant = (plant: string) =>
  D.filter((d) => d.plant === plant).map((d) => ({
    id: d.id,
    batch: d.batch,
    finding: d.finding,
    confidence: d.conf,
    status: d.status,
    at: d.at,
  }));

/** Plants with a detection in a batch, so the batch shows them among its tracked plants. */
export const plantsInBatch = (batch: string) =>
  D.filter((d) => d.batch === batch).map((d) => d.plant);
