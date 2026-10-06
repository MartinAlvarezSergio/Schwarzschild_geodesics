import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logicalPointer, setLogicalTransform } from "../../core/canvasScale";
import { AppletHostAdapter } from "../../core/host";
import { Vec2 } from "../../core/vector";
import { AppletStage } from "../../ui/stage/AppletStage";
import { useCanvasBackingStore } from "../../ui/stage/hooks";
import {
  StageIconButton,
  StagePillButton,
  StagePills,
  StageReadout,
  StageSlider,
  StageToggle
} from "../../ui/stage/StageControls";
import { renderEffectivePotential, renderSchwarzschildOrbit, SLOT_GR_FILL } from "./render";
import {
  createSchwarzschildSim,
  DEFAULT_SLIDER_L,
  ORBIT_H,
  ORBIT_PIXELS_PER_M_DEFAULT,
  ORBIT_PIXELS_PER_M_MAX,
  ORBIT_PIXELS_PER_M_MIN,
  ORBIT_W,
  POT_H,
  POT_W,
  type SchwarzschildPresetId
} from "./sim";
import type { SchwarzschildSnapshot } from "./types";
import "./schwarzschildStage.css";

type Props = {
  host?: AppletHostAdapter;
};

const L_MIN = 0.35;
const L_MAX = 8.5;
const TIME_MIN = 0.2;
const TIME_MAX = 48;
/** Text readouts refresh a few times per second; the canvases redraw every frame. */
const READOUT_INTERVAL_MS = 100;

const SLOT_LABEL = ["R", "G", "B", "Y", "P"] as const;

const TIP = {
  L: "Sets tangential motion.\nLow L: plunge\nIntermediate L: bound orbit\nHigh L: escape\nCircular orbits exist only above r = 3M",
  L_GUIDED:
    "Sets tangential motion.\nLow L: plunge\nIntermediate L: bound orbit\nHigh L: escape\nCircular orbits exist only above r = 3M\n\nGuided: watch the hint under the particle readouts for where the orbit sits in the potential.",
  newton:
    "Shows a Newtonian particle with identical initial conditions (darker color).\nUse to isolate GR effects.",
  speed:
    "Controls how fast the simulation runs.\nThe equations are unchanged, but larger effective timesteps increase numerical error.\nUse lower speeds for more faithful GR vs Newtonian comparisons.",
  zoom: "Changes visual scale only.\nPhysics is unchanged.",
  trails: "Displays past trajectory.",
  play: "Start advancing coordinate time.\nPause freezes the simulation; Resume continues from the same state.",
  reset: "Restore the default five radii on one ray with the current L.\nClears trails.\nDrag launches cycle through the five colour slots.",
  potential:
    "V_eff and E²: effective potential V_eff(r) for the slider value of L.\nHorizontal lines are E² for each active colour.\nCompare allowed motion to the plotted curve.",
  guided: "When on, a short contextual line appears under the particle readouts.\nTooltips for L gain one extra guided line.",
  particle: "r: radius (M)\nL: angular momentum per unit mass\nE²: conserved energy squared (dashed line of this colour in the V_eff plot)",
  frozen:
    "Frozen at 2M: this GR particle reached r = 2M and stays there in this coordinate view.\nIts Newtonian twin continues inward.",
  presetPrecessing: "L ≈ 4.3, five radii ~4–10 M, zero radial velocity.\nClassic precession vs Newtonian closure.",
  presetIsco: "L = √12, radii clustered near 6 M.\nProbes the innermost stable circular orbit.",
  presetUnstable: "L slightly below ISCO value at r ~ 6 M.\nTiny changes in L show plunge vs escape.",
  presetRadial: "Small L, inward radial velocity, wide zoom.\nGR markers freeze at 2 M; Newtonian continues."
} as const;

const PRESETS: { id: SchwarzschildPresetId; label: string; tip: string }[] = [
  { id: "precessing", label: "Precessing orbit", tip: TIP.presetPrecessing },
  { id: "nearIsco", label: "Near ISCO", tip: TIP.presetIsco },
  { id: "unstable", label: "Unstable orbit", tip: TIP.presetUnstable },
  { id: "radialInfall", label: "Radial infall", tip: TIP.presetRadial }
];

type ParticleRow = { slotIndex: number; label: string; value: string; frozen: boolean };
type Readout = { rows: ParticleRow[]; hint: string };

function particleRows(snap: SchwarzschildSnapshot): ParticleRow[] {
  return snap.particles
    .filter((p) => p.active)
    .map((p) => ({
      slotIndex: p.slotIndex,
      label: `P${p.slotIndex + 1} (${SLOT_LABEL[p.slotIndex] ?? "?"})`,
      value: `r=${p.gr.r.toFixed(2)} L=${p.gr.L.toFixed(2)} E²=${p.gr.E2.toFixed(3)}`,
      frozen: p.grFrozenAtHorizon
    }));
}

/** One contextual line for guided mode, from the radii of the GR particles still moving. */
function guidedHint(snap: SchwarzschildSnapshot): string {
  const rs = snap.particles.filter((p) => p.active && !p.grFrozenAtHorizon).map((p) => p.gr.r);
  if (rs.length === 0) {
    return "";
  }
  const rMin = Math.min(...rs);
  const rMax = Math.max(...rs);
  if (rMin < 2.35) {
    return "Guided: trajectory is in the near-horizon region.";
  }
  if (rMax > 5.5 && rMin < 6.8) {
    return "Guided: motion samples radii near the ISCO ~6M.";
  }
  if (rMin < 4.2 && rMax < 6.5) {
    return "Guided: inner orbit; compare to V_eff and 3 M ring.";
  }
  if (rMax > 10) {
    return "Guided: mostly wide-field orbit; watch precession vs Newtonian.";
  }
  return "";
}

function readoutKey(r: Readout): string {
  return `${r.rows.map((row) => `${row.label}${row.value}${row.frozen ? "f" : ""}`).join("|")}#${r.hint}`;
}

export function SchwarzschildGeodesicsCanvas({ host }: Props): JSX.Element {
  const orbitRef = useRef<HTMLCanvasElement | null>(null);
  const potRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<Vec2 | null>(null);

  const sim = useMemo(() => createSchwarzschildSim(), []);

  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showNewtonian, setShowNewtonian] = useState(true);
  const [showTrails, setShowTrails] = useState(true);
  const [guidedMode, setGuidedMode] = useState(false);
  const [Lslider, setLslider] = useState(DEFAULT_SLIDER_L);
  const [timeScale, setTimeScale] = useState(1);
  const [orbitZoomPxPerM, setOrbitZoomPxPerM] = useState(ORBIT_PIXELS_PER_M_DEFAULT);
  const [readout, setReadout] = useState<Readout>({ rows: [], hint: "" });

  const reducedMotion = host?.readReducedMotion?.() ?? false;
  const canEdit = !running || paused;
  const moving = running && !paused;
  const trailsOn = showTrails && !reducedMotion;

  useCanvasBackingStore([potRef]);

  useEffect(() => {
    sim.setShowNewtonian(showNewtonian);
  }, [showNewtonian, sim]);

  useEffect(() => {
    sim.setAngularMomentum(Lslider);
    if (canEdit) {
      sim.applyAngularMomentumToState();
    }
  }, [Lslider, sim, canEdit]);

  useEffect(() => {
    sim.setTimeScale(timeScale);
  }, [timeScale, sim]);

  useEffect(() => {
    sim.setOrbitPixelsPerM(orbitZoomPxPerM);
  }, [orbitZoomPxPerM, sim]);

  useEffect(() => {
    if (reducedMotion) {
      setShowTrails(false);
    }
  }, [reducedMotion]);

  const applyPreset = useCallback(
    (id: SchwarzschildPresetId) => {
      const out = sim.applyPreset(id);
      setLslider(out.L);
      if (out.orbitPixelsPerM != null) {
        setOrbitZoomPxPerM(out.orbitPixelsPerM);
      }
    },
    [sim]
  );

  // Drag on the orbit view: press point = start position, drag = radial velocity (logical units).
  useEffect(() => {
    const canvas = orbitRef.current;
    if (!canvas) {
      return;
    }
    const toLogical = (e: PointerEvent, c: HTMLCanvasElement): Vec2 => logicalPointer(e, c, ORBIT_W, ORBIT_H);

    function onDown(e: PointerEvent): void {
      const c = orbitRef.current;
      if (!c) {
        return;
      }
      dragRef.current = toLogical(e, c);
      c.setPointerCapture(e.pointerId);
    }

    function onUp(e: PointerEvent): void {
      const c = orbitRef.current;
      if (!c || !dragRef.current) {
        return;
      }
      const end = toLogical(e, c);
      sim.launchFromDrag(dragRef.current, end, { width: ORBIT_W, height: ORBIT_H });
      dragRef.current = null;
      try {
        c.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be released */
      }
    }

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [sim]);

  useEffect(() => {
    const octx = orbitRef.current?.getContext("2d");
    const pctx = potRef.current?.getContext("2d");
    if (!octx || !pctx) {
      return;
    }

    let last = performance.now();
    let lastReadout = -Infinity;
    let lastKey = "";
    let raf = 0;
    const tick = (time: number): void => {
      const dt = (time - last) / 1000;
      last = time;
      if (running && !paused) {
        sim.step(dt);
      }
      const snap = sim.getSnapshot();

      setLogicalTransform(octx, ORBIT_W);
      renderSchwarzschildOrbit(octx, snap, { showTrails: trailsOn });
      setLogicalTransform(pctx, POT_W);
      renderEffectivePotential(pctx, snap);

      if (time - lastReadout > READOUT_INTERVAL_MS) {
        lastReadout = time;
        const next: Readout = { rows: particleRows(snap), hint: guidedHint(snap) };
        const key = readoutKey(next);
        if (key !== lastKey) {
          lastKey = key;
          setReadout(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, running, sim, trailsOn]);

  function onPlayPause(): void {
    if (!running) {
      setRunning(true);
      setPaused(false);
    } else {
      setPaused((p) => !p);
    }
  }

  function onReset(): void {
    sim.reset();
    host?.onResult?.({ event: "reset", showNewtonian });
  }

  const playLabel = moving ? "Pause" : running ? "Resume" : "Start";

  const toolbar = (
    <>
      <StageIconButton icon={moving ? "pause" : "play"} label={playLabel} tip={TIP.play} onClick={onPlayPause} />
      <StageIconButton icon="reset" label="Reset" tip={TIP.reset} onClick={onReset} />
    </>
  );

  const controls = (
    <>
      <StageSlider
        label="Angular momentum L"
        display={Lslider.toFixed(3)}
        value={Lslider}
        min={L_MIN}
        max={L_MAX}
        step={0.01}
        tip={guidedMode ? TIP.L_GUIDED : TIP.L}
        onChange={setLslider}
      />
      <StageSlider
        label="Integration speed"
        display={`${timeScale >= 10 ? timeScale.toFixed(1) : timeScale.toFixed(2)}×`}
        value={timeScale}
        min={TIME_MIN}
        max={TIME_MAX}
        step={0.05}
        tip={TIP.speed}
        onChange={setTimeScale}
      />
      <StageSlider
        label="Orbit view"
        display={`${orbitZoomPxPerM} px / M`}
        value={orbitZoomPxPerM}
        min={ORBIT_PIXELS_PER_M_MIN}
        max={ORBIT_PIXELS_PER_M_MAX}
        step={1}
        tip={TIP.zoom}
        onChange={setOrbitZoomPxPerM}
      />
      <StagePills>
        <StageToggle label="Overlay Newtonian" on={showNewtonian} tip={TIP.newton} onChange={setShowNewtonian} />
        <StageToggle
          label="Show trails"
          on={showTrails}
          disabled={reducedMotion}
          tip={TIP.trails}
          onChange={setShowTrails}
        />
        <StageToggle label="Guided mode" on={guidedMode} tip={TIP.guided} onChange={setGuidedMode} />
      </StagePills>
      <div className="stage-pills stage-presets">
        {PRESETS.map((p) => (
          <StagePillButton key={p.id} label={p.label} tip={p.tip} onClick={() => applyPreset(p.id)} />
        ))}
      </div>
    </>
  );

  const readouts = (
    <>
      {readout.rows.length === 0 ? <StageReadout label="No particles" value="reset or preset" muted /> : null}
      {readout.rows.map((row) => (
        <StageReadout
          key={row.slotIndex}
          label={
            <span style={{ color: SLOT_GR_FILL[row.slotIndex] }}>
              {row.label}
              {row.frozen ? <span className="schw-frozen"> · frozen 2M</span> : null}
            </span>
          }
          value={row.value}
          tip={row.frozen ? `${TIP.particle}\n\n${TIP.frozen}` : TIP.particle}
        />
      ))}
      {guidedMode ? (
        <div className="schw-guided-hint" aria-live="polite">
          {readout.hint}
        </div>
      ) : null}
    </>
  );

  const inset = (
    <div title={TIP.potential} data-hover-help={TIP.potential}>
      <canvas
        ref={potRef}
        role="img"
        aria-label="V_eff and E²"
        style={{ width: POT_W, aspectRatio: `${POT_W} / ${POT_H}` }}
      />
    </div>
  );

  const info = (
    <>
      <h4>Using it</h4>
      <ul>
        <li>
          Drag on the orbit view to launch a particle: the press point sets where it starts, the drag sets its radial
          velocity, and L sets the tangential motion. A plain click gives no radial velocity.
        </li>
        <li>Launches cycle through the five colour slots. Colours = probing different starting positions.</li>
        <li>
          Overlay Newtonian adds a darker twin of each colour: a Newtonian particle with identical initial conditions,
          to isolate GR effects.
        </li>
        <li>Higher integration speeds increase numerical error. Lower speeds are better for comparing GR and Newtonian orbits.</li>
      </ul>
      <h4>Key radii</h4>
      <ul>
        <li>Horizon: r = 2M</li>
        <li>Photon sphere: r = 3M</li>
        <li>ISCO: r = 6M</li>
      </ul>
      <h4>Behavior</h4>
      <ul>
        <li>GR orbits precess; Newtonian orbits close.</li>
        <li>Low L: plunge; intermediate L: bound orbit; high L: escape.</li>
        <li>Circular orbits exist only above r = 3M; no stable circular orbits below 6M.</li>
      </ul>
      <h4>V_eff and E²</h4>
      <ul>
        <li>
          The curve is the effective potential V_eff(r) for the slider value of L; dashed lines are E² for each active
          colour. Compare allowed motion to the plotted curve.
        </li>
      </ul>
      <h4>Model</h4>
      <ul>
        <li>Units: G = c = M = 1.</li>
        <li>
          Mode: massive test particle. Timelike geodesics in the equatorial plane of Schwarzschild spacetime; null
          geodesics are not included in this applet.
        </li>
        <li>
          GR particles freeze at r = 2M in this coordinate view (marked by a dashed circle); Newtonian particles continue
          inward.
        </li>
      </ul>
    </>
  );

  return (
    <AppletStage
      logicalWidth={ORBIT_W}
      logicalHeight={ORBIT_H}
      canvasRef={orbitRef}
      canvasLabel="Orbits of test particles around a Schwarzschild black hole; drag to launch a particle"
      canvasProps={{ style: { touchAction: "none", cursor: "crosshair" } }}
      toolbar={toolbar}
      controls={controls}
      readouts={readouts}
      inset={inset}
      info={info}
      play={{ visible: !running || paused, label: playLabel, onClick: onPlayPause }}
      rootClassName="schw-stage"
    />
  );
}
