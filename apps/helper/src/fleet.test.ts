import { describe, expect, it } from 'vitest';
import { findAiNodes } from './fleet';
import type { FleetNode, FleetStatus } from './fleet';

function node(over: Partial<FleetNode>, models: string[] | null): FleetNode {
  return {
    id: 'pc-1',
    name: 'lefi-node-1',
    hostname: 'Fake PC',
    ip: '10.0.0.2',
    os: 'macos',
    arch: 'aarch64',
    enrolled_at: 0,
    last_seen: 1,
    seconds_since_seen: 1,
    connectivity: 'online',
    assigned: [],
    revoked: false,
    active_command: null,
    ai_link: null,
    last_command: null,
    last_install: null,
    ai_endpoint: 'http://10.0.0.2:11434',
    used_by_brain: false,
    ai_bench: null,
    service_outdated: false,
    last_heartbeat: {
      uptime_s: 1,
      disk_free_gb: 1,
      helperd_version: '0',
      services: [],
      report: {
        pc: { model: null, chip: null, cores: null, memory_gb: null, os_version: null },
        metrics: {
          load_1m: null,
          memory_used_gb: null,
          gpu_utilization_pct: null,
          gpu_memory_in_use_gb: null,
        },
        components: [],
        ai: models
          ? {
              version: '0',
              models: models.map((name) => ({ name, size_gb: 1 })),
              loaded: [],
              lan: true,
              kill_switch: false,
            }
          : null,
      },
    },
    ...over,
  };
}

function status(nodes: FleetNode[]): FleetStatus {
  return {
    service: 'running',
    service_registered: 'boot',
    installation_id: 'x',
    main_name: 'lefi-main',
    ca_fingerprint: 'x',
    join_url: 'x',
    update_command: 'x',
    lan_ips: [],
    max_pcs: 3,
    satellite_platform: 'x',
    satellite_available: true,
    remote_install_available: true,
    nodes,
  };
}

describe('findAiNodes', () => {
  const supported = ['fake:supported'];

  it('finds only PCs whose AI answers with a supported model', () => {
    const got = findAiNodes(
      status([
        node({ id: 'a' }, ['fake:supported', 'fake:other']),
        node({ id: 'b' }, ['fake:other']),
        node({ id: 'c' }, null),
        node({ id: 'd', revoked: true }, ['fake:supported']),
      ]),
      supported,
    );
    expect(got.map((n) => n.id)).toEqual(['a']);
    expect(got[0]?.models).toEqual(['fake:supported']);
    expect(got[0]?.url).toBe('http://10.0.0.2:11434');
  });

  it('puts the PCs online first and survives a stopped service or an old PC', () => {
    const got = findAiNodes(
      status([
        node({ id: 'late', connectivity: 'offline' }, ['fake:supported']),
        node({ id: 'now' }, ['fake:supported']),
        node({ id: 'old', last_heartbeat: null }, null),
      ]),
      supported,
    );
    expect(got.map((n) => n.id)).toEqual(['now', 'late']);
    expect(findAiNodes({ service: 'stopped', service_registered: 'none' }, supported)).toEqual([]);
    expect(findAiNodes(null, supported)).toEqual([]);
  });
});
