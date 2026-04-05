import { useMemo } from "react";
import { AppletHostAdapter } from "../core/host";
import { SchwarzschildGeodesicsCanvas } from "../applets/schwarzschild_geodesics/SchwarzschildGeodesicsCanvas";

export function App(): JSX.Element {
  const host: AppletHostAdapter = useMemo(
    () => ({
      onClose: () => {},
      readReducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
    }),
    []
  );

  return (
    <div className="app-shell">
      <main>
        <section className="modal card">
          <SchwarzschildGeodesicsCanvas host={host} />
        </section>
      </main>
    </div>
  );
}
