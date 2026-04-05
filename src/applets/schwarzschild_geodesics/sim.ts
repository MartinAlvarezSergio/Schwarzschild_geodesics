import { Vec2 } from "../../core/vector";
import { energySquaredMassive, rhsMassiveGR, rhsNewtonian, rk4Step } from "./gr_physics";
import { GeodesicState, SCHW_M, SchwarzschildSnapshot, TRAJECTORY_SLOT_COUNT } from "./types";

const ORBIT_W = 900;
const ORBIT_H = 620;
const POT_W = 300;
const POT_H = 220;
/** Default orbit view scale (pixels per geometric unit M). Higher = more zoomed in. */
export const ORBIT_PIXELS_PER_M_DEFAULT = 38;
/** Lower px/M = zoom out (see much larger radii on the canvas). */
export const ORBIT_PIXELS_PER_M_MIN = 3;
export const ORBIT_PIXELS_PER_M_MAX = 160;
const HORIZON_EPS = 0.012;
/** Base RK sub-step size target (geometric τ per sub-step). */
const STEP_TARGET = 0.022;
/** Launch / polar placement: stay in the exterior chart (Schwarzschild r > 2M). */
const MIN_R_OUT = SCHW_M * 2 + HORIZON_EPS;
/** Newtonian: no horizon — only avoid the 1/r² singularity at the origin. */
const NEWTON_R_MIN = 0.06 * SCHW_M;
/** GR after RK: avoid r = 0 in φ̇; horizon crossing handled separately. */
const GR_R_MIN_POST = 1e-4;

/** Reset / startup: slot 0 (red) outermost, each next slot inward (M = 1 units). */
const DEFAULT_ORBIT_R_BY_SLOT: [number, number, number, number, number] = [9.5, 8.1, 6.7, 5.3, 4.2];
/** Same φ for all defaults so they line up on one radial ray (clear separation in r only). */
const DEFAULT_START_PHI = 0;

export const DEFAULT_SLIDER_L = 2.5;

export type SchwarzschildPresetId =
  | "precessing"
  | "nearIsco"
  | "unstable"
  | "radialInfall";

function getPresetConfig(id: SchwarzschildPresetId): {
  L: number;
  radii: [number, number, number, number, number];
  phi: number;
  vr: number;
  orbitPixelsPerM?: number;
} {
  const sqrt12 = Math.sqrt(12);
  switch (id) {
    case "precessing":
      return { L: 4.3, radii: [9.5, 8.1, 6.7, 5.3, 4.2], phi: 0, vr: 0 };
    case "nearIsco":
      return { L: sqrt12, radii: [6.75, 6.5, 6.25, 6.0, 5.9], phi: 0, vr: 0 };
    case "unstable":
      return { L: 3.28, radii: [6.05, 6.0, 5.98, 6.02, 5.97], phi: 0, vr: 0 };
    case "radialInfall":
      return { L: 0.42, radii: [14, 12, 10, 8, 6.5], phi: 0, vr: -0.12, orbitPixelsPerM: 22 };
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export type SchwarzschildSimOptions = {
  /** Initial orbit canvas scale; use `setOrbitPixelsPerM` to change live. */
  pixelsPerM?: number;
};

type Slot = {
  active: boolean;
  /** True after GR crosses r < 2M: hold GR marker on horizon; Newtonian still steps. */
  grFrozenAtHorizon: boolean;
  gr: GeodesicState;
  newton: GeodesicState | null;
  grTrail: Vec2[];
  newtonTrail: Vec2[];
};

export type SchwarzschildSim = {
  step: (dt: number) => void;
  getSnapshot: () => SchwarzschildSnapshot;
  reset: () => void;
  setShowNewtonian: (show: boolean) => void;
  setAngularMomentum: (L: number) => void;
  applyAngularMomentumToState: () => void;
  setTimeScale: (scale: number) => void;
  /** Orbit view only: pixels per M (higher = zoom in). */
  setOrbitPixelsPerM: (pxPerM: number) => void;
  launchFromDrag: (anchorPx: Vec2, releasePx: Vec2, canvasLogical: { width: number; height: number }) => void;
  armDefaultOrbit: () => void;
  applyPreset: (id: SchwarzschildPresetId) => { L: number; orbitPixelsPerM?: number };
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function polarFromPixel(p: Vec2, center: Vec2, pixelsPerM: number): { r: number; phi: number } {
  const dx = (p.x - center.x) / pixelsPerM;
  const dy = (p.y - center.y) / pixelsPerM;
  const r = Math.hypot(dx, dy);
  const phi = Math.atan2(dy, dx);
  return { r: Math.max(r, MIN_R_OUT), phi };
}

function geomVelFromPixelDrag(
  anchor: Vec2,
  release: Vec2,
  center: Vec2,
  pixelsPerM: number,
  velScale: number
): { vr: number; vphi: number; r: number; phi: number } {
  const { r, phi } = polarFromPixel(anchor, center, pixelsPerM);
  const vx = ((release.x - anchor.x) / pixelsPerM) * velScale;
  const vy = ((release.y - anchor.y) / pixelsPerM) * velScale;
  const dx = (anchor.x - center.x) / pixelsPerM;
  const dy = (anchor.y - center.y) / pixelsPerM;
  const cos = dx / r;
  const sin = dy / r;
  const vr = vx * cos + vy * sin;
  const vphi = (-vx * sin + vy * cos) / r;
  return { r, phi, vr, vphi };
}

function copyState(s: GeodesicState): GeodesicState {
  return { r: s.r, phi: s.phi, vr: s.vr, L: s.L, E2: s.E2 };
}

function newtonianTwin(gr: GeodesicState): GeodesicState {
  return {
    r: gr.r,
    phi: gr.phi,
    vr: gr.vr,
    L: gr.L,
    E2: gr.vr * gr.vr + 2 * (-SCHW_M / gr.r + (gr.L * gr.L) / (2 * gr.r * gr.r))
  };
}

export function createSchwarzschildSim(options?: SchwarzschildSimOptions): SchwarzschildSim {
  let pixelsPerM = clamp(
    options?.pixelsPerM ?? ORBIT_PIXELS_PER_M_DEFAULT,
    ORBIT_PIXELS_PER_M_MIN,
    ORBIT_PIXELS_PER_M_MAX
  );
  const center: Vec2 = { x: ORBIT_W / 2, y: ORBIT_H / 2 };

  let showNewtonian = true;
  let timeScale = 1;
  let sliderL = DEFAULT_SLIDER_L;
  let nextLaunchSlot = 0;

  function defaultMassiveState(r: number, phi: number, L: number): GeodesicState {
    return { r, phi, vr: 0, L, E2: energySquaredMassive(r, 0, L) };
  }

  function massiveState(r: number, phi: number, vr: number, L: number): GeodesicState {
    return { r, phi, vr, L, E2: energySquaredMassive(r, vr, L) };
  }

  function initialMassiveSlots(): Slot[] {
    const L = sliderL;
    const n = TRAJECTORY_SLOT_COUNT;
    const slots: Slot[] = [];
    for (let i = 0; i < n; i += 1) {
      const r = DEFAULT_ORBIT_R_BY_SLOT[i];
      const gr = defaultMassiveState(r, DEFAULT_START_PHI, L);
      slots.push({
        active: true,
        grFrozenAtHorizon: false,
        gr,
        newton: showNewtonian ? newtonianTwin(gr) : null,
        grTrail: [],
        newtonTrail: []
      });
    }
    return slots;
  }

  let slots: Slot[] = initialMassiveSlots();

  function appendTrail(trail: Vec2[], p: Vec2): void {
    trail.push(p);
  }

  function toPixel(s: GeodesicState): Vec2 {
    const x = center.x + s.r * pixelsPerM * Math.cos(s.phi);
    const y = center.y + s.r * pixelsPerM * Math.sin(s.phi);
    return { x, y };
  }

  /** True once r < 2M: GR worldlines are taken to have crossed the horizon. */
  function crossedHorizon(r: number): boolean {
    return r < 2 * SCHW_M;
  }

  function stepGrLike(s: GeodesicState, dt: number): GeodesicState {
    const y = { r: s.r, phi: s.phi, vr: s.vr };
    const next = rk4Step(y, s.L, dt, rhsMassiveGR);
    next.r = Math.max(next.r, GR_R_MIN_POST);
    return { ...s, r: next.r, phi: next.phi, vr: next.vr };
  }

  function stepNewtonianOnly(s: GeodesicState, dt: number): GeodesicState {
    const y = { r: s.r, phi: s.phi, vr: s.vr };
    const next = rk4Step(y, s.L, dt, rhsNewtonian);
    next.r = Math.max(next.r, NEWTON_R_MIN);
    return { ...s, r: next.r, phi: next.phi, vr: next.vr };
  }

  function syncNewtonForSlot(slot: Slot): void {
    if (!showNewtonian || !slot.active) {
      slot.newton = null;
      return;
    }
    if (slot.grFrozenAtHorizon && slot.newton) {
      return;
    }
    slot.newton = newtonianTwin(slot.gr);
  }

  return {
    setShowNewtonian(show: boolean): void {
      showNewtonian = show;
      for (const slot of slots) {
        syncNewtonForSlot(slot);
      }
    },
    setAngularMomentum(L: number): void {
      sliderL = clamp(L, 0.2, 20);
    },
    applyAngularMomentumToState(): void {
      const L = sliderL;
      for (const slot of slots) {
        if (!slot.active || slot.grFrozenAtHorizon) {
          continue;
        }
        slot.gr = { ...slot.gr, L, E2: energySquaredMassive(slot.gr.r, slot.gr.vr, L) };
        syncNewtonForSlot(slot);
      }
    },
    setTimeScale(scale: number): void {
      timeScale = clamp(scale, 0.1, 48);
    },
    setOrbitPixelsPerM(pxPerM: number): void {
      const next = clamp(pxPerM, ORBIT_PIXELS_PER_M_MIN, ORBIT_PIXELS_PER_M_MAX);
      if (next === pixelsPerM) {
        return;
      }
      const ratio = next / pixelsPerM;
      for (const slot of slots) {
        for (const p of slot.grTrail) {
          p.x = center.x + (p.x - center.x) * ratio;
          p.y = center.y + (p.y - center.y) * ratio;
        }
        for (const p of slot.newtonTrail) {
          p.x = center.x + (p.x - center.x) * ratio;
          p.y = center.y + (p.y - center.y) * ratio;
        }
      }
      pixelsPerM = next;
    },
    armDefaultOrbit(): void {
      slots = initialMassiveSlots();
    },
    launchFromDrag(anchorPx: Vec2, releasePx: Vec2, canvasLogical: { width: number; height: number }): void {
      void canvasLogical;
      const dragLen = Math.hypot(releasePx.x - anchorPx.x, releasePx.y - anchorPx.y);
      const { r, phi, vr: vrDrag } =
        dragLen < 6
          ? { ...polarFromPixel(anchorPx, center, pixelsPerM), vr: 0 }
          : geomVelFromPixelDrag(anchorPx, releasePx, center, pixelsPerM, 0.85 * timeScale);
      const L = sliderL;
      const idx = nextLaunchSlot;
      nextLaunchSlot = (nextLaunchSlot + 1) % TRAJECTORY_SLOT_COUNT;
      const slot = slots[idx];
      slot.grTrail = [];
      slot.newtonTrail = [];
      slot.active = true;
      slot.grFrozenAtHorizon = false;
      const E2 = energySquaredMassive(r, vrDrag, L);
      slot.gr = { r, phi, vr: vrDrag, L, E2 };
      slot.newton = showNewtonian ? newtonianTwin(slot.gr) : null;
    },
    reset(): void {
      nextLaunchSlot = 0;
      slots = initialMassiveSlots();
    },
    applyPreset(id: SchwarzschildPresetId): { L: number; orbitPixelsPerM?: number } {
      const cfg = getPresetConfig(id);
      if (cfg.orbitPixelsPerM != null) {
        const next = clamp(cfg.orbitPixelsPerM, ORBIT_PIXELS_PER_M_MIN, ORBIT_PIXELS_PER_M_MAX);
        if (next !== pixelsPerM) {
          const ratio = next / pixelsPerM;
          for (const slot of slots) {
            for (const p of slot.grTrail) {
              p.x = center.x + (p.x - center.x) * ratio;
              p.y = center.y + (p.y - center.y) * ratio;
            }
            for (const p of slot.newtonTrail) {
              p.x = center.x + (p.x - center.x) * ratio;
              p.y = center.y + (p.y - center.y) * ratio;
            }
          }
          pixelsPerM = next;
        }
      }
      sliderL = clamp(cfg.L, 0.2, 20);
      nextLaunchSlot = 0;
      const L = sliderL;
      const newSlots: Slot[] = [];
      for (let i = 0; i < TRAJECTORY_SLOT_COUNT; i += 1) {
        const r = Math.max(cfg.radii[i], MIN_R_OUT);
        const gr = massiveState(r, cfg.phi, cfg.vr, L);
        newSlots.push({
          active: true,
          grFrozenAtHorizon: false,
          gr,
          newton: showNewtonian ? newtonianTwin(gr) : null,
          grTrail: [],
          newtonTrail: []
        });
      }
      slots = newSlots;
      return { L: sliderL, orbitPixelsPerM: cfg.orbitPixelsPerM };
    },
    step(dt: number): void {
      const raw = dt * timeScale;
      const maxStepGeom = Math.min(0.55, 0.07 + 0.014 * timeScale);
      const totalH = clamp(raw, 1 / 800, maxStepGeom);
      const subSteps = Math.max(6, Math.min(36, Math.ceil(totalH / STEP_TARGET)));
      const h = totalH / subSteps;
      for (let k = 0; k < subSteps; k += 1) {
        for (const slot of slots) {
          if (!slot.active) {
            continue;
          }
          if (!slot.grFrozenAtHorizon) {
            slot.gr = stepGrLike(slot.gr, h);
            if (crossedHorizon(slot.gr.r)) {
              slot.grFrozenAtHorizon = true;
              slot.gr = { ...slot.gr, r: 2 * SCHW_M, vr: 0 };
            }
          }
          if (showNewtonian && slot.newton) {
            slot.newton = stepNewtonianOnly(slot.newton, h);
          }
        }
      }
      for (const slot of slots) {
        if (!slot.active) {
          continue;
        }
        if (!slot.grFrozenAtHorizon) {
          appendTrail(slot.grTrail, toPixel(slot.gr));
        }
        if (slot.newton) {
          appendTrail(slot.newtonTrail, toPixel(slot.newton));
        }
      }
    },
    getSnapshot(): SchwarzschildSnapshot {
      const particles = slots.map((slot, slotIndex) => ({
        slotIndex,
        active: slot.active,
        grFrozenAtHorizon: slot.grFrozenAtHorizon,
        gr: copyState(slot.gr),
        newton: slot.newton ? copyState(slot.newton) : null,
        grTrail: [...slot.grTrail],
        newtonTrail: [...slot.newtonTrail]
      }));
      const energyLines = slots
        .map((slot, slotIndex) => ({ slot, slotIndex }))
        .filter(({ slot }) => slot.active)
        .map(({ slot, slotIndex }) => ({ slotIndex, e2: slot.gr.E2 }));
      return {
        orbitWidth: ORBIT_W,
        orbitHeight: ORBIT_H,
        potentialWidth: POT_W,
        potentialHeight: POT_H,
        pixelsPerM,
        center,
        showNewtonian,
        particles,
        vCurveL: sliderL,
        energyLines
      };
    }
  };
}
