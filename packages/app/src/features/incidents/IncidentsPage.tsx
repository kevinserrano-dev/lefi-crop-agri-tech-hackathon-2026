import { useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { DEFAULT_FILTERS, IncidentList, type ListFilters } from './IncidentList';
import { IncidentDetailView } from './IncidentDetail';

/**
 * Alerts & Incidents (design). `?incident=<id>` opens the detail; filters survive going back
 * because this component stays mounted.
 */
export function IncidentsPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { incident?: string };
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const open = (incident?: string) =>
    void navigate({ to: '/alerts', search: incident ? { incident } : {} });

  return search.incident ? (
    <IncidentDetailView id={search.incident} onBack={() => open()} />
  ) : (
    <IncidentList filters={filters} onFilters={setFilters} onOpen={open} />
  );
}
