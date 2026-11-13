/**
 * The only seam between the UI and the host it runs in (ADR-022).
 * packages/app talks to the Brain exclusively through this interface, so the shell
 * (Tauri today) can be replaced by implementing one module.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Severity = 'info' | 'warning' | 'critical';

export interface ApiRequest {
  method: HttpMethod;
  /** Path relative to `/api/v1`, e.g. `/plants`. Never a full URL. */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export interface BrainEvent<T = unknown> {
  topic: string;
  /** Brain time (ADR-008), ISO-8601. */
  at: string;
  data: T;
}

export type Unsubscribe = () => void;

export interface BrainEndpoint {
  name: string;
  url: string;
  /** How it was found: on the network, set by hand (Advanced / environment), or from pairing. */
  source: 'mdns' | 'config' | 'paired';
}

/**
 * Something on the network that answered as Lefi Brain (mDNS `_lefi-brain._tcp`, or the main PC's
 * name `lefi-main.local`). NOT trusted: anyone can announce that name. Only pairing pins a CA.
 */
export interface FoundBrain {
  url: string;
  addresses: string[];
  via: 'mdns' | 'name';
  state: 'on' | 'not_answering' | 'brain_down' | 'not_a_brain';
  version: string | null;
}

export interface DeviceIdentity {
  deviceId: string;
  /** SHA-256 of the pinned Lefi Gateway CA (compare with Lefi Crop Helper). */
  caFingerprint: string;
  /** Unix seconds. */
  pairedAt: string;
  /** The Lefi Brain this PC is paired with. */
  url: string;
  /** When this PC's certificate ends (ISO-8601). */
  expiresAt: string;
}

/** This PC's last automatic pairing attempt (ADR-055). */
export interface PairingStatus {
  status: {
    state: 'pairing' | 'paired' | 'retrying' | 'failed';
    message: string;
    url: string | null;
    /** Unix seconds. */
    at: number;
  } | null;
  /** Lefi Crop Helper left an offer that is still being tried. */
  offer_waiting: boolean;
}

/** A camera's live video (ADR-079). `done` settles when the stream ends: it rejects with
 * Lefi Brain's error (e.g. not connected, camera permission) or when Lefi Brain is unreachable. */
export interface CameraStream {
  done: Promise<{ frames: number }>;
  stop(): void;
}

export interface Platform {
  kind: 'tauri' | 'web';
  api<T>(req: ApiRequest): Promise<T>;
  subscribe(topic: string, cb: (e: BrainEvent) => void): Unsubscribe;
  notify(n: { title: string; body: string; severity: Severity }): void;
  secrets: {
    get(k: string): Promise<string | null>;
    set(k: string, v: string): Promise<void>;
    del(k: string): Promise<void>;
  };
  /** Brains this PC knows or found. Empty: none (never paired, nothing found, nothing set). */
  discoverBrain(): Promise<BrainEndpoint[]>;
  /** Looks for Lefi Brain on the network (a few seconds). Empty when nothing answers. */
  findBrains(): Promise<FoundBrain[]>;
  device(): Promise<DeviceIdentity | null>;
  /** Pairs with the Lefi Brain at `url` using a one-time code from Lefi Crop Helper (ADR-048). */
  pair(url: string, code: string): Promise<DeviceIdentity>;
  /** Forgets this PC's pairing (after a revocation, or to use another Lefi Brain). */
  forgetPairing(): Promise<void>;
  /** The last automatic pairing attempt on this PC; null outside the desktop app. */
  pairingStatus(): Promise<PairingStatus | null>;
  /** Live JPEG frames of a camera; absent where streaming is not available (then: snapshots). */
  cameraStream?(cameraId: string, onFrame: (jpeg: Uint8Array) => void): CameraStream;
  /** Live JPEG frames of a simulated robot view (ADR-091); same rules as a camera stream. */
  robotStream?(robotId: string, feed: string, onFrame: (jpeg: Uint8Array) => void): CameraStream;
}
