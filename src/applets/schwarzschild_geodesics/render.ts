import { samplePotential } from "./gr_physics";
import { SCHW_M, SchwarzschildSnapshot, TRAJECTORY_SLOT_COUNT } from "./types";

type OrbitRenderOptions = {
  showTrails: boolean;
};

/** Slots 1–3: R, G, B; 4: yellow; 5: purple. Newtonian = darker mate. */
const SLOT_GR_STROKE = [
  "rgba(255, 110, 110, 0.62)",
  "rgba(90, 235, 130, 0.58)",
  "rgba(115, 175, 255, 0.62)",
  "rgba(255, 220, 70, 0.6)",
  "rgba(190, 120, 255, 0.62)"
];
const SLOT_NEWTON_STROKE = [
  "rgba(145, 40, 45, 0.58)",
  "rgba(25, 115, 55, 0.54)",
  "rgba(35, 70, 145, 0.56)",
  "rgba(130, 95, 25, 0.55)",
  "rgba(75, 35, 115, 0.56)"
];
const SLOT_GR_FILL = ["#ff6b6b", "#52e088", "#6ba3ff", "#ffe24a", "#c78bff"];
const SLOT_NEWTON_FILL = ["#9e3a3e", "#2a8f52", "#3d5c9e", "#8a6a1e", "#5c2d8a"];

function slotColor(slotIndex: number, role: "grStroke" | "newtStroke" | "grFill" | "newtFill"): string {
  const i = Math.min(Math.max(0, slotIndex), TRAJECTORY_SLOT_COUNT - 1);
  switch (role) {
    case "grStroke":
      return SLOT_GR_STROKE[i];
    case "newtStroke":
      return SLOT_NEWTON_STROKE[i];
    case "grFill":
      return SLOT_GR_FILL[i];
    case "newtFill":
      return SLOT_NEWTON_FILL[i];
    default:
      return SLOT_GR_STROKE[0];
  }
}

const E2_LINE_BY_SLOT = [
  "rgba(255, 100, 100, 0.92)",
  "rgba(70, 210, 110, 0.9)",
  "rgba(100, 155, 255, 0.92)",
  "rgba(240, 200, 50, 0.9)",
  "rgba(180, 110, 255, 0.92)"
];

export function renderSchwarzschildOrbit(
  ctx: CanvasRenderingContext2D,
  snap: SchwarzschildSnapshot,
  options: OrbitRenderOptions
): void {
  const { orbitWidth: w, orbitHeight: h, center, pixelsPerM, particles } = snap;
  ctx.clearRect(0, 0, w, h);

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#060a12");
  bg.addColorStop(1, "#0f141c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const r2 = 2 * SCHW_M * pixelsPerM;
  const r3 = 3 * SCHW_M * pixelsPerM;
  const r6 = 6 * SCHW_M * pixelsPerM;

  ctx.strokeStyle = "rgba(255, 120, 90, 0.35)";
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(center.x, center.y, r2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 200, 120, 0.4)";
  ctx.beginPath();
  ctx.arc(center.x, center.y, r3, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(140, 200, 255, 0.35)";
  ctx.setLineDash([4, 8]);
  ctx.beginPath();
  ctx.arc(center.x, center.y, r6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255, 120, 90, 0.7)";
  ctx.fillText("r = 2M", center.x + r2 + 6, center.y + 4);
  ctx.fillStyle = "rgba(255, 200, 120, 0.75)";
  ctx.fillText("3M", center.x + r3 + 4, center.y - r3 + 14);
  ctx.fillStyle = "rgba(140, 200, 255, 0.7)";
  ctx.fillText("6M (ISCO)", center.x + r6 + 4, center.y - r6 + 14);

  const holeR = r2 * 0.92;
  const hole = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, holeR);
  hole.addColorStop(0, "#0a0a0f");
  hole.addColorStop(0.55, "#151018");
  hole.addColorStop(1, "rgba(20, 16, 28, 0.4)");
  ctx.fillStyle = hole;
  ctx.beginPath();
  ctx.arc(center.x, center.y, holeR, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(center.x, center.y, holeR, 0, Math.PI * 2);
  ctx.stroke();

  for (const p of particles) {
    if (!p.active) {
      continue;
    }
    const si = p.slotIndex;
    if (options.showTrails && snap.showNewtonian && p.newtonTrail.length > 1 && p.newton) {
      ctx.strokeStyle = slotColor(si, "newtStroke");
      ctx.lineWidth = 1.45;
      ctx.beginPath();
      ctx.moveTo(p.newtonTrail[0].x, p.newtonTrail[0].y);
      for (let i = 1; i < p.newtonTrail.length; i += 1) {
        ctx.lineTo(p.newtonTrail[i].x, p.newtonTrail[i].y);
      }
      ctx.stroke();
    }
    if (options.showTrails && p.grTrail.length > 1) {
      ctx.strokeStyle = slotColor(si, "grStroke");
      ctx.lineWidth = 1.65;
      ctx.beginPath();
      ctx.moveTo(p.grTrail[0].x, p.grTrail[0].y);
      for (let i = 1; i < p.grTrail.length; i += 1) {
        ctx.lineTo(p.grTrail[i].x, p.grTrail[i].y);
      }
      ctx.stroke();
    }
  }

  for (const p of particles) {
    if (!p.active) {
      continue;
    }
    const si = p.slotIndex;
    if (snap.showNewtonian && p.newton) {
      const nx = center.x + p.newton.r * pixelsPerM * Math.cos(p.newton.phi);
      const ny = center.y + p.newton.r * pixelsPerM * Math.sin(p.newton.phi);
      ctx.fillStyle = slotColor(si, "newtFill");
      ctx.beginPath();
      ctx.arc(nx, ny, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    const gx = center.x + p.gr.r * pixelsPerM * Math.cos(p.gr.phi);
    const gy = center.y + p.gr.r * pixelsPerM * Math.sin(p.gr.phi);
    const grR = 6;
    ctx.fillStyle = slotColor(si, "grFill");
    ctx.beginPath();
    ctx.arc(gx, gy, grR, 0, Math.PI * 2);
    ctx.fill();
    if (p.grFrozenAtHorizon) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(gx, gy, grR + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

export function renderEffectivePotential(ctx: CanvasRenderingContext2D, snap: SchwarzschildSnapshot): void {
  const { potentialWidth: w, potentialHeight: h, vCurveL, energyLines } = snap;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(12, 16, 24, 0.96)";
  ctx.fillRect(0, 0, w, h);

  const padL = 44;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const rMin = 2 * SCHW_M + 0.04;
  const rMax = 14 * SCHW_M;
  const samples = samplePotential(rMin, rMax, 180, vCurveL);
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const p of samples) {
    if (Number.isFinite(p.v)) {
      vmin = Math.min(vmin, p.v);
      vmax = Math.max(vmax, p.v);
    }
  }
  for (const line of energyLines) {
    vmin = Math.min(vmin, line.e2);
    vmax = Math.max(vmax, line.e2);
  }
  const span = Math.max(vmax - vmin, 0.08);
  vmin -= span * 0.08;
  vmax += span * 0.12;

  function xToPx(r: number): number {
    return padL + ((r - rMin) / (rMax - rMin)) * plotW;
  }
  function yToPx(v: number): number {
    return padT + ((vmax - v) / (vmax - vmin)) * plotH;
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padT + (i / 4) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(120, 210, 255, 0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  let started = false;
  for (const p of samples) {
    if (!Number.isFinite(p.v)) {
      started = false;
      continue;
    }
    const x = xToPx(p.r);
    const y = yToPx(p.v);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.5;
  for (const line of energyLines) {
    const eY = yToPx(line.e2);
    const c = E2_LINE_BY_SLOT[Math.min(line.slotIndex, E2_LINE_BY_SLOT.length - 1)] ?? E2_LINE_BY_SLOT[0];
    ctx.strokeStyle = c;
    ctx.beginPath();
    ctx.moveTo(padL, eY);
    ctx.lineTo(padL + plotW, eY);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(230, 228, 220, 0.85)";
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText("V_eff(r) massive", padL, 12);
  ctx.fillText("E²", padL + plotW - 22, padT + 10);
  ctx.fillStyle = "rgba(200, 196, 188, 0.75)";
  ctx.fillText("r / M", padL + plotW * 0.42, h - 10);
  ctx.fillText(`L = ${vCurveL.toFixed(3)}`, padL + plotW - 72, 12);
}
