/**
 * The single × affordance for dismissing an inspector. Four panels had four
 * different spellings of this button (differing font sizes, borders, and two
 * of them with no accessible name at all).
 */
export function CloseButton({ onClick, label = "Close details" }: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button type="button" className="close-btn" aria-label={label} onClick={onClick}>
      ×
    </button>
  );
}
