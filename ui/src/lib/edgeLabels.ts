// FHIR reference field lookup — given a source and target resource type,
// returns the valid reference field names (i.e., valid edge labels).
//
// Used to (a) populate a typed dropdown when editing an edge label, and
// (b) infer a sensible default when drag-creating an edge between two
// nodes. Only covers the most common pairs the UI palette supports;
// unknown pairs fall back to free text editing with a generic 'reference'
// default.
//
// Source: FHIR R4 resource definitions. The first entry in each list is
// treated as the canonical default for that pair.

const REFERENCE_LABELS: Record<string, Record<string, string[]>> = {
  Observation: {
    Patient:          ['subject'],
    Encounter:        ['encounter'],
    Practitioner:     ['performer'],
    Observation:      ['hasMember', 'derivedFrom', 'partOf'],
    DiagnosticReport: ['basedOn'],
    Specimen:         ['specimen'],
  },
  Condition: {
    Patient:      ['subject'],
    Encounter:    ['encounter'],
    Practitioner: ['asserter', 'recorder'],
  },
  ClinicalImpression: {
    Patient:      ['subject'],
    Encounter:    ['encounter'],
    Practitioner: ['assessor'],
    // Junction labels for the engine's backbone-element handling.
    Observation:  ['finding'],
    Condition:    ['problem'],
  },
  MedicationRequest: {
    Patient:      ['subject'],
    Practitioner: ['requester', 'performer'],
    Encounter:    ['encounter'],
    Medication:   ['medication'],
    Condition:    ['reasonReference'],
  },
  Appointment: {
    Patient:      ['participant'],
    Practitioner: ['participant'],
    Location:     ['participant'],
  },
  Encounter: {
    Patient:      ['subject'],
    Practitioner: ['participant'],
    Location:     ['location'],
    Organization: ['serviceProvider'],
  },
  // (Source entries for Procedure, MedicationStatement, DiagnosticReport,
  // CarePlan, Task, AllergyIntolerance, ImagingStudy, ServiceRequest,
  // Communication, Goal, Specimen are intentionally absent — those types
  // aren't in the palette, so a node can never have them as a source.)
};

// Reverse-direction lookup. When the user drags from B to A and (B → A)
// isn't a known pair but (A → B) is, this returns the canonical label
// of the reverse direction so the UI can hint that the edge might be
// drawn the wrong way. Returns the canonical *label* used in the
// reverse direction; null if neither direction is known.
export function reverseEdgeLabel(fromType?: string, toType?: string): string | null {
  if (!fromType || !toType) return null;
  const reverse = REFERENCE_LABELS[toType]?.[fromType];
  return reverse && reverse.length > 0 ? reverse[0] : null;
}

// Valid edge labels for a given (sourceType, targetType) pair, or undefined
// if the pair isn't enumerated. Useful for both default inference and the
// dropdown editor.
export function validEdgeLabels(fromType?: string, toType?: string): string[] | undefined {
  if (!fromType || !toType) return undefined;
  return REFERENCE_LABELS[fromType]?.[toType];
}

// Best-guess default label for a new edge — first valid option for the
// pair, falling back to "reference" if the pair is unknown.
export function defaultEdgeLabel(fromType?: string, toType?: string): string {
  const opts = validEdgeLabels(fromType, toType);
  return opts && opts.length > 0 ? opts[0] : 'reference';
}
