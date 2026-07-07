import type { usePlayer } from "../player/usePlayer";

// Past this many steps the marks blur into a solid line, so draw none.
const STEP_MARK_LIMIT = 60;

// Must match the slider thumb width in index.css. The thumb's center only
// travels [THUMB_PX/2, 100% - THUMB_PX/2], so marks map into that range,
// not the raw track percentage.
const THUMB_PX = 11;
const markLeft = (step: number, max: number) =>
  `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${max ? step / max : 0})`;

const deadLinesMsg = (lines: number[]) =>
  lines.length === 1
    ? `Breakpoint on line ${lines[0]} is never reached in this trace.`
    : `Breakpoints on lines ${lines.join(", ")} are never reached in this trace.`;

export function Vcr({
  player,
  breakpoints,
  deadLines = [],
  onClearBreakpoints,
}: {
  player: ReturnType<typeof usePlayer>;
  breakpoints?: Set<number>;
  deadLines?: number[];
  onClearBreakpoints?: () => void;
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
                  style={{ left: markLeft(step, max) }}
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
                style={{ left: markLeft(step, max) }}
              />
            ))}
          </div>
        </div>
        <span className="counter">Step {index + 1} of {total}</span>
      </div>

      {deadLines.length > 0 && (
        <p className="bp-dead-notice" role="status">{deadLinesMsg(deadLines)}</p>
      )}

      <div className="vcr-buttons">
        <button onClick={first} disabled={index === 0}>&lt;&lt; First</button>
        <button onClick={prev} disabled={index === 0}>&lt; Prev</button>
        <button onClick={handleNext} disabled={index === total - 1}>Next &gt;</button>
        <button onClick={last} disabled={index === total - 1}>Last &gt;&gt;</button>
        {bp.size > 0 && onClearBreakpoints && (
          <button className="clear-bps" onClick={onClearBreakpoints}>
            Clear breakpoints
          </button>
        )}
      </div>
    </div>
  );
}
