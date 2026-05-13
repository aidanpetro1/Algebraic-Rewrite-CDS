// FHIRPath generation + recognition for predicate authoring.
//
// Generation: turns (resourceType, codeSystem, codeValue, attribute, op, value)
// into the canonical "Resource.code.coding.where(...).exists() and Resource.<attr> OP <val>"
// shape that the Julia engine's regex parser recognizes.
//
// Recognition: tries to parse a raw FHIRPath back into the structured triple.
// When it works, the UI shows the structured editor; when it doesn't, the UI
// falls back to a raw textarea — keeping hand-authored expressions usable.

import type { Node } from './types';

// Per-resource-type list of attributes the UI exposes as predicate targets.
// Pairs each attribute with its FHIRPath path AND its expected operand type
// (so the value editor can render a number input vs. a select).
export type AttrType = 'numeric' | 'string' | 'date';
export interface AttrSpec {
  path: string;            // FHIRPath path under the resource root
  label: string;           // human-readable label
  type: AttrType;
  options?: string[];      // for enum-like string attrs (e.g. status values)
}

const OBSERVATION_STATUSES = ['registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled', 'entered-in-error', 'unknown'];
const CONDITION_CLINICAL = ['active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved'];
const IMPRESSION_STATUSES = ['preparation', 'in-progress', 'completed', 'entered-in-error'];

export const ATTRS_BY_TYPE: Record<string, AttrSpec[]> = {
  Observation: [
    { path: 'valueQuantity.value', label: 'Value (numeric)',     type: 'numeric' },
    { path: 'status',              label: 'Status',              type: 'string', options: OBSERVATION_STATUSES },
    { path: 'effectiveDateTime',   label: 'Effective time',      type: 'date'    },
  ],
  Condition: [
    { path: 'clinicalStatus.coding.code', label: 'Clinical status', type: 'string', options: CONDITION_CLINICAL },
    { path: 'recordedDate',               label: 'Recorded date',   type: 'date'    },
  ],
  ClinicalImpression: [
    { path: 'status', label: 'Status', type: 'string', options: IMPRESSION_STATUSES },
    { path: 'date',   label: 'Date',   type: 'date'    },
  ],
};

// Operators grouped by attribute kind, picked so each set makes semantic
// sense for its type. Numeric supports the full comparison set. Strings
// support equality / inequality / existence — comparison would require a
// custom collation. Dates support relational comparison only — exact `==`
// on continuous time is rarely useful, so we drop it (and `!=`).
export const OPS_NUMERIC = ['>=', '<=', '>', '<', '==', '!='] as const;
export const OPS_STRING  = ['==', '!=', 'exists'] as const;
export const OPS_DATE    = ['>=', '<=', '>', '<'] as const;

export function opsForType(t: AttrType): readonly string[] {
  return t === 'numeric' ? OPS_NUMERIC : t === 'date' ? OPS_DATE : OPS_STRING;
}

// Lookup the AttrSpec for a (type, path) pair. Used by the UI to pick the
// right operator set when an old predicate is loaded.
export function attrSpec(rt: string, path: string): AttrSpec | undefined {
  return ATTRS_BY_TYPE[rt]?.find((a) => a.path === path);
}

// Relative-date presets — the value editor offers these as a dropdown
// when the attribute is a date type. The "value" stored in the predicate
// is the preset key (e.g. "now-7d"); generation expands it to FHIRPath
// arithmetic on now(). User can also pick "custom" and supply an
// absolute ISO datetime via a datetime-local input.
export interface DatePreset { value: string; label: string; }
export const DATE_PRESETS: DatePreset[] = [
  { value: 'now-7d',   label: 'Last 7 days' },
  { value: 'now-30d',  label: 'Last 30 days' },
  { value: 'now-90d',  label: 'Last 3 months' },
  { value: 'now-180d', label: 'Last 6 months' },
  { value: 'now-365d', label: 'Last year' },
  { value: 'custom',   label: 'Custom date…' },
];

// "now-Nu" → ("days" | "months" | "years", N). Recognized suffixes:
//   d=days, w=weeks (treated as 7d), M=months, y=years.
function parseRelative(v: string): { n: number; unit: string } | null {
  const m = v.match(/^now-(\d+)([dwMy])$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit =
    m[2] === 'd' ? 'days'   :
    m[2] === 'w' ? 'weeks'  :
    m[2] === 'M' ? 'months' :
    m[2] === 'y' ? 'years'  : 'days';
  return { n, unit };
}

// Format the comparison value into FHIRPath syntax. Numbers go bare;
// strings get single-quoted; dates either expand a relative-preset to
// `now() - N 'unit'` arithmetic or wrap an absolute date in @.
// The Julia parser only recognizes numeric comparisons today, so a
// generated string equality OR a date comparison falls back to the
// stub-with-warning path on the engine side.
function formatValue(v: string, type: AttrType): string {
  if (type === 'numeric') return v;
  if (type === 'date') {
    const rel = parseRelative(v);
    if (rel) return `now() - ${rel.n} '${rel.unit}'`;
    return `@${v}`;
  }
  return `'${v.replace(/'/g, "\\'")}'`;
}

// Generate the canonical FHIRPath for a predicate on a node.
//   target node carries codeSystem + codeValue → the .where(...).exists() prefix.
// If those are missing or empty, omit the prefix (the predicate then runs
// on any resource of the matching type that the rule's L pattern picks up).
export function generateFhirpath(
  node: Node,
  attribute: string,
  operator: string,
  value: string,
): string {
  const rt = node.type;
  const sys = (node.fields.codeSystem ?? '').trim();
  const cod = (node.fields.codeValue  ?? '').trim();

  const spec = attrSpec(rt, attribute);
  const type: AttrType = spec?.type ?? 'string';

  // exists() is a unary operator — no comparison value.
  const right = operator === 'exists'
    ? `${rt}.${attribute}.exists()`
    : `${rt}.${attribute} ${operator} ${formatValue(value, type)}`;

  if (sys && cod) {
    const prefix = `${rt}.code.coding.where(system='${sys}' and code='${cod}').exists()`;
    return `${prefix} and ${right}`;
  }
  return right;
}

// Reverse — try to parse a raw FHIRPath back into the structured form.
// Recognized shape (mirrors what generateFhirpath emits, modulo whitespace):
//   <Type>.code.coding.where(system='SYS' and code='COD').exists()
//     and <Type>.<attr> OP <val>
// Returns the triple if recognized; null otherwise (caller falls back to
// raw editing).
export function parseFhirpath(fp: string): { attribute: string; operator: string; value: string } | null {
  // Permissive regex: optional .code.coding.where(...).exists() prefix,
  // then a `Type.attribute OP value` clause. We don't try to capture the
  // type — the UI knows it from the target node.
  const rx = new RegExp(
    String.raw`(?:^|\s+and\s+)` +
    String.raw`[A-Z]\w+\.([a-zA-Z][\w.]*)` +
    String.raw`\s*(>=|<=|>|<|==|!=)\s*` +
    String.raw`('[^']*'|@?[\w\-:.]+)` +
    String.raw`\s*$`,
  );
  const m = fp.match(rx);
  if (!m) return null;
  let value = m[3];
  // Strip quote / @ wrappers so the editor input shows the raw value.
  if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
  else if (value.startsWith('@')) value = value.slice(1);
  return { attribute: m[1], operator: m[2], value };
}
