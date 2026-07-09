import { SHORTCUT_TABLE } from "./keymap";

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-backdrop" onClick={onClose}>
      <div
        className="help-panel"
        role="dialog"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-head">
          <h2>Keyboard shortcuts</h2>
          <button className="help-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <table className="help-table">
          <tbody>
            {SHORTCUT_TABLE.map((row) => (
              <tr key={row.keys}>
                <td className="help-keys">{row.keys}</td>
                <td>{row.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
