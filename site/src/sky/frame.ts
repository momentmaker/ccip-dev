export type CometKind = 'token' | 'data' | 'gold';

export interface FrameStar {
  x: number;
  y: number;
  radius: number;
  brightness: number;
  flash: number;
}

export interface FrameLane {
  from: number;
  to: number;
  opacity: number;
}

export interface FrameComet {
  from: number;
  to: number;
  progress: number;
  size: number;
  kind: CometKind;
}

export interface FrameRing {
  star: number;
  progress: number;
}

export interface SkyFrame {
  stars: FrameStar[];
  lanes: FrameLane[];
  comets: FrameComet[];
  rings: FrameRing[];
}

export const COLORS = {
  blue: [74 / 255, 127 / 255, 240 / 255],
  pale: [201 / 255, 214 / 255, 245 / 255],
  gold: [245 / 255, 196 / 255, 81 / 255],
  star: [232 / 255, 234 / 255, 237 / 255],
} as const;
