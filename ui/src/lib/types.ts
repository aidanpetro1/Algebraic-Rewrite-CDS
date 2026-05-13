// Domain types shared by the graph builder.
//
// FieldMap is intentionally a flat record of strings — matches the design's
// "key: value" preview row shape. When we later wire this to real FHIR
// resources, FieldMap becomes a typed view onto a subset of the FHIR resource.

export type FieldMap = Record<string, string>;

export interface Node {
  id: string;
  type: string;     // FHIR resource type, e.g. "Observation"
  x: number;
  y: number;
  fields: FieldMap;

  // Rule-mode metadata. Both optional so patient-state graphs are unaffected.
  // legs:    DPO/NAC leg memberships ("L" | "K" | "R" | "N1" | "N2" | …).
  //          Empty/undefined means "not part of any rule leg" — the patient-
  //          state authoring case. A node tagged in multiple legs is the same
  //          resource preserved across legs (DPO morphism encoding).
  // fullUrl: stable URN for FHIR-level identity. Auto-generated on first need
  //          so layout coords can round-trip via a meta.tag extension on the
  //          rule Bundle (per docs/fhir_pipeline_design.md).
  legs?: string[];
  fullUrl?: string;
}

// A rule predicate — FHIRPath expression bound to a specific node by fullUrl.
// Stored on the App as a flat list; serialized into the rule Bundle's
// `Basic` manifest under the `predicate` extension.
//
// `fhirpath` is the canonical wire-format field — that's what gets shipped
// to the Julia engine. The optional `attribute`/`operator`/`value` triple
// is a structured authoring layer: when present the UI renders dropdown +
// input controls and *re-generates* fhirpath from these fields on every
// edit. Imported predicates that match a recognized shape get reverse-
// parsed into the structured fields; anything else is shown raw and edited
// directly.
export interface Predicate {
  id: string;          // local ui id, stable across edits
  target: string;      // node.id (resolves to fullUrl at export time)
  fhirpath: string;
  label: string;

  // Structured authoring (optional). Set together; missing means "raw mode".
  attribute?: string;  // e.g. "valueQuantity.value", "status"
  operator?: string;   // ">=", "<=", ">", "<", "==", "!=", "exists"
  value?: string;      // comparison value (numeric or quoted string for ==/!=)
}

export type RuleLeg = 'L' | 'K' | 'R' | `N${number}`;

// Authoring mode toggle. `patient` shows the patient document; `rule` shows
// the rule document with leg chrome (chips, leg filter, predicates pane);
// `compare` renders both side by side so the user can see how a rule
// firing affects the patient state.
export type AuthoringMode = 'patient' | 'rule' | 'compare';

// One saved rule in the library. The `graph` is a snapshot of what was in
// the rule editor when the rule was saved — same shape as an in-memory
// rule document. `enabled` controls whether the rule participates in a
// batch fire. `activeForBatch` rules fire in the order they appear in the
// list; the patient state threads through one to the next.
export interface SavedRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  graph: {
    nodes: Node[];
    edges: Edge[];
    predicates: Predicate[];
  };
  createdAt: number;
  updatedAt: number;
}

// One per-rule outcome from a batch fire. `status` mirrors the engine's
// statuses (fired / no_match / nac_violated / pred_failed / pac_unmet) +
// `error` for transport / parse failures.
export interface BatchFireResult {
  ruleId: string;
  ruleName: string;
  status: 'fired' | 'no_match' | 'nac_violated' | 'pred_failed' | 'pac_unmet' | 'error';
  message?: string;        // engine reason text or error
  newResourceCount?: number;  // for `fired`: how many resources were added
}

export interface Edge {
  from: string;     // source node id
  to: string;       // target node id
  label: string;    // FHIR reference field name, e.g. "subject", "encounter"
}

export interface PaletteItem {
  type: string;     // FHIR resource type
  short: string;    // 2-letter shorthand for the badge
}

export interface PaletteGroup {
  name: string;
  cls: string;      // CSS class for the badge tone (cat-clinical, cat-workflow, ...)
  items: PaletteItem[];
}

export interface TypeInfo extends PaletteItem {
  cls: string;
  group: string;
}

// Pan/zoom transform of the canvas viewport.
export interface View {
  x: number;
  y: number;
  k: number;        // scale (clamp 0.3..2.5)
}

// MIME used for palette → canvas drag-and-drop.
export const FHIR_TYPE_MIME = 'application/x-fhir-type';
