import type { UbDiagnosis } from "./diagnose";

/** The undefined-behaviour report. Replaces the flat string dump that used to
 *  render `exception_msg` verbatim — see `diagnose.ts` for why that was not
 *  worth showing a learner.
 *
 *  Reads `--red` throughout: errors and unresolved things are red everywhere
 *  else in the app, and this is the app's most serious error. */
export function UbPanel({ diagnosis, step }: { diagnosis: UbDiagnosis; step: number }) {
  return (
    <div className={`ub-panel is-${diagnosis.category}`} role="alert">
      <div className="ub-head">
        <span className="ub-title">{diagnosis.title}</span>
        <span className="ub-step">step {step}</span>
      </div>
      <p className="ub-meaning">{diagnosis.meaning}</p>
      <p className="ub-why">{diagnosis.why}</p>
      {/* The real memcheck line, so nothing is hidden from someone who wants
          the actual text — or who is about to search the web for it. */}
      <pre className="ub-detail">{diagnosis.detail}</pre>
      <p className="ub-stopped">
        Execution stopped here. Past this point the program has no defined
        meaning, so continuing to trace it would show you a fiction.
      </p>
    </div>
  );
}
