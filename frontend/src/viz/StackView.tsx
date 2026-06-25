import type { ExecPoint } from "../types/trace";

interface Frame {
  func_name: string;
  ordered_varnames: string[];
  encoded_locals: Record<string, unknown>;
}

function renderValue(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) {
    // OPT C_DATA scalar: ["C_DATA", addr, type, value]
    if (v[0] === "C_DATA" && v.length === 4) {
      const val = v[3];
      if (val === null) return "null";
      if (typeof val === "object") return "…"; // pointer/struct → Milestone 2
      return String(val);
    }
    return "…"; // REF and other encodings → Milestone 2
  }
  if (typeof v === "object") return "…";
  return String(v);
}

export function StackView({ point }: { point: ExecPoint }) {
  const frames = point.stack_to_render as unknown as Frame[];
  return (
    <div className="stack">
      <h3>Stack</h3>
      {frames.map((f, i) => (
        <div className="frame" key={i}>
          <div className="frame-name">{f.func_name}</div>
          <table>
            <tbody>
              {f.ordered_varnames.map((name) => (
                <tr key={name}>
                  <td className="var-name">{name}</td>
                  <td className="var-val">{renderValue(f.encoded_locals[name])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
