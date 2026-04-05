import { Vec2 } from "../../core/vector";

/** Geometric units G = c = M = 1; horizon at r = 2. */
export const SCHW_M = 1;

export const TRAJECTORY_SLOT_COUNT = 5;

export type GeodesicState = {
  r: number;
  phi: number;
  /** dr/dτ for massive test particle. */
  vr: number;
  /** Conserved angular momentum per unit mass. */
  L: number;
  /** Conserved E² from first integral at initialization. */
  E2: number;
};

/** One massive test-particle trajectory (GR + optional Newtonian twin). */
export type TrajectorySnapshot = {
  slotIndex: number;
  active: boolean;
  /** GR particle stopped at r = 2M; Newtonian (if any) keeps evolving. */
  grFrozenAtHorizon: boolean;
  gr: GeodesicState;
  newton: GeodesicState | null;
  grTrail: Vec2[];
  newtonTrail: Vec2[];
};

export type EnergyLineSnapshot = {
  slotIndex: number;
  e2: number;
};

export type SchwarzschildSnapshot = {
  orbitWidth: number;
  orbitHeight: number;
  potentialWidth: number;
  potentialHeight: number;
  /** Pixels per geometric unit (M). */
  pixelsPerM: number;
  center: Vec2;
  showNewtonian: boolean;
  particles: TrajectorySnapshot[];
  /** L used to draw V_eff(r) in the side panel (slider value). */
  vCurveL: number;
  /** Horizontal E² lines for each active trajectory. */
  energyLines: EnergyLineSnapshot[];
};
