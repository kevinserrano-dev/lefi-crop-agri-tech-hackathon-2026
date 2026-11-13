/**
 * Approved brand artwork (assets/brand/, from the design handoff).
 * Use these files as they are; do not redraw them inside the apps.
 */
import logoFull from '../../../assets/brand/logo-full.png';
import logoMark from '../../../assets/brand/logo-mark.png';
import logoWordmark from '../../../assets/brand/logo-wordmark.png';
import calm from '../../../assets/brand/mascot-calm.png';
import caring from '../../../assets/brand/mascot-caring.png';
import celebrating from '../../../assets/brand/mascot-celebrating.png';
import curious from '../../../assets/brand/mascot-curious.png';
import happy from '../../../assets/brand/mascot-happy.png';
import hero from '../../../assets/brand/mascot-hero.png';
import sad from '../../../assets/brand/mascot-sad.png';
import sleeping from '../../../assets/brand/mascot-sleeping.png';
import surprised from '../../../assets/brand/mascot-surprised.png';
import thinking from '../../../assets/brand/mascot-thinking.png';
import thumbsup from '../../../assets/brand/mascot-thumbsup.png';
import wink from '../../../assets/brand/mascot-wink.png';
import working from '../../../assets/brand/mascot-working.png';

export const logos = { full: logoFull, mark: logoMark, wordmark: logoWordmark } as const;

export const mascots = {
  calm,
  caring,
  celebrating,
  curious,
  happy,
  hero,
  sad,
  sleeping,
  surprised,
  thinking,
  thumbsup,
  wink,
  working,
} as const;

export type MascotState = keyof typeof mascots;
