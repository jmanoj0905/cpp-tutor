import type { usePlayer } from "../player/usePlayer";

// Past this many steps the marks blur into a solid line, so draw none.
const STEP_MARK_LIMIT = 60;

export function Vcr({
  player,
  breakpoints,
}: {
  player: ReturnType<typeof usePlayer>;
  breakpoints?: Set<number>;
}) {
  const { index, total, first, prev, next, last, goto, hitSteps, nextHit } = player;
  const max = Math.max(0, total - 1);
  const bp = breakpoints ?? new Set<number>();
  const hits = bp.size ? hitSteps(bp) : [];
  const handleNext = () => (bp.size ? nextHit(bp) : next());

  return (
    <div className="vcr" aria-label="Execution controls">
      <div className="timeline">
        <label htmlFor="execution-step">Step timeline</label>
        <div className="track">
          <input
            id="execution-step"
            aria-label="Execution step"
            type="range"
            min="0"
            max={max}
            step="1"
            value={index}
            onChange={(event) => goto(Number(event.currentTarget.value))}
          />
          {total > 1 && total <= STEP_MARK_LIMIT && (
            <div className="step-marks" aria-hidden>
              {Array.from({ length: total }, (_, step) => (
                <span
                  key={step}
                  className="step-mark"
                  style={{ left: `${(step / max) * 100}%` }}
                />
              ))}
            </div>
          )}
          <div className="ticks" aria-hidden>
            {hits.map((step) => (
              <span
                key={step}
                className="tick"
                data-step={step}
                style={{ left: `${max ? (step / max) * 100 : 0}%` }}
              />
            ))}
          </div>
        </div>
        <span className="counter">Step {index + 1} of {total}</span>
      </div>

      <div className="vcr-buttons">
        <button onClick={first} disabled={index === 0}>&lt;&lt; First</button>
        <button onClick={prev} disabled={index === 0}>&lt; Prev</button>
        <button onClick={handleNext} disabled={index === total - 1}>Next &gt;</button>
        <button onClick={last} disabled={index === total - 1}>Last &gt;&gt;</button>
      </div>
    </div>
  );
}
