import type { usePlayer } from "../player/usePlayer";

export function Vcr({ player }: { player: ReturnType<typeof usePlayer> }) {
  const { index, total, first, prev, next, last, goto } = player;
  const max = Math.max(0, total - 1);

  return (
    <div className="vcr" aria-label="Execution controls">
      <div className="timeline">
        <label htmlFor="execution-step">Step timeline</label>
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
        <span className="counter">Step {index + 1} of {total}</span>
      </div>

      <div className="vcr-buttons">
        <button onClick={first} disabled={index === 0}>
          &lt;&lt; First
        </button>
        <button onClick={prev} disabled={index === 0}>
          &lt; Prev
        </button>
        <button onClick={next} disabled={index === total - 1}>
          Next &gt;
        </button>
        <button onClick={last} disabled={index === total - 1}>
          Last &gt;&gt;
        </button>
      </div>
    </div>
  );
}
