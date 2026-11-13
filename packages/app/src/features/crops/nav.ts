/** Where the user is in Greenhouse → Zone → Batch → Plant. */
export type CropPath =
  | { level: 'list' }
  | { level: 'gh'; gh: string }
  | { level: 'zone'; gh: string; zone: string }
  | { level: 'batch'; gh: string; zone: string; batch: string }
  | { level: 'plant'; gh: string; zone: string; batch: string; plant: string };

export type Go = (p: CropPath) => void;
