/**
 * What the real Lefi Brain serves for field devices, plants and readings (ADR-052). Every type is
 * GENERATED from its OpenAPI document — nothing here is a proposal, and the mock Brain does not
 * serve these paths (screens use them only against the real Lefi Brain, ADR-049).
 */
import { queryOptions } from '@tanstack/react-query';
import type { components } from './generated/brain';
import type { ApiClient } from './endpoints';

type S = components['schemas'];

export type NodeProfile = S['ProfileOut'];
export type NodeChannel = S['ChannelOut'];
export type FieldDevice = S['DeviceOut'];
export type FieldDeviceDetail = S['DeviceDetailOut'];
export type NewFieldDevice = S['DeviceIn'];
export type FieldDevicePatch = S['DevicePatch'];
export type FieldSensor = S['SensorOut'];
export type SensorLatest = S['LatestOut'];
export type SensorConfig = S['SensorConfigIn'];
export type DeviceCredentials = S['CredentialsOut'];
export type AvailableSensor = S['AvailableSensorOut'];
export type DeviceEvent = S['DeviceEventOut'];
export type DeviceHealth = S['DeviceHealthOut'];
export type BoardLogLine = S['LogLineOut'];
export type Enrolment = S['EnrolmentOut'];
export type EnrolmentAccept = S['EnrolmentAcceptIn'];
export type DeviceNetwork = NonNullable<FieldDevice['network']>;
export type GreenhouseItem = S['GreenhouseOut'];
export type ZoneItem = S['ZoneOut'];
export type NewZoneItem = S['ZoneIn'];
export type ZonePatch = S['ZonePatch'];
export type ZonePurpose = NonNullable<ZoneItem['purpose']>;
export type GrowingSystem = S['GrowingSystem'];
export type ClimateControl = ZoneItem['climate_control'];
export type PlaceStatus = ZoneItem['status'];
export type ContainerItem = S['ContainerOut'];
export type GrowingLocation = ContainerItem;
export type LocationKind = ContainerItem['kind'];
export type CapacityUnit = NonNullable<ContainerItem['capacity_unit']>;
export type LocationSummary = NonNullable<ContainerItem['summary']>;
export type CropAssignment = S['CropAssignmentOut'];
export type NewCropAssignment = S['CropAssignmentIn'];
export type CropAssignmentPatch = S['CropAssignmentPatch'];
export type CropEnd = S['CropEndIn'];
export type GrowthStage = NonNullable<CropAssignment['growth_stage']>;
export type NewContainer = S['ContainerIn'];
export type ContainerPatch = S['ContainerPatch'];
export type InventoryItem = S['InventoryItemOut'];
export type NewInventoryItem = S['InventoryItemIn'];
export type InventoryItemPatch = S['InventoryItemPatch'];
export type InventoryCategory = InventoryItem['category'];
export type CropType = S['CropTypeOut'];
export type PlantItem = S['PlantOut'];
export type NewPlant = S['PlantIn'];
export type PlantPatch = S['PlantPatch'];
export type PlantSensors = S['PlantSensorsOut'];
export type PlantSensor = S['PlantSensorOut'];
export type ReadingPage = S['ReadingPage'];
export type SensorScope = FieldSensor['scope'];
export type Camera = S['CameraOut'];
export type NewCamera = S['CameraIn'];
export type CameraPatch = S['CameraPatch'];
/** The zones a camera looks at (ADR-087); an older Lefi Brain sends only `zone_id`. */
export const cameraZones = (c: Camera): string[] =>
  (c.zone_ids as string[] | undefined) ?? (c.zone_id ? [c.zone_id] : []);
export type UsbCamera = S['UsbCameraOut'];
export type UsbScan = S['UsbScanOut'];
export type CameraState = S['CameraStateOut'];
export type CameraFrame = S['FrameOut'];
export type CameraCommand = S['CommandOut'];
export type NewCameraCommand = S['CommandIn'];
export type CameraPhoto = S['PhotoOut'];
export type CameraPhotoImage = S['PhotoImageOut'];
/** Zone markers, zone views, calibration and Lefi AI looking at photos (ADR-088). */
export type ZoneMarker = S['MarkerOut'];
export type ZoneViewT = S['ViewOut'];
export type NewZoneView = S['ViewIn'];
export type Calibration = S['CalibrationOut'];
export type PhotoAnalysis = S['AnalysisOut'];
export type VisionStatus = S['VisionStatusOut'];

const enc = encodeURIComponent;
const get = <T>(c: ApiClient, path: string, query?: Record<string, string | number | undefined>) =>
  c.api<T>({ method: 'GET', path, ...(query ? { query } : {}) });
const send = <T>(
  c: ApiClient,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
) => c.api<T>({ method, path, ...(body === undefined ? {} : { body }) });

export const live = {
  profiles: (c: ApiClient) => get<NodeProfile[]>(c, '/node-profiles'),
  devices: (c: ApiClient) => get<FieldDevice[]>(c, '/field-devices'),
  device: (c: ApiClient, id: string) => get<FieldDeviceDetail>(c, `/field-devices/${enc(id)}`),
  addDevice: (c: ApiClient, body: NewFieldDevice) =>
    send<FieldDeviceDetail>(c, 'POST', '/field-devices', body),
  updateDevice: (c: ApiClient, id: string, body: FieldDevicePatch) =>
    send<FieldDeviceDetail>(c, 'PATCH', `/field-devices/${enc(id)}`, body),
  approveDevice: (c: ApiClient, id: string) =>
    send<FieldDeviceDetail>(c, 'POST', `/field-devices/${enc(id)}/approve`),
  retireDevice: (c: ApiClient, id: string) =>
    send<FieldDeviceDetail>(c, 'POST', `/field-devices/${enc(id)}/retire`),
  credentials: (c: ApiClient, id: string) =>
    send<DeviceCredentials>(c, 'POST', `/field-devices/${enc(id)}/credentials`),
  configureSensor: (c: ApiClient, deviceId: string, key: string, body: SensorConfig) =>
    send<FieldSensor>(c, 'PUT', `/field-devices/${enc(deviceId)}/sensors/${enc(key)}`, body),
  deviceEvents: (c: ApiClient, id: string, limit = 20) =>
    get<DeviceEvent[]>(c, `/field-devices/${enc(id)}/events`, { limit }),
  deviceLogs: (c: ApiClient, id: string, minLevel: BoardLogLine['level'] = 'debug') =>
    get<BoardLogLine[]>(c, `/field-devices/${enc(id)}/logs`, { min_level: minLevel }),
  addSensor: (c: ApiClient, deviceId: string, sensor_key: string) =>
    send<FieldSensor>(c, 'POST', `/field-devices/${enc(deviceId)}/sensors`, { sensor_key }),
  removeSensor: (c: ApiClient, deviceId: string, key: string) =>
    send<null>(c, 'DELETE', `/field-devices/${enc(deviceId)}/sensors/${enc(key)}`),
  enrolments: (c: ApiClient) => get<Enrolment[]>(c, '/field-device-enrolments'),
  acceptEnrolment: (c: ApiClient, id: string, body: EnrolmentAccept) =>
    send<FieldDeviceDetail>(c, 'POST', `/field-device-enrolments/${enc(id)}/accept`, body),
  rejectEnrolment: (c: ApiClient, id: string) =>
    send<Enrolment>(c, 'POST', `/field-device-enrolments/${enc(id)}/reject`),
  enrolmentAccount: (c: ApiClient) =>
    send<DeviceCredentials>(c, 'POST', '/field-device-enrolments/account'),

  /** USB cameras on Lefi Brain's PC (ADR-073). */
  cameras: (c: ApiClient, includeRetired = false) =>
    get<Camera[]>(c, '/cameras', includeRetired ? { include_retired: 'true' } : undefined),
  camera: (c: ApiClient, id: string) => get<Camera>(c, `/cameras/${enc(id)}`),
  usbCameras: (c: ApiClient) => get<UsbScan>(c, '/cameras/usb'),
  addCamera: (c: ApiClient, body: NewCamera) => send<Camera>(c, 'POST', '/cameras', body),
  updateCamera: (c: ApiClient, id: string, body: CameraPatch) =>
    send<Camera>(c, 'PATCH', `/cameras/${enc(id)}`, body),
  retireCamera: (c: ApiClient, id: string) => send<Camera>(c, 'POST', `/cameras/${enc(id)}/retire`),
  /** Preview and commands (ADR-074). */
  cameraState: (c: ApiClient, id: string) => get<CameraState>(c, `/cameras/${enc(id)}/state`),
  cameraFrame: (c: ApiClient, id: string) => get<CameraFrame>(c, `/cameras/${enc(id)}/frame`),
  cameraCommands: (c: ApiClient, id: string, limit = 30) =>
    get<CameraCommand[]>(c, `/cameras/${enc(id)}/commands`, { limit }),
  /** Photos (ADR-079). */
  takePhoto: (c: ApiClient, id: string, note?: string) =>
    send<CameraPhoto>(c, 'POST', `/cameras/${enc(id)}/photos`, { note: note ?? null }),
  cameraPhotos: (c: ApiClient, id: string, limit = 12) =>
    get<CameraPhoto[]>(c, `/cameras/${enc(id)}/photos`, { limit }),
  cameraPhoto: (c: ApiClient, photoId: string) =>
    get<CameraPhotoImage>(c, `/camera-photos/${enc(photoId)}`),
  zoneMarker: (c: ApiClient, zoneId: string) => get<ZoneMarker>(c, `/zones/${enc(zoneId)}/marker`),
  cameraViews: (c: ApiClient, id: string) => get<ZoneViewT[]>(c, `/cameras/${enc(id)}/views`),
  zoneViews: (c: ApiClient, zoneId: string) =>
    get<ZoneViewT[]>(c, '/camera-views', { zone_id: zoneId }),
  saveViews: (c: ApiClient, id: string, views: NewZoneView[]) =>
    send<ZoneViewT[]>(c, 'PUT', `/cameras/${enc(id)}/views`, views),
  setViewEvery: (c: ApiClient, id: string, zoneId: string, every: number | null) =>
    send<ZoneViewT>(c, 'PATCH', `/cameras/${enc(id)}/views/${enc(zoneId)}`, {
      every_minutes: every,
    }),
  removeView: (c: ApiClient, id: string, zoneId: string) =>
    send<void>(c, 'DELETE', `/cameras/${enc(id)}/views/${enc(zoneId)}`),
  viewHere: (c: ApiClient, id: string, zoneId: string, every: number | null) =>
    send<ZoneViewT>(c, 'POST', `/cameras/${enc(id)}/views/${enc(zoneId)}/here`, {
      every_minutes: every,
    }),
  goToView: (c: ApiClient, id: string, zoneId: string) =>
    send<CameraCommand | null>(c, 'POST', `/cameras/${enc(id)}/views/${enc(zoneId)}/go`),
  scanNow: (c: ApiClient, id: string, zoneIds?: string[]) =>
    send<CameraPhoto[]>(c, 'POST', `/cameras/${enc(id)}/scan`, { zone_ids: zoneIds ?? null }),
  startCalibration: (c: ApiClient, id: string) =>
    send<Calibration>(c, 'POST', `/cameras/${enc(id)}/calibration`),
  calibration: (c: ApiClient, id: string) =>
    get<Calibration | null>(c, `/cameras/${enc(id)}/calibration`),
  cancelCalibration: (c: ApiClient, id: string) =>
    send<Calibration | null>(c, 'DELETE', `/cameras/${enc(id)}/calibration`),
  visionStatus: (c: ApiClient) => get<VisionStatus>(c, '/vision/status'),
  analysePhoto: (c: ApiClient, photoId: string) =>
    send<PhotoAnalysis>(c, 'POST', `/camera-photos/${enc(photoId)}/analyses`),
  photoAnalyses: (c: ApiClient, photoIds: string[]) =>
    get<PhotoAnalysis[]>(c, '/photo-analyses', { photo_ids: photoIds.join(',') }),
  judgeAnalysis: (c: ApiClient, id: string, verdict: 'correct' | 'wrong') =>
    send<PhotoAnalysis>(c, 'POST', `/photo-analyses/${enc(id)}/verdict`, { verdict }),
  /** Photos taken for a zone by the cameras looking at it then (ADR-087). */
  zonePhotos: (c: ApiClient, zoneId: string, limit = 24) =>
    get<CameraPhoto[]>(c, '/camera-photos', { zone_id: zoneId, limit }),
  sendCameraCommand: (c: ApiClient, id: string, body: NewCameraCommand) =>
    send<CameraCommand>(c, 'POST', `/cameras/${enc(id)}/commands`, body),

  greenhouses: (c: ApiClient) => get<GreenhouseItem[]>(c, '/greenhouses'),
  addGreenhouse: (c: ApiClient, name: string) =>
    send<GreenhouseItem>(c, 'POST', '/greenhouses', { name }),
  renameGreenhouse: (c: ApiClient, id: string, name: string) =>
    send<GreenhouseItem>(c, 'PATCH', `/greenhouses/${enc(id)}`, { name }),
  removeGreenhouse: (c: ApiClient, id: string) =>
    send<null>(c, 'DELETE', `/greenhouses/${enc(id)}`),
  zones: (c: ApiClient) => get<ZoneItem[]>(c, '/zones'),
  addZone: (c: ApiClient, body: NewZoneItem) => send<ZoneItem>(c, 'POST', '/zones', body),
  updateZone: (c: ApiClient, id: string, body: ZonePatch) =>
    send<ZoneItem>(c, 'PATCH', `/zones/${enc(id)}`, body),
  removeZone: (c: ApiClient, id: string) => send<null>(c, 'DELETE', `/zones/${enc(id)}`),
  containers: (c: ApiClient) => get<ContainerItem[]>(c, '/containers'),
  addContainer: (c: ApiClient, body: NewContainer) =>
    send<ContainerItem>(c, 'POST', '/containers', body),
  updateContainer: (c: ApiClient, id: string, body: ContainerPatch) =>
    send<ContainerItem>(c, 'PATCH', `/containers/${enc(id)}`, body),
  removeContainer: (c: ApiClient, id: string) => send<null>(c, 'DELETE', `/containers/${enc(id)}`),
  cropAssignments: (c: ApiClient, query: { location_id?: string; include_ended?: boolean } = {}) =>
    get<CropAssignment[]>(c, '/crop-assignments', {
      location_id: query.location_id,
      include_ended: query.include_ended ? 'true' : undefined,
    }),
  assignCrop: (c: ApiClient, body: NewCropAssignment) =>
    send<CropAssignment>(c, 'POST', '/crop-assignments', body),
  updateCropAssignment: (c: ApiClient, id: string, body: CropAssignmentPatch) =>
    send<CropAssignment>(c, 'PATCH', `/crop-assignments/${enc(id)}`, body),
  endCropAssignment: (c: ApiClient, id: string, body: CropEnd) =>
    send<CropAssignment>(c, 'POST', `/crop-assignments/${enc(id)}/end`, body),
  inventory: (c: ApiClient, zoneId?: string) =>
    get<InventoryItem[]>(c, '/inventory-items', { zone_id: zoneId }),
  addInventoryItem: (c: ApiClient, body: NewInventoryItem) =>
    send<InventoryItem>(c, 'POST', '/inventory-items', body),
  updateInventoryItem: (c: ApiClient, id: string, body: InventoryItemPatch) =>
    send<InventoryItem>(c, 'PATCH', `/inventory-items/${enc(id)}`, body),
  removeInventoryItem: (c: ApiClient, id: string) =>
    send<null>(c, 'DELETE', `/inventory-items/${enc(id)}`),
  cropTypes: (c: ApiClient) => get<CropType[]>(c, '/crop-types'),
  addCropType: (c: ApiClient, body: S['CropTypeIn']) =>
    send<CropType>(c, 'POST', '/crop-types', body),
  plants: (c: ApiClient) => get<PlantItem[]>(c, '/plants'),
  addPlant: (c: ApiClient, body: NewPlant) => send<PlantItem>(c, 'POST', '/plants', body),
  updatePlant: (c: ApiClient, id: string, body: PlantPatch) =>
    send<PlantItem>(c, 'PATCH', `/plants/${enc(id)}`, body),
  retirePlant: (c: ApiClient, id: string) =>
    send<PlantItem>(c, 'POST', `/plants/${enc(id)}/retire`),
  plantSensors: (c: ApiClient, id: string) => get<PlantSensors>(c, `/plants/${enc(id)}/sensors`),
  readings: (c: ApiClient, sensorId: string, variable?: string, limit = 50) =>
    get<ReadingPage>(c, `/sensors/${enc(sensorId)}/readings`, { variable, limit }),
};

/** Live views poll until the WebSocket feed exists. */
export const LIVE_POLL_MS = 10_000;

export const liveKeys = {
  all: ['live'] as const,
  devices: ['live', 'field-devices'] as const,
  device: (id: string) => ['live', 'field-devices', id] as const,
  profiles: ['live', 'profiles'] as const,
  enrolments: ['live', 'enrolments'] as const,
  deviceEvents: (id: string) => ['live', 'field-devices', id, 'events'] as const,
  deviceLogs: (id: string, level: string) => ['live', 'field-devices', id, 'logs', level] as const,
  places: ['live', 'places'] as const,
  cameras: ['live', 'cameras'] as const,
  usbCameras: ['live', 'cameras', 'usb'] as const,
  cameraState: (id: string) => ['live', 'cameras', id, 'state'] as const,
  cameraCommands: (id: string) => ['live', 'cameras', id, 'commands'] as const,
  // Not under 'live': a command must not refetch every frame, and frames never invalidate others.
  cameraFrame: (id: string) => ['camera-frame', id] as const,
  cameraPhotos: (id: string) => ['live', 'cameras', id, 'photos'] as const,
  // A photo never changes: kept apart from 'live' so refreshes do not download it again.
  cameraPhoto: (photoId: string) => ['camera-photo', photoId] as const,
  // Under 'live', 'cameras': taking any photo refreshes the zone galleries too.
  zonePhotos: (zoneId: string) => ['live', 'cameras', 'zone-photos', zoneId] as const,
  cameraViews: (id: string) => ['live', 'cameras', id, 'views'] as const,
  zoneViews: (zoneId: string) => ['live', 'cameras', 'zone-views', zoneId] as const,
  calibration: (id: string) => ['live', 'cameras', id, 'calibration'] as const,
  visionStatus: ['live', 'vision', 'status'] as const,
  photoAnalyses: (ids: string[]) => ['live', 'vision', 'analyses', ids.join(',')] as const,
  plants: ['live', 'plants'] as const,
  inventory: ['live', 'inventory'] as const,
  crops: ['live', 'crop-assignments'] as const,
  cropHistory: (locationId: string) => ['live', 'crop-assignments', locationId] as const,
  plantSensors: (id: string) => ['live', 'plants', id, 'sensors'] as const,
  readings: (sensorId: string, variable?: string) =>
    ['live', 'readings', sensorId, variable ?? ''] as const,
};

/** Everything a place picker needs, in one query. */
export interface Places {
  greenhouses: GreenhouseItem[];
  zones: ZoneItem[];
  containers: ContainerItem[];
  cropTypes: CropType[];
}

export const liveQueries = {
  devices: (c: ApiClient) =>
    queryOptions({
      queryKey: liveKeys.devices,
      queryFn: () => live.devices(c),
      refetchInterval: LIVE_POLL_MS,
    }),
  device: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: liveKeys.device(id),
      queryFn: () => live.device(c, id),
      refetchInterval: LIVE_POLL_MS,
    }),
  profiles: (c: ApiClient) =>
    queryOptions({ queryKey: liveKeys.profiles, queryFn: () => live.profiles(c) }),
  deviceEvents: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: liveKeys.deviceEvents(id),
      queryFn: () => live.deviceEvents(c, id),
      refetchInterval: LIVE_POLL_MS,
    }),
  enrolments: (c: ApiClient) =>
    queryOptions({
      queryKey: liveKeys.enrolments,
      queryFn: () => live.enrolments(c),
      refetchInterval: LIVE_POLL_MS,
    }),
  cameras: (c: ApiClient) =>
    queryOptions({
      queryKey: liveKeys.cameras,
      queryFn: () => live.cameras(c),
      refetchInterval: LIVE_POLL_MS,
    }),
  /** What is plugged into Lefi Brain's PC: checked more often while someone is adding one. */
  usbCameras: (c: ApiClient) =>
    queryOptions({
      queryKey: liveKeys.usbCameras,
      queryFn: () => live.usbCameras(c),
      refetchInterval: 3_000,
    }),
  cameraState: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: liveKeys.cameraState(id),
      queryFn: () => live.cameraState(c, id),
      refetchInterval: 2_000,
    }),
  cameraCommands: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: liveKeys.cameraCommands(id),
      queryFn: () => live.cameraCommands(c, id),
      refetchInterval: LIVE_POLL_MS,
    }),
  cameraPhotos: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: liveKeys.cameraPhotos(id),
      queryFn: () => live.cameraPhotos(c, id),
      refetchInterval: LIVE_POLL_MS,
    }),
  cameraPhoto: (c: ApiClient, photoId: string) =>
    queryOptions({
      queryKey: liveKeys.cameraPhoto(photoId),
      queryFn: () => live.cameraPhoto(c, photoId),
      staleTime: Infinity,
    }),
  zonePhotos: (c: ApiClient, zoneId: string) =>
    queryOptions({
      queryKey: liveKeys.zonePhotos(zoneId),
      queryFn: () => live.zonePhotos(c, zoneId),
      refetchInterval: LIVE_POLL_MS,
    }),
  cameraViews: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: liveKeys.cameraViews(id),
      queryFn: () => live.cameraViews(c, id),
      refetchInterval: LIVE_POLL_MS,
    }),
  zoneViews: (c: ApiClient, zoneId: string) =>
    queryOptions({
      queryKey: liveKeys.zoneViews(zoneId),
      queryFn: () => live.zoneViews(c, zoneId),
      refetchInterval: LIVE_POLL_MS,
    }),
  /** Every second while it runs; then it stays as it ended until the next run. */
  calibration: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: liveKeys.calibration(id),
      queryFn: () => live.calibration(c, id),
      refetchInterval: (q) => (q.state.data?.state === 'running' ? 1_000 : false),
    }),
  visionStatus: (c: ApiClient) =>
    queryOptions({
      queryKey: liveKeys.visionStatus,
      queryFn: () => live.visionStatus(c),
      refetchInterval: 60_000,
    }),
  /** Faster while one is still waiting for Lefi AI. */
  photoAnalyses: (c: ApiClient, ids: string[]) =>
    queryOptions({
      queryKey: liveKeys.photoAnalyses(ids),
      queryFn: () => live.photoAnalyses(c, ids),
      enabled: ids.length > 0,
      refetchInterval: (q) =>
        q.state.data?.some((a) => a.status === 'pending') ? 2_000 : LIVE_POLL_MS,
    }),
  /** Snapshots, where live streaming is not available: about two frames a second. */
  cameraFrame: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: liveKeys.cameraFrame(id),
      queryFn: () => live.cameraFrame(c, id),
      refetchInterval: 500,
      refetchIntervalInBackground: false,
      gcTime: 0,
    }),
  places: (c: ApiClient) =>
    queryOptions({
      queryKey: liveKeys.places,
      queryFn: async (): Promise<Places> => {
        const [greenhouses, zones, containers, cropTypes] = await Promise.all([
          live.greenhouses(c),
          live.zones(c),
          live.containers(c),
          live.cropTypes(c),
        ]);
        return { greenhouses, zones, containers, cropTypes };
      },
    }),
  plants: (c: ApiClient) =>
    queryOptions({ queryKey: liveKeys.plants, queryFn: () => live.plants(c) }),
  inventory: (c: ApiClient) =>
    queryOptions({ queryKey: liveKeys.inventory, queryFn: () => live.inventory(c) }),
  /** Active crops everywhere. */
  crops: (c: ApiClient) =>
    queryOptions({ queryKey: liveKeys.crops, queryFn: () => live.cropAssignments(c) }),
  /** Every crop a location has had, ended ones included. */
  cropHistory: (c: ApiClient, locationId: string) =>
    queryOptions({
      queryKey: liveKeys.cropHistory(locationId),
      queryFn: () => live.cropAssignments(c, { location_id: locationId, include_ended: true }),
    }),
  plantSensors: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: liveKeys.plantSensors(id),
      queryFn: () => live.plantSensors(c, id),
      refetchInterval: LIVE_POLL_MS,
    }),
  readings: (c: ApiClient, sensorId: string, variable?: string) =>
    queryOptions({
      queryKey: liveKeys.readings(sensorId, variable),
      queryFn: () => live.readings(c, sensorId, variable),
      refetchInterval: LIVE_POLL_MS,
    }),
};
