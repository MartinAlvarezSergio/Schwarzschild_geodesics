import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppletHostAdapter } from "../../core/host";
import { Vec2 } from "../../core/vector";
import { ControlCard } from "../../ui/ControlCard";
import { renderEffectivePotential, renderSchwarzschildOrbit } from "./render";
import {
  createSchwarzschildSim,
  DEFAULT_SLIDER_L,
  ORBIT_PIXELS_PER_M_DEFAULT,
  ORBIT_PIXELS_PER_M_MAX,
  ORBIT_PIXELS_PER_M_MIN,
  type SchwarzschildPresetId
} from "./sim";

type Props = {
  host?: AppletHostAdapter;
};

const L_MIN = 0.35;
const L_MAX = 8.5;
const TIME_MIN = 0.2;
const TIME_MAX = 48;

const SLOT_LABEL = ["R", "G", "B", "Y", "P"] as const;

const TIP = {
  L: "Sets tangential motion.\nLow L: plunge\nIntermediate L: bound orbit\nHigh L: escape\nCircular orbits exist only above r = 3M",
  L_GUIDED:
    "Sets tangential motion.\nLow L: plunge\nIntermediate L: bound orbit\nHigh L: escape\nCircular orbits exist only above r = 3M\n\nGuided: watch the hint below the readout for where the orbit sits in the potential.",
  newton:
    "Shows a Newtonian particle with identical initial conditions (darker color).\nUse to isolate GR effects.",
  speed:
    "Controls how fast the simulation runs.\nThe equations are unchanged, but larger effective timesteps increase numerical error.\nUse lower speeds for more faithful GR vs Newtonian comparisons.",
  zoom: "Changes visual scale only.\nPhysics is unchanged.",
  trails: "Displays past trajectory.",
  launch:
    "Drag on the orbit to set radial velocity.\nTangential motion is set by L.\n\nGR particles freeze at r = 2M in this coordinate view.\nNewtonian particles continue inward.",
  mode: "Massive timelike test particle in Schwarzschild spacetime.\nNull geodesics are not included in this applet.",
  start: "Begin advancing coordinate time.",
  pauseResume: "Pause freezes the simulation.\nResume continues from the same state.",
  reset: "Restore the default five radii on one ray with the current L.\nClears trails.\nDrag launches cycle through the five colour slots.",
  potential:
    "Effective potential V_eff(r) for the slider value of L.\nHorizontal lines are E² for each active colour.\nCompare allowed motion to the plotted curve.",
  guided: "When on, a short contextual line appears under the readout.\nTooltips for L gain one extra guided line.",
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

export function SchwarzschildGeodesicsCanvas({ host }: Props): JSX.Element {
  const orbitRef = useRef<HTMLCanvasElement | null>(null);
  const potRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<Vec2 | null>(null);
  const guidedHintRef = useRef<HTMLDivElement | null>(null);
  const guidedModeRef = useRef(false);

  const sim = useMemo(() => createSchwarzschildSim(), []);

  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showNewtonian, setShowNewtonian] = useState(true);
  const [showTrails, setShowTrails] = useState(true);
  const [guidedMode, setGuidedMode] = useState(false);
  const [Lslider, setLslider] = useState(DEFAULT_SLIDER_L);
  const [timeScale, setTimeScale] = useState(1);
  const [orbitZoomPxPerM, setOrbitZoomPxPerM] = useState(ORBIT_PIXELS_PER_M_DEFAULT);
  const [readoutLines, setReadoutLines] = useState<string[]>([]);

  const reducedMotion = host?.readReducedMotion?.() ?? false;
  const canEdit = !running || paused;
  const trailsOn = showTrails && !reducedMotion;

  useEffect(() => {
    guidedModeRef.current = guidedMode;
  }, [guidedMode]);

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

  const canvasPoint = useCallback((event: PointerEvent, canvas: HTMLCanvasElement): Vec2 => {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  }, []);

  useEffect(() => {
    const canvas = orbitRef.current;
    if (!canvas) {
      return;
    }

    function onDown(e: PointerEvent): void {
      const c = orbitRef.current;
      if (!c) {
        return;
      }
      dragRef.current = canvasPoint(e, c);
      c.setPointerCapture(e.pointerId);
    }

    function onUp(e: PointerEvent): void {
      const c = orbitRef.current;
      if (!c || !dragRef.current) {
        return;
      }
      const end = canvasPoint(e, c);
      sim.launchFromDrag(dragRef.current, end, { width: c.width, height: c.height });
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
  }, [canvasPoint, sim]);

  useEffect(() => {
    const root = orbitRef.current?.closest(".gravity-layout");
    if (!root) {
      return;
    }
    const labels = root.querySelectorAll<HTMLLabelElement>("label[title]");
    for (const label of labels) {
      const hint = label.getAttribute("title");
      if (!hint) {
        continue;
      }
      label.setAttribute("data-hover-help", hint);
      const descendants = label.querySelectorAll<HTMLElement>("input, select, button, span, strong");
      for (const element of descendants) {
        if (!element.getAttribute("title")) {
          element.setAttribute("title", hint);
        }
        element.setAttribute("data-hover-help", hint);
      }
    }
    const titled = root.querySelectorAll<HTMLElement>("[title][data-hover-help]:not(label)");
    for (const el of titled) {
      const h = el.getAttribute("title");
      if (h) {
        el.setAttribute("data-hover-help", h);
      }
    }
  });

  useEffect(() => {
    const root = orbitRef.current?.closest(".gravity-layout") as HTMLElement | null;
    if (!root) {
      return;
    }
    const tooltip = document.createElement("div");
    tooltip.className = "hover-help-tooltip";
    document.body.appendChild(tooltip);

    const placeTooltip = (x: number, y: number): void => {
      const offset = 14;
      const maxX = window.innerWidth - tooltip.offsetWidth - 8;
      const maxY = window.innerHeight - tooltip.offsetHeight - 8;
      const left = Math.min(Math.max(8, x + offset), Math.max(8, maxX));
      const top = Math.min(Math.max(8, y + offset), Math.max(8, maxY));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };

    const onMouseMove = (event: Event): void => {
      const mouseEvent = event as MouseEvent;
      const target = mouseEvent.target as HTMLElement | null;
      const hintTarget = target?.closest?.("[data-hover-help]") as HTMLElement | null;
      if (!hintTarget || !root.contains(hintTarget)) {
        tooltip.classList.remove("visible");
        return;
      }
      const hint = hintTarget.getAttribute("data-hover-help");
      if (!hint) {
        tooltip.classList.remove("visible");
        return;
      }
      tooltip.textContent = hint;
      tooltip.classList.add("visible");
      placeTooltip(mouseEvent.clientX, mouseEvent.clientY);
    };

    const onMouseLeave = (): void => {
      tooltip.classList.remove("visible");
    };

    root.addEventListener("mousemove", onMouseMove);
    root.addEventListener("mouseleave", onMouseLeave);
    return () => {
      root.removeEventListener("mousemove", onMouseMove);
      root.removeEventListener("mouseleave", onMouseLeave);
      tooltip.remove();
    };
  }, []);

  useEffect(() => {
    const ocv = orbitRef.current?.getContext("2d");
    const pcv = potRef.current?.getContext("2d");
    if (!ocv || !pcv) {
      return;
    }

    let last = performance.now();
    let raf = 0;
    const tick = (time: number): void => {
      const dt = (time - last) / 1000;
      last = time;
      if (running && !paused) {
        sim.step(dt);
      }
      const snap = sim.getSnapshot();
      const lines = snap.particles
        .filter((p) => p.active)
        .map((p) => {
          const ch = SLOT_LABEL[p.slotIndex] ?? "?";
          const fr = p.grFrozenAtHorizon ? " · frozen 2M" : "";
          return `P${p.slotIndex + 1} (${ch}): r=${p.gr.r.toFixed(2)} L=${p.gr.L.toFixed(2)} E²=${p.gr.E2.toFixed(3)}${fr}`;
        });
      setReadoutLines(lines.length > 0 ? lines : ["No particles · reset or preset"]);

      if (guidedModeRef.current && guidedHintRef.current) {
        const moving = snap.particles.filter((p) => p.active && !p.grFrozenAtHorizon);
        const rs = moving.map((p) => p.gr.r);
        const rMin = rs.length > 0 ? Math.min(...rs) : null;
        const rMax = rs.length > 0 ? Math.max(...rs) : null;
        let hint = "";
        if (rMin != null && rMax != null) {
          if (rMin < 2.35) {
            hint = "Guided: trajectory is in the near-horizon region.";
          } else if (rMax > 5.5 && rMin < 6.8) {
            hint = "Guided: motion samples radii near the ISCO ~6M.";
          } else if (rMin < 4.2 && rMax < 6.5) {
            hint = "Guided: inner orbit; compare to V_eff and 3 M ring.";
          } else if (rMax > 10) {
            hint = "Guided: mostly wide-field orbit; watch precession vs Newtonian.";
          }
        }
        guidedHintRef.current.textContent = hint;
      } else if (guidedHintRef.current) {
        guidedHintRef.current.textContent = "";
      }

      renderSchwarzschildOrbit(ocv, snap, { showTrails: trailsOn });
      renderEffectivePotential(pcv, snap);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, running, sim, trailsOn]);

  function onReset(): void {
    sim.reset();
    host?.onResult?.({ event: "reset", showNewtonian });
  }

  const subtitle = (
    <>
      <p style={{ margin: "0 0 0.35rem" }}>Units: G = c = M = 1</p>
      <ul style={{ margin: 0, paddingLeft: "1.1rem", lineHeight: 1.5 }}>
        <li>Drag to launch particles</li>
        <li>L sets angular momentum</li>
        <li>Colors = probing different starting positions</li>
        <li>Compare GR vs Newtonian</li>
      </ul>
    </>
  );

  const lTooltip = guidedMode ? TIP.L_GUIDED : TIP.L;

  return (
    <div className="gravity-layout">
      <div className="panel-stack" style={{ display: "grid", gap: "0.85rem", alignContent: "start" }}>
        <ControlCard title="Schwarzschild geodesics" subtitle={subtitle}>
          <div className="control-grid schwarzschild-panel">
            <div className="schwarzschild-section control-span-2">
              <div className="section-title">Particle</div>
              <label className="control-span-2" title={TIP.mode}>
                <span className="slider-label">
                  <span>Mode</span>
                </span>
                <select value="massive" disabled aria-label="Massive test particle only">
                  <option value="massive">Massive test particle</option>
                </select>
              </label>
              <label className="checkbox control-span-2" title={TIP.newton}>
                <input
                  type="checkbox"
                  checked={showNewtonian}
                  onChange={(e) => setShowNewtonian(e.target.checked)}
                />
                Overlay Newtonian
              </label>
            </div>

            <div className="schwarzschild-section control-span-2">
              <div className="section-title">Initial conditions</div>
              <label className="control-span-2" title={lTooltip}>
                <span className="slider-label">
                  <span>Angular momentum L</span>
                  <strong>{Lslider.toFixed(3)}</strong>
                </span>
                <input
                  type="range"
                  min={L_MIN}
                  max={L_MAX}
                  step={0.01}
                  value={Lslider}
                  onChange={(e) => setLslider(Number(e.target.value))}
                />
              </label>
            </div>

            <div className="schwarzschild-section control-span-2">
              <div className="section-title">Preset experiments</div>
              <div className="schwarzschild-preset-grid">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    title={p.tip}
                    data-hover-help={p.tip}
                    onClick={() => applyPreset(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="schwarzschild-section control-span-2">
              <div className="section-title">Display</div>
              <label className="control-span-2" title={TIP.speed}>
                <span className="slider-label">
                  <span>Integration speed</span>
                  <strong>{timeScale >= 10 ? timeScale.toFixed(1) : timeScale.toFixed(2)}×</strong>
                </span>
                <input
                  type="range"
                  min={TIME_MIN}
                  max={TIME_MAX}
                  step={0.05}
                  value={timeScale}
                  onChange={(e) => setTimeScale(Number(e.target.value))}
                />
              </label>
              <label className="control-span-2" title={TIP.zoom}>
                <span className="slider-label">
                  <span>Orbit view</span>
                  <strong>{orbitZoomPxPerM} px / M</strong>
                </span>
                <input
                  type="range"
                  min={ORBIT_PIXELS_PER_M_MIN}
                  max={ORBIT_PIXELS_PER_M_MAX}
                  step={1}
                  value={orbitZoomPxPerM}
                  onChange={(e) => setOrbitZoomPxPerM(Number(e.target.value))}
                />
              </label>
              <label className="checkbox control-span-2" title={TIP.trails}>
                <input
                  type="checkbox"
                  checked={showTrails}
                  onChange={(e) => setShowTrails(e.target.checked)}
                  disabled={reducedMotion}
                />
                Show trails
              </label>
            </div>

            <div className="schwarzschild-section control-span-2">
              <div className="section-title">Controls</div>
              <div className="button-row control-span-2">
                <button type="button" title={TIP.start} data-hover-help={TIP.start} onClick={() => setRunning(true)}>
                  Start
                </button>
                <button
                  type="button"
                  title={TIP.pauseResume}
                  data-hover-help={TIP.pauseResume}
                  onClick={() => setPaused((p) => !p)}
                  disabled={!running}
                >
                  {paused ? "Resume" : "Pause"}
                </button>
                <button type="button" title={TIP.reset} data-hover-help={TIP.reset} onClick={onReset}>
                  Reset
                </button>
              </div>
            </div>

            <details className="control-span-2 schwarzschild-section" style={{ borderTop: "none", marginTop: "0.5rem" }}>
              <summary className="section-title" style={{ cursor: "pointer", listStyle: "none" }}>
                Physics hints
              </summary>
              <div className="schwarzschild-hints-body">
                <p style={{ margin: "0.35rem 0 0.25rem" }}>
                  <strong>Key radii</strong>
                </p>
                <ul style={{ margin: 0 }}>
                  <li>Horizon: r = 2M</li>
                  <li>Photon sphere: r = 3M</li>
                  <li>ISCO: r = 6M</li>
                </ul>
                <p style={{ margin: "0.5rem 0 0.25rem" }}>
                  <strong>Behavior</strong>
                </p>
                <ul style={{ margin: 0 }}>
                  <li>GR orbits precess</li>
                  <li>Newtonian orbits close</li>
                  <li>No stable circular orbits below 6M</li>
                </ul>
              </div>
            </details>

            <label className="checkbox control-span-2 schwarzschild-section" title={TIP.guided}>
              <input type="checkbox" checked={guidedMode} onChange={(e) => setGuidedMode(e.target.checked)} />
              Guided mode
            </label>

            <div className="stats control-span-2" style={{ fontSize: "0.82rem", lineHeight: 1.45 }}>
              {readoutLines.map((line, i) => (
                <div key={`${i}-${line.slice(0, 24)}`}>{line}</div>
              ))}
              <div ref={guidedHintRef} className="schwarzschild-guided-hint" aria-live="polite" />
            </div>
          </div>
        </ControlCard>

        <div className="card" style={{ padding: "0.5rem" }}>
          <div
            className="section-title"
            style={{ marginBottom: "0.35rem" }}
            title={TIP.potential}
            data-hover-help={TIP.potential}
          >
            V_eff and E²
          </div>
          <canvas ref={potRef} width={300} height={220} style={{ width: "100%", height: "auto", display: "block" }} />
        </div>
      </div>

      <div className="canvas-shell card">
        <div title={TIP.launch} data-hover-help={TIP.launch}>
          <canvas ref={orbitRef} width={900} height={620} style={{ display: "block", width: "100%", height: "auto" }} />
        </div>
        <p className="subtle" style={{ margin: "0.45rem 0 0", fontSize: "0.78rem", lineHeight: 1.45 }}>
          Warning: higher integration speeds increase numerical error. Lower speeds are better for comparing GR and Newtonian orbits.
        </p>
      </div>
    </div>
  );
}
