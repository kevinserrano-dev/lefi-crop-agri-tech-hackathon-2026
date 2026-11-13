/**
 * AI Knowledge Center as the real Lefi Brain serves it (ADR-086): crop profiles with versions and
 * review, their environmental parameters, and per-plant overrides. Types are GENERATED from the
 * OpenAPI document; the mock Brain does not serve these paths.
 */
import { queryOptions } from '@tanstack/react-query';
import type { components } from './generated/brain';
import type { ApiClient } from './endpoints';

type S = components['schemas'];

export type KnowledgeMeasurement = S['KnowledgeMeasurementOut'];
export type CropProfile = S['CropProfileOut'];
export type CropProfileDetail = S['CropProfileDetailOut'];
export type NewCropProfile = S['CropProfileIn'];
export type CropProfilePatch = S['CropProfilePatch'];
export type ProfileParameter = S['ProfileParameterOut'];
export type NewProfileParameter = S['ProfileParameterIn'];
export type PlantParameters = S['PlantParametersOut'];
export type NewPlantOverride = S['PlantOverrideIn'];
export type ProfileStage = S['CropStageIO'];

const enc = encodeURIComponent;
const P = '/knowledge/profiles';

export const knowledge = {
  measurements: (c: ApiClient) =>
    c.api<KnowledgeMeasurement[]>({ method: 'GET', path: '/knowledge/measurements' }),
  profiles: (c: ApiClient) => c.api<CropProfile[]>({ method: 'GET', path: P }),
  profile: (c: ApiClient, id: string) =>
    c.api<CropProfileDetail>({ method: 'GET', path: `${P}/${enc(id)}` }),
  create: (c: ApiClient, body: NewCropProfile) =>
    c.api<CropProfileDetail>({ method: 'POST', path: P, body }),
  update: (c: ApiClient, id: string, body: CropProfilePatch) =>
    c.api<CropProfileDetail>({ method: 'PATCH', path: `${P}/${enc(id)}`, body }),
  step: (
    c: ApiClient,
    id: string,
    step: 'new-version' | 'submit' | 'approve' | 'reject' | 'archive',
    note?: string,
  ) =>
    c.api<CropProfileDetail>({
      method: 'POST',
      path: `${P}/${enc(id)}/${step}`,
      ...(step === 'approve' || step === 'reject' ? { body: { note: note ?? null } } : {}),
    }),
  addParameter: (c: ApiClient, profileId: string, body: NewProfileParameter) =>
    c.api<ProfileParameter>({ method: 'POST', path: `${P}/${enc(profileId)}/parameters`, body }),
  updateParameter: (c: ApiClient, profileId: string, id: string, body: NewProfileParameter) =>
    c.api<ProfileParameter>({
      method: 'PUT',
      path: `${P}/${enc(profileId)}/parameters/${enc(id)}`,
      body,
    }),
  removeParameter: (c: ApiClient, id: string) =>
    c.api<null>({ method: 'DELETE', path: `/knowledge/parameters/${enc(id)}` }),
  plantParameters: (c: ApiClient, plantId: string) =>
    c.api<PlantParameters>({ method: 'GET', path: `/plants/${enc(plantId)}/parameters` }),
  addOverride: (c: ApiClient, plantId: string, body: NewPlantOverride) =>
    c.api<S['PlantOverrideOut']>({
      method: 'POST',
      path: `/plants/${enc(plantId)}/overrides`,
      body,
    }),
  /** Copy a plant's own values into a draft of its species' profile (ADR-092). */
  overridesToSpecies: (c: ApiClient, plantId: string) =>
    c.api<CropProfileDetail>({
      method: 'POST',
      path: `/plants/${enc(plantId)}/overrides/to-species`,
    }),
  removeOverride: (c: ApiClient, id: string) =>
    c.api<S['PlantOverrideOut']>({ method: 'DELETE', path: `/knowledge/overrides/${enc(id)}` }),
};

export const knowledgeKeys = {
  all: ['knowledge'] as const,
  measurements: ['knowledge', 'measurements'] as const,
  profiles: ['knowledge', 'profiles'] as const,
  profile: (id: string) => ['knowledge', 'profiles', id] as const,
  plant: (id: string) => ['knowledge', 'plant', id] as const,
};

export const knowledgeQueries = {
  measurements: (c: ApiClient) =>
    queryOptions({
      queryKey: knowledgeKeys.measurements,
      queryFn: () => knowledge.measurements(c),
    }),
  profiles: (c: ApiClient) =>
    queryOptions({ queryKey: knowledgeKeys.profiles, queryFn: () => knowledge.profiles(c) }),
  profile: (c: ApiClient, id: string) =>
    queryOptions({ queryKey: knowledgeKeys.profile(id), queryFn: () => knowledge.profile(c, id) }),
  plant: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: knowledgeKeys.plant(id),
      queryFn: () => knowledge.plantParameters(c, id),
    }),
};
