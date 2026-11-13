/**
 * Mock global search (top bar): zones, devices, batches, plants, incidents, tasks and people,
 * each only if the actor may open that screen, with a link the app can navigate to.
 */
import { ZONES } from './design-data.ts';
import * as crop from './crops.ts';
import * as dev from './devices.ts';
import * as inc from './incidents.ts';
import { scoped as tasksFor } from './tasks.ts';
import { PEOPLE, personId } from './workforce.ts';

type Actor = Parameters<typeof tasksFor>[0];
const can = (a: Actor, p: string) => a.permissions.includes(p);

type Hit = {
  kind: string;
  id: string;
  label: string;
  sub: string;
  icon: string;
  to: string;
  search: Record<string, string>;
};

export function search(a: Actor, q: URLSearchParams) {
  const t = (q.get('q') ?? '').trim().toLowerCase();
  if (t.length < 2) return [];
  const has = (...xs: string[]) => xs.join(' ').toLowerCase().includes(t);
  const zones = new Set(crop.scope(a).zones.map((z) => z.id));
  const hits: Hit[] = [];
  if (can(a, 'nav.zones'))
    ZONES.filter((z) => zones.has(z.id) && has(z.id, z.name, z.crop)).forEach((z) =>
      hits.push({
        kind: 'Zone',
        id: z.id,
        label: `${z.id} · ${z.name}`,
        sub: z.crop,
        icon: 'grid_view',
        to: '/zones',
        search: { zone: z.id },
      }),
    );
  if (can(a, 'nav.devices'))
    dev
      .searchRows()
      .filter((d) => has(d.id, d.type, d.brand, d.model, d.serial))
      .forEach((d) =>
        hits.push({
          kind: 'Device',
          id: d.id,
          label: d.id,
          sub: `${d.type} · ${d.zone}`,
          icon: 'device_hub',
          to: '/devices',
          search: { device: d.id },
        }),
      );
  if (can(a, 'nav.greenhouses')) {
    const c = crop.searchRows(a);
    c.batches
      .filter((b) => has(b.id, b.variety))
      .forEach((b) =>
        hits.push({
          kind: 'Crop batch',
          id: b.id,
          label: `${b.id} · ${b.variety}`,
          sub: b.zone,
          icon: 'potted_plant',
          to: '/greenhouses',
          search: { gh: b.gh, zone: b.zone, batch: b.id },
        }),
      );
    c.plants
      .filter((p) => has(p.id))
      .forEach((p) =>
        hits.push({
          kind: 'Plant',
          id: p.id,
          label: p.id,
          sub: `${p.variety} · ${p.batch} · ${p.row}`,
          icon: 'eco',
          to: '/greenhouses',
          search: { gh: p.gh, zone: p.zone, batch: p.batch, plant: p.id },
        }),
      );
  }
  if (can(a, 'nav.alerts'))
    inc
      .searchRows()
      .filter((r) => has(r.id, r.title))
      .forEach((r) =>
        hits.push({
          kind: 'Incident',
          id: r.id,
          label: `${r.id} · ${r.title}`,
          sub: `${r.status} · ${r.zone}`,
          icon: 'crisis_alert',
          to: '/alerts',
          search: { incident: r.id },
        }),
      );
  if (can(a, 'nav.tasks'))
    tasksFor(a)
      .filter((x) => has(x.id, x.title))
      .forEach((x) =>
        hits.push({
          kind: 'Task',
          id: x.id,
          label: `${x.id} · ${x.title}`,
          sub: `${x.status} · ${x.assignee}`,
          icon: 'task_alt',
          to: '/tasks',
          search: { task: x.id },
        }),
      );
  if (can(a, 'nav.workforce'))
    PEOPLE.filter((p) => has(p.name, p.email)).forEach((p) =>
      hits.push({
        kind: 'Person',
        id: personId(p.name),
        label: p.name,
        sub: p.email,
        icon: 'person',
        to: '/workforce',
        search: { person: personId(p.name) },
      }),
    );
  return hits.slice(0, 12);
}
