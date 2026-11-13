/**
 * The Robot Mission Center as the real Lefi Brain serves it (ADR-091): the simulated MH3 (Genesis),
 * its scene for the 2D map, missions and the commands Lefi Brain sent. Every type is GENERATED from
 * its OpenAPI document; everything here is SIMULATED.
 */
import { queryOptions } from '@tanstack/react-query';
import type { components } from './generated/brain';
import type { ApiClient } from './endpoints';

type S = components['schemas'];

export type SimRobot = S['RobotOut'];
export type SimRobotState = S['RobotStateOut'];
export type SimRobotPose = S['RobotPoseOut'];
export type SimScene = S['RobotSceneOut'];
export type SimStation = S['SceneStationOut'];
export type SimMission = S['RobotMissionOut'];
export type SimMissionKind = S['MissionKind'];
export type SimRobotCommand = S['RobotCommandOut'];
export type SimFrame = S['RobotFrameOut'];
export type SimRobotPlace = S['RobotPlaceOut'];
export type SimRobotDevice = S['RobotDeviceOut'];
export type SimRobotBackend = S['Backend'];
export type SimRobotPowerDetail = S['RobotPowerDetailOut'];

const enc = encodeURIComponent;

export const robotics = {
  robots: (c: ApiClient) => c.api<SimRobot[]>({ method: 'GET', path: '/robots' }),
  scene: (c: ApiClient, robotId: string) =>
    c.api<SimScene>({ method: 'GET', path: `/robots/${enc(robotId)}/scene` }),
  commands: (c: ApiClient, robotId: string) =>
    c.api<SimRobotCommand[]>({
      method: 'GET',
      path: `/robots/${enc(robotId)}/commands`,
      query: { limit: 40 },
    }),
  missions: (c: ApiClient, robotId: string) =>
    c.api<SimMission[]>({
      method: 'GET',
      path: '/robot-missions',
      query: { robot_id: robotId, limit: 20 },
    }),
  frame: (c: ApiClient, robotId: string, feed: string) =>
    c.api<SimFrame>({ method: 'GET', path: `/robots/${enc(robotId)}/frames/${enc(feed)}` }),
  photo: (c: ApiClient, missionId: string) =>
    c.api<SimFrame>({ method: 'GET', path: `/robot-missions/${enc(missionId)}/photo` }),
  start: (
    c: ApiClient,
    body: { robot_id: string; station_id: string; kind: SimMissionKind; idempotency_key: string },
  ) => c.api<SimMission>({ method: 'POST', path: '/robot-missions', body }),
  cancel: (c: ApiClient, missionId: string) =>
    c.api<SimMission>({ method: 'POST', path: `/robot-missions/${enc(missionId)}/cancel` }),
  stop: (c: ApiClient, robotId: string) =>
    c.api<SimRobotCommand>({ method: 'POST', path: `/robots/${enc(robotId)}/stop` }),
  /** Where the simulated robot may be installed (ADR-090): never the AI node's PC. */
  places: (c: ApiClient) => c.api<SimRobotPlace[]>({ method: 'GET', path: '/robot-places' }),
  /** Lefi Crop Helper installs it on that PC; progress shows in `device`. */
  add: (c: ApiClient, body: { node_id: string; backend: SimRobotBackend; cpu: boolean }) =>
    c.api<SimRobot>({ method: 'POST', path: '/robots', body }),
  power: (c: ApiClient, robotId: string, on: boolean) =>
    c.api<SimRobot>({ method: 'POST', path: `/robots/${enc(robotId)}/power`, body: { on } }),
  remove: (c: ApiClient, robotId: string) =>
    c.api<SimRobot>({ method: 'DELETE', path: `/robots/${enc(robotId)}` }),
  /** Install again on the same PC (missing or broken files, ADR-104). */
  reinstall: (c: ApiClient, robotId: string, cpu = false) =>
    c.api<SimRobot>({ method: 'POST', path: `/robots/${enc(robotId)}/reinstall`, body: { cpu } }),
};

/** The robot moves: its pose is read twice a second (until the WebSocket exists). */
export const ROBOT_POLL_MS = 500;
export const ROBOT_LIST_POLL_MS = 2_000;

export const roboticsKeys = {
  all: ['robotics'] as const,
  robots: ['robotics', 'robots'] as const,
  scene: (id: string) => ['robotics', 'scene', id] as const,
  commands: (id: string) => ['robotics', 'commands', id] as const,
  missions: (id: string) => ['robotics', 'missions', id] as const,
  photo: (id: string) => ['robotics', 'photo', id] as const,
  places: ['robotics', 'places'] as const,
};

export const roboticsQueries = {
  robots: (c: ApiClient) =>
    queryOptions({
      queryKey: roboticsKeys.robots,
      queryFn: () => robotics.robots(c),
      refetchInterval: ROBOT_POLL_MS,
    }),
  scene: (c: ApiClient, robotId: string) =>
    queryOptions({
      queryKey: roboticsKeys.scene(robotId),
      queryFn: () => robotics.scene(c, robotId),
      staleTime: 60_000,
    }),
  commands: (c: ApiClient, robotId: string) =>
    queryOptions({
      queryKey: roboticsKeys.commands(robotId),
      queryFn: () => robotics.commands(c, robotId),
      refetchInterval: ROBOT_LIST_POLL_MS,
    }),
  missions: (c: ApiClient, robotId: string) =>
    queryOptions({
      queryKey: roboticsKeys.missions(robotId),
      queryFn: () => robotics.missions(c, robotId),
      refetchInterval: ROBOT_LIST_POLL_MS,
    }),
  places: (c: ApiClient) =>
    queryOptions({ queryKey: roboticsKeys.places, queryFn: () => robotics.places(c) }),
  photo: (c: ApiClient, missionId: string) =>
    queryOptions({
      queryKey: roboticsKeys.photo(missionId),
      queryFn: () => robotics.photo(c, missionId),
      staleTime: Infinity,
    }),
};
