// Resource display helpers — the same fallback chain used by the
// graph-canvas node card AND the side detail panel. Lives here so both
// surfaces agree on which field is the resource's "display name", and
// so copy/paste between documents (patient ↔ rule) preserves the same
// display behavior.
//
// Order:
//   codeDisplay  → coded resources (Observation, Condition, ...)
//   display      → resources we authored a generic display field for
//                  (ClinicalImpression, Encounter, Appointment, ...)
//   name         → Patient, Practitioner, Organization, Location
//   title        → CarePlan
//   medication   → MedicationRequest, MedicationStatement
//   description  → Task
//   node.id      → final fallback so the card never renders blank

export interface FieldsOnly {
  fields: Record<string, string>;
  id: string;
}

// True when `v` is a whole-string template placeholder like "${var}".
// Used to keep rule-mode rectangles from surfacing internal AttrVar
// names ("${existingDisplay}", "${bp}", etc.) — those are meaningful
// in the engine but noise to a human reader.
const PLACEHOLDER_RX = /^\$\{[^}]+\}$/;
export const isPlaceholder = (v: string | undefined): boolean =>
  !!v && PLACEHOLDER_RX.test(v.trim());

// Strip placeholder-only values back to empty. Plain literals pass
// through untouched.
export const hidePlaceholder = (v: string | undefined): string =>
  v && !isPlaceholder(v) ? v : '';

// Returns the resource's display text per the shared fallback chain,
// or empty string if no display-like field is populated. Used by the
// canvas card (which falls back to icon-only when empty). Template
// placeholders are skipped so they don't leak into the rectangle.
export function displayOf(fields: Record<string, string>): string {
  const pick = (s: string | undefined) =>
    s && s.trim() && !isPlaceholder(s) ? s.trim() : '';
  return (
    pick(fields.codeDisplay) ||
    pick(fields.display) ||
    pick(fields.name) ||
    pick(fields.title) ||
    pick(fields.medication) ||
    pick(fields.description) ||
    ''
  );
}

// Same chain, but falls back to node.id as a last resort. Used by the
// detail panel header (which can't render blank).
export function displayOfWithIdFallback(node: FieldsOnly): string {
  return displayOf(node.fields) || node.id;
}
