import { useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { EmptyState, Segmented } from '../../shared/ui';
import { ParametersSection } from './ParametersSection';
import { ProfilesSection } from './ProfilesSection';
import live from '../live/live.module.css';

type Section = 'profiles' | 'parameters' | 'documents' | 'retrieval' | 'rules';

const NEXT: Record<'documents' | 'retrieval' | 'rules', { title: string; body: string }> = {
  documents: {
    title: 'Knowledge documents: next step',
    body: 'Upload PDF, Markdown and TXT with their review and approval (Uploaded → Processing → Indexed → Pending review → Approved → Active). Not built yet: nothing is uploaded or read.',
  },
  retrieval: {
    title: 'Knowledge retrieval (local RAG): next step',
    body: 'Approved documents, split and indexed on this Lefi Brain with a local embedding model (embeddinggemma), searched with crop and stage filters and cited in Lefi AI answers. Not built yet.',
  },
  rules: {
    title: 'Agronomic rules: next step',
    body: 'Deterministic rules by crop and stage, tested in a safe simulation mode before activation; their actions are observations, alerts and proposals only. Not built yet — today alerts come from the ranges people set (Alerts & Incidents → Rules).',
  },
};

/**
 * AI Knowledge Center (ADR-086): what Lefi Brain should know. AI Plant Health records what it
 * observes; this manages crop profiles and their parameters. Documents, retrieval and agronomic
 * rules come next and say so instead of showing anything.
 */
/** The route: `?section=parameters&profile=<id>` opens one profile's parameters (e.g. from a
 * zone's ranges in Environmental Monitoring). */
export function KnowledgeRoute() {
  const search = useSearch({ strict: false }) as { section?: Section; profile?: string };
  return <KnowledgeLive section={search.section} profile={search.profile} />;
}

export function KnowledgeLive(open: { section?: Section; profile?: string } = {}) {
  const [section, setSection] = useState<Section>(open.section ?? 'profiles');
  const [profile, setProfile] = useState<string | undefined>(open.profile);
  return (
    <>
      <div className={live.toolbar}>
        <Segmented<Section>
          label="Knowledge sections"
          value={section}
          onChange={setSection}
          options={[
            { value: 'profiles', label: 'Agronomic profiles' },
            { value: 'parameters', label: 'Environmental parameters' },
            { value: 'documents', label: 'Documents' },
            { value: 'retrieval', label: 'Knowledge retrieval' },
            { value: 'rules', label: 'Agronomic rules' },
          ]}
        />
      </div>
      {section === 'profiles' && <ProfilesSection selected={profile} onSelect={setProfile} />}
      {section === 'parameters' && <ParametersSection selected={profile} onSelect={setProfile} />}
      {(section === 'documents' || section === 'retrieval' || section === 'rules') && (
        <EmptyState mascot="curious" title={NEXT[section].title}>
          {NEXT[section].body}
        </EmptyState>
      )}
    </>
  );
}

/** Against the development mock: this screen exists only with the real Lefi Brain. */
export function KnowledgeNotInMock() {
  return (
    <EmptyState mascot="curious" title="AI Knowledge Center needs the real Lefi Brain">
      The mock Brain has no crop profiles: connect to a real Lefi Brain to manage them.
    </EmptyState>
  );
}
