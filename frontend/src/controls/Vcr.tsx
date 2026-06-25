import type { usePlayer } from "../player/usePlayer";

export function Vcr({ player }: { player: ReturnType<typeof usePlayer> }) {
  const { index, total, first, prev, next, last } = player;
  return (
    <div className="vcr">
      <button onClick={first} disabled={index === 0}>&lt;&lt; First</button>
      <button onClick={prev} disabled={index === 0}>&lt; Prev</button>
      <button onClick={next} disabled={index === total - 1}>Next &gt;</button>
      <button onClick={last} disabled={index === total - 1}>Last &gt;&gt;</button>
      <span className="counter">Step {index + 1} of {total}</span>
    </div>
  );
}
