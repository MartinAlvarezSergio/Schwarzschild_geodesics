import { SCHW_M } from "./types";

const M = SCHW_M;

/** Sample V_eff on [rMin, rMax] for plotting (massive timelike). */
export function samplePotential(rMin: number, rMax: number, n: number, L: number): { r: number; v: number }[] {
  const out: { r: number; v: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const r = rMin + t * (rMax - rMin);
    out.push({ r, v: vEffMassive(r, L) });
  }
  return out;
}

/** Timelike: V_eff(r) with (dr/dτ)² = E² − V_eff. */
export function vEffMassive(r: number, L: number): number {
  const f = 1 - (2 * M) / r;
  return f * (1 + (L * L) / (r * r));
}

export function dVEffMassiveDr(r: number, L: number): number {
  const L2 = L * L;
  return (2 * M) / (r * r) - (2 * L2) / (r * r * r) + (6 * M * L2) / (r * r * r * r);
}

/** Newtonian effective: (dr/dt)² = 2(E_N − V_N) if we use nonrelativistic energy — we integrate 1st-order pair instead. */

export function newtonianAccelR(r: number, L: number): number {
  return -M / (r * r) + (L * L) / (r * r * r);
}

/** Circular massive orbit angular momentum at radius r (stable branch r > 3M). */
export function circularLMassive(r: number): number {
  const rr = Math.max(r, M * 3.0001);
  return Math.sqrt((M * rr * rr) / (rr - 3 * M));
}

export function energySquaredMassive(r: number, vr: number, L: number): number {
  return vr * vr + vEffMassive(r, L);
}

/** Soft floor for r in RHS only (avoid division by zero); do not force r ≥ 2M — that pinned orbits to the horizon. */
const R_SOFT = 0.08 * M;

/** Derivatives for RK4: y = (r, phi, vr). */
export function rhsMassiveGR(y: { r: number; phi: number; vr: number }, L: number): { dr: number; dphi: number; dvr: number } {
  const r = Math.max(y.r, R_SOFT);
  return {
    dr: y.vr,
    dphi: L / (r * r),
    dvr: -0.5 * dVEffMassiveDr(r, L)
  };
}

export function rhsNewtonian(y: { r: number; phi: number; vr: number }, L: number): { dr: number; dphi: number; dvr: number } {
  const r = Math.max(y.r, R_SOFT);
  return {
    dr: y.vr,
    dphi: L / (r * r),
    dvr: newtonianAccelR(r, L)
  };
}

type Y = { r: number; phi: number; vr: number };

function addY(a: Y, b: Y, s: number): Y {
  return { r: a.r + s * b.r, phi: a.phi + s * b.phi, vr: a.vr + s * b.vr };
}

export function rk4Step(
  y: Y,
  L: number,
  dt: number,
  rhs: (y: Y, L: number) => { dr: number; dphi: number; dvr: number }
): Y {
  const k1 = rhs(y, L);
  const y1: Y = { r: k1.dr, phi: k1.dphi, vr: k1.dvr };
  const k2 = rhs(addY(y, y1, 0.5 * dt), L);
  const y2: Y = { r: k2.dr, phi: k2.dphi, vr: k2.dvr };
  const k3 = rhs(addY(y, y2, 0.5 * dt), L);
  const y3: Y = { r: k3.dr, phi: k3.dphi, vr: k3.dvr };
  const k4 = rhs(addY(y, y3, dt), L);
  return {
    r: y.r + (dt / 6) * (k1.dr + 2 * k2.dr + 2 * k3.dr + k4.dr),
    phi: y.phi + (dt / 6) * (k1.dphi + 2 * k2.dphi + 2 * k3.dphi + k4.dphi),
    vr: y.vr + (dt / 6) * (k1.dvr + 2 * k2.dvr + 2 * k3.dvr + k4.dvr)
  };
}
