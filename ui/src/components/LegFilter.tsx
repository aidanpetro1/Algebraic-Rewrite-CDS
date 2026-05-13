// LegFilter — a thin strip above the canvas in rule-authoring mode.
// Lets the user focus on a single leg (L / K / R) or a NAC at a time.
// "All" is null. NACs appearing on any node show up automatically.

import { CORE_LEGS, tone } from '../lib/legs';

interface Props {
  nacs: string[];                                 // NACs in current use
  active: string | null;                          // null = "All"
  onChange: (next: string | null) => void;
}

export function LegFilter({ nacs, active, onChange }: Props) {
  // Click semantics: clicking the active chip clears the filter.
  const click = (leg: string | null) =>
    onChange(active === leg ? null : leg);

  return (
    <div className="legfilter">
      <span className="legfilter-label">Show leg:</span>
      <button
        className={'leg-chip ' + (active === null ? 'on' : '')}
        onClick={() => click(null)}
      >
        All
      </button>
      {CORE_LEGS.map((l) => (
        <button
          key={l}
          className={`leg-chip ${tone(l)} ` + (active === l ? 'on' : '')}
          onClick={() => click(l)}
          title={l === 'L' ? 'Pattern (left)' : l === 'K' ? 'Interface (preserved)' : 'Rewrite target (right)'}
        >
          {l}
        </button>
      ))}
      {nacs.length > 0 && <span className="legfilter-sep" />}
      {nacs.map((n) => (
        <button
          key={n}
          className={`leg-chip ${tone(n)} ` + (active === n ? 'on' : '')}
          onClick={() => click(n)}
          title="Negative application condition"
        >
          {n}
        </button>
      ))}
      <span style={{ flex: 1 }} />
      <span className="legfilter-hint">
        {active === null
          ? 'Tag nodes with leg chips in the side panel'
          : active.startsWith('N')
          ? `Showing NAC ${active}`
          : `Showing leg ${active}`}
      </span>
    </div>
  );
}
