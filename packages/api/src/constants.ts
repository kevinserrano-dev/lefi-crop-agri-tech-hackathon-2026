import type { IncidentStatus } from './schema';

/** Incident lifecycle in display order (stepper). The Brain owns the transitions. */
export const INCIDENT_STEPS: IncidentStatus[] = [
  'New',
  'Acknowledged',
  'Investigating',
  'Resolved',
  'Closed',
];
