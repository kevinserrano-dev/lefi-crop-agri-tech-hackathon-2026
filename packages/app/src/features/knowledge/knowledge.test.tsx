import { fireEvent, screen } from '@testing-library/react';
import type { CropProfile, CropProfileDetail, KnowledgeMeasurement } from '@lefi/api';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { KnowledgeLive } from './KnowledgeLive';

const NOW = '2026-11-11T10:00:00Z';
const HEALTH = { status: 'ok', service: 'lefi-brain', version: '0.7.1', time: NOW };

const v1: CropProfile = {
  id: 'p1',
  lineage_id: 'p1',
  version: 1,
  status: 'draft',
  crop_type_id: 'c1',
  name: 'Fake lettuce profile',
  scientific_name: 'Lactuca sativa',
  variety: null,
  description: 'A test profile.',
  method: 'hydroponic',
  stages: [{ key: 'seedling', days_min: 7, days_max: 14 }],
  cycle_days_min: 35,
  cycle_days_max: 50,
  environment: null,
  problems: ['Tipburn (test)'],
  monitoring: ['air_temperature'],
  created_at: NOW,
  updated_at: NOW,
  reviewed_at: null,
  review_note: null,
  parameters: 1,
  illustrative: 1,
};
const detail: CropProfileDetail = {
  ...v1,
  items: [
    {
      id: 'x1',
      measurement: 'water_ph',
      label: 'pH',
      unit: 'pH',
      stage: null,
      period: 'any',
      for_s: 0,
      verification: 'illustrative',
      reference: null,
      note: null,
      updated_at: NOW,
      optimal_min: 5.6,
      optimal_max: 6.2,
      warning_min: null,
      warning_max: null,
      critical_min: null,
      critical_max: null,
    },
  ],
  versions: [v1],
};
const catalog: KnowledgeMeasurement[] = [
  {
    key: 'air_temperature',
    label: 'Air temperature',
    unit: '°C',
    lower: -30,
    upper: 60,
    source: 'sensor',
    calculated_from: [],
    note: null,
  },
  {
    key: 'water_ph',
    label: 'pH',
    unit: 'pH',
    lower: 0,
    upper: 14,
    source: 'not_measurable',
    calculated_from: [],
    note: null,
  },
];
const routes = {
  '/knowledge/profiles': [v1],
  '/knowledge/profiles/p1': detail,
  '/knowledge/measurements': catalog,
  '/greenhouses': [],
  '/zones': [],
  '/containers': [],
  '/crop-types': [
    { id: 'c1', name: 'Fake lettuce', variety: null, created_at: NOW, is_placeholder: true },
  ],
  '/plants': [],
  '/health': HEALTH,
};

describe('AI Knowledge Center', () => {
  it('shows profiles with their review state and only an editor prepares them', async () => {
    renderWithProviders(<KnowledgeLive />, {
      platform: fakePlatform(routes),
      session: session(['nav.knowledge', 'knowledge.view', 'knowledge.edit']),
    });
    expect(await screen.findByText('Fake lettuce profile · v1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send to review/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve and publish/ })).toBeNull();
    expect(screen.getAllByText(/1 illustrative/).length).toBeGreaterThan(0);
  });

  it('marks illustrative values and what nothing measures here', async () => {
    renderWithProviders(<KnowledgeLive />, {
      platform: fakePlatform(routes),
      session: session(['nav.knowledge', 'knowledge.view']),
    });
    fireEvent.click(await screen.findByRole('tab', { name: 'Environmental parameters' }));
    expect(await screen.findByText('5.6–6.2')).toBeInTheDocument();
    expect(screen.getAllByText('Illustrative').length).toBeGreaterThan(0);
    expect(screen.getByText('Nothing measures it here yet')).toBeInTheDocument();
    expect(screen.getByText('Not measurable here yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add parameter/ })).toBeNull(); // read-only role
  });

  it('says what is not built yet instead of showing anything', async () => {
    renderWithProviders(<KnowledgeLive />, {
      platform: fakePlatform(routes),
      session: session(['nav.knowledge', 'knowledge.view']),
    });
    fireEvent.click(await screen.findByRole('tab', { name: 'Documents' }));
    expect(await screen.findByText(/Knowledge documents: next step/)).toBeInTheDocument();
  });
});
