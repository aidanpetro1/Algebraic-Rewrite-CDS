// Sample rules pre-seeded into the rule library on first load.
//
// These show what a realistic clinical rule looks like in the system,
// using the FHIR-shaped schema and the engine's leg/predicate machinery.
// On first load (when localStorage has no saved rules), App seeds these
// so the library isn't empty out of the box. Users can rename, edit,
// disable, or delete any of them.
//
// Status of each through the Julia engine:
//   * htn-dm2-comorbid:  RUNNABLE — uses Observation/Condition/CI only
//   * recommend-metformin: UI-ONLY — MedicationRequest isn't in the
//                          engine's CState schema yet
//   * recommend-ophth-referral: UI-ONLY — Appointment isn't in the schema
//                          (and the "past 1 year" temporal predicate
//                          requires the FHIRPath subset interpreter
//                          from Phase 3 of fhir_pipeline_design.md).
// Not-yet-runnable rules still author + export cleanly; firing them
// against the engine is a no-op for the new resource (the structural
// match still has to succeed for the rule to "fire").

import type { Edge, Node, Predicate, SavedRule } from '../lib/types';

const ts = Date.now();

// ============================================================
// Rule 1: HTN + DM2 from comorbid evidence
// L  = two BP Observations + one HbA1c Observation
// R  = + HTN Condition + DM2 Condition + ClinicalImpression linking to all
// N1 = no existing HTN diagnosis
// N2 = no existing DM2 diagnosis
// Predicates:
//   - BP1.valueQuantity.value >= 140
//   - BP2.valueQuantity.value >= 140
//   - HbA1c.valueQuantity.value >= 6.5
// (The "two readings month apart" temporal constraint is in the
//  description; structurally we just require two readings.)
// ============================================================
const htnDm2Nodes: Node[] = [
  // The three observation entries are only tagged L/K/R — every L-pattern
  // entry must appear in each NAC for the L→N morphism to be constructible,
  // but expandLegsForNACs (ruleBundle.ts) splices the N tags through at
  // export time, so authoring only carries the "extra" forbidden-context
  // entries (cond-htn for N1, cond-dm2 for N2) explicitly.
  {
    id: 'obs-bp1', type: 'Observation', x: 240, y: 180,
    legs: ['L', 'K', 'R'],
    fields: {
      codeSystem: 'http://loinc.org', codeValue: '8480-6',
      codeDisplay: 'Systolic blood pressure',
      value: '${bp1}', unit: 'mmHg', status: '${status1}', effective: '${time1}',
    },
  },
  {
    id: 'obs-bp2', type: 'Observation', x: 240, y: 380,
    legs: ['L', 'K', 'R'],
    fields: {
      codeSystem: 'http://loinc.org', codeValue: '8480-6',
      codeDisplay: 'Systolic blood pressure',
      value: '${bp2}', unit: 'mmHg', status: '${status2}', effective: '${time2}',
    },
  },
  {
    id: 'obs-a1c', type: 'Observation', x: 240, y: 580,
    legs: ['L', 'K', 'R'],
    fields: {
      codeSystem: 'http://loinc.org', codeValue: '4548-4',
      codeDisplay: 'Hemoglobin A1c',
      value: '${a1c}', unit: '%', status: '${status3}', effective: '${time3}',
    },
  },
  // Newly-created HTN (R only, literal target values).
  {
    id: 'cond-htn-new', type: 'Condition', x: 720, y: 240,
    legs: ['R'],
    fields: {
      codeSystem: 'http://snomed.info/sct', codeValue: '38341003',
      codeDisplay: 'Hypertensive disorder',
      clinicalStatus: 'active', recordedDate: '${now}',
    },
  },
  // Forbidden pre-existing HTN (N1 only, AttrVar attributes).
  {
    id: 'cond-htn-existing', type: 'Condition', x: 940, y: 240,
    legs: ['N1'],
    fields: {
      codeSystem: 'http://snomed.info/sct', codeValue: '38341003',
      codeDisplay: '${htnExistingDisplay}',
      clinicalStatus: '${htnExistingStatus}',
      recordedDate: '${htnExistingDate}',
    },
  },
  // Newly-created DM2 (R only).
  {
    id: 'cond-dm2-new', type: 'Condition', x: 720, y: 480,
    legs: ['R'],
    fields: {
      codeSystem: 'http://snomed.info/sct', codeValue: '44054006',
      codeDisplay: 'Type 2 diabetes mellitus',
      clinicalStatus: 'active', recordedDate: '${now}',
    },
  },
  // Forbidden pre-existing DM2 (N2 only).
  {
    id: 'cond-dm2-existing', type: 'Condition', x: 940, y: 480,
    legs: ['N2'],
    fields: {
      codeSystem: 'http://snomed.info/sct', codeValue: '44054006',
      codeDisplay: '${dm2ExistingDisplay}',
      clinicalStatus: '${dm2ExistingStatus}',
      recordedDate: '${dm2ExistingDate}',
    },
  },
  {
    id: 'assm', type: 'ClinicalImpression', x: 480, y: 360,
    legs: ['R'],
    fields: { status: 'completed', date: '${now}' },
  },
];
const htnDm2Edges: Edge[] = [
  { from: 'assm', to: 'obs-bp1',      label: 'finding' },
  { from: 'assm', to: 'obs-bp2',      label: 'finding' },
  { from: 'assm', to: 'obs-a1c',      label: 'finding' },
  { from: 'assm', to: 'cond-htn-new', label: 'problem' },
  { from: 'assm', to: 'cond-dm2-new', label: 'problem' },
];
const htnDm2Predicates: Predicate[] = [
  {
    id: 'pred-bp1', target: 'obs-bp1', label: 'SBP #1 ≥ 140',
    attribute: 'valueQuantity.value', operator: '>=', value: '140',
    fhirpath: "Observation.code.coding.where(system='http://loinc.org' and code='8480-6').exists() and Observation.valueQuantity.value >= 140",
  },
  {
    id: 'pred-bp2', target: 'obs-bp2', label: 'SBP #2 ≥ 140',
    attribute: 'valueQuantity.value', operator: '>=', value: '140',
    fhirpath: "Observation.code.coding.where(system='http://loinc.org' and code='8480-6').exists() and Observation.valueQuantity.value >= 140",
  },
  {
    id: 'pred-a1c', target: 'obs-a1c', label: 'HbA1c ≥ 6.5',
    attribute: 'valueQuantity.value', operator: '>=', value: '6.5',
    fhirpath: "Observation.code.coding.where(system='http://loinc.org' and code='4548-4').exists() and Observation.valueQuantity.value >= 6.5",
  },
];

// ============================================================
// Rule 2: Recommend metformin for active DM2 (no existing rx)
// L  = DM2 Condition
// R  = + MedicationRequest for metformin (literal RxNorm + dosage)
// N1 = no existing MedicationRequest matching the same RxNorm code
//      (display/dosage are AttrVars so any prior metformin order
//      blocks regardless of how the EHR labelled it)
// ============================================================
const metforminNodes: Node[] = [
  {
    id: 'cond-dm2', type: 'Condition', x: 240, y: 360,
    legs: ['L', 'K', 'R'],
    fields: {
      codeSystem: 'http://snomed.info/sct', codeValue: '44054006',
      codeDisplay: 'Type 2 diabetes mellitus',
      clinicalStatus: '${status}', recordedDate: '${time}',
    },
  },
  // Newly-created order (R only). Literal codes + dosage — the rewrite
  // materializes a real prescription with these exact values.
  {
    id: 'medreq-new', type: 'MedicationRequest', x: 720, y: 360,
    legs: ['R'],
    fields: {
      codeSystem:  'http://www.nlm.nih.gov/research/umls/rxnorm',
      codeValue:   '861007',
      codeDisplay: 'metformin 1000 MG oral tablet',
      status:      'active',
      intent:      'order',
      dosage:      '1 tablet by mouth twice daily',
    },
  },
  // Forbidden pre-existing order (N1 only). Codes are literal (the
  // matching key — RxNorm 861007); display/status/intent/dosage are
  // AttrVars so the NAC matches any prior metformin order regardless
  // of how it's recorded. Same pattern as cond-htn-existing.
  {
    id: 'medreq-existing', type: 'MedicationRequest', x: 720, y: 580,
    legs: ['N1'],
    fields: {
      codeSystem:  'http://www.nlm.nih.gov/research/umls/rxnorm',
      codeValue:   '861007',
      codeDisplay: '${existingDisplay}',
      status:      '${existingStatus}',
      intent:      '${existingIntent}',
      dosage:      '${existingDosage}',
    },
  },
];
const metforminPredicates: Predicate[] = [];

// ============================================================
// Rule 3: Recommend ophthalmology referral for DM2 patients without
// a recent ophthalmology appointment.
// L  = DM2 Condition
// R  = + Appointment (ophthalmology recommendation)
// N1 = an existing ophthalmology Appointment within the past 1 year
//      (predicate enforces "within last year")
// (Appointment is now in the engine schema, plus basedOn → Condition
//  via the ApptBasedOn junction. The "past 1 year" temporal predicate
//  still needs the FHIRPath subset interpreter from phase 3, so the
//  recency check is structural-only for now.)
// ============================================================
const ophthRefNodes: Node[] = [
  {
    id: 'cond-dm2', type: 'Condition', x: 240, y: 360,
    legs: ['L', 'K', 'R'],
    fields: {
      codeSystem: 'http://snomed.info/sct', codeValue: '44054006',
      codeDisplay: 'Type 2 diabetes mellitus',
      clinicalStatus: '${status}', recordedDate: '${time}',
    },
  },
  {
    id: 'enc-existing', type: 'Encounter', x: 240, y: 180,
    legs: ['N1'],
    fields: {
      // NAC pattern: any prior finished ophthalmology Encounter blocks
      // the referral. Code is literal (matching key — must be SNOMED
      // 408451005 Ophthalmology). codeDisplay/start/end are AttrVars
      // so the NAC matches any prior ophth visit regardless of when.
      codeSystem:  'http://snomed.info/sct',
      codeValue:   '408451005',
      codeDisplay: '${prevDisplay}',
      status:      'finished',
      class:       '${prevClass}',
      start:       '${prevStart}',
      end:         '${prevEnd}',
    },
  },
  {
    id: 'appt-new', type: 'Appointment', x: 720, y: 360,
    legs: ['R'],
    fields: {
      // The referral itself is still an Appointment (a proposed slot
      // that hasn't happened yet). Disease-specific display so the
      // patient graph clearly says what the new referral is for.
      // SNOMED 722112000 = "Diabetic retinopathy screening procedure".
      codeSystem:  'http://snomed.info/sct',
      codeValue:   '722112000',
      codeDisplay: 'Ophthalmology referral for diabetic retinopathy screening',
      status:      'proposed',
      start:       '${now}',
      end:         '${now}',
    },
  },
];
const ophthRefPredicates: Predicate[] = [
  {
    id: 'pred-recent', target: 'appt-existing', label: 'Appointment in last year',
    attribute: 'start', operator: '>=', value: 'now-365d',
    fhirpath: "Appointment.start >= now() - 365 'days'",
  },
];

// ============================================================
// Standalone HTN — single SBP reading ≥ 140 → HTN Condition.
// IMPORTANT: the NAC condition (cond-htn-existing) is structurally
// distinct from the new condition (cond-htn-new) because their attribute
// shapes differ. The new one has literal values (display, status, date)
// for what we're creating; the existing one has AttrVars so the NAC
// matches ANY pre-existing HTN diagnosis regardless of how it's
// currently recorded. This is what prevents the rule from re-firing
// and creating duplicates after the first fire.
// ============================================================
const htnNodes: Node[] = [
  {
    id: 'obs-bp', type: 'Observation', x: 280, y: 380,
    legs: ['L', 'K', 'R'],
    fields: {
      codeSystem: 'http://loinc.org', codeValue: '8480-6',
      codeDisplay: 'Systolic blood pressure',
      value: '${bp}', unit: 'mmHg', status: '${status}', effective: '${time}',
    },
  },
  // Newly-created HTN diagnosis (R only). Literal values: this is what
  // we want the rewrite to materialize.
  {
    id: 'cond-htn-new', type: 'Condition', x: 720, y: 380,
    legs: ['R'],
    fields: {
      codeSystem: 'http://snomed.info/sct', codeValue: '38341003',
      codeDisplay: 'Hypertensive disorder',
      clinicalStatus: 'active', recordedDate: '${now}',
    },
  },
  // Forbidden pre-existing HTN diagnosis (N1 only). Codes are literal
  // (the trigger that identifies "this is HTN"); display, status, and
  // recordedDate are AttrVars so any prior HTN diagnosis matches.
  {
    id: 'cond-htn-existing', type: 'Condition', x: 720, y: 600,
    legs: ['N1'],
    fields: {
      codeSystem: 'http://snomed.info/sct', codeValue: '38341003',
      codeDisplay: '${existingDisplay}',
      clinicalStatus: '${existingStatus}',
      recordedDate: '${existingDate}',
    },
  },
  {
    id: 'assm-htn', type: 'ClinicalImpression', x: 500, y: 200,
    legs: ['R'],
    fields: { status: 'completed', date: '${now}' },
  },
];
const htnEdges: Edge[] = [
  { from: 'assm-htn', to: 'obs-bp',       label: 'finding' },
  { from: 'assm-htn', to: 'cond-htn-new', label: 'problem' },
];
const htnPredicates: Predicate[] = [
  {
    id: 'pred-htn-bp', target: 'obs-bp', label: 'SBP ≥ 140',
    attribute: 'valueQuantity.value', operator: '>=', value: '140',
    fhirpath: "Observation.code.coding.where(system='http://loinc.org' and code='8480-6').exists() and Observation.valueQuantity.value >= 140",
  },
];

// ============================================================
// Standalone DM2 — single HbA1c ≥ 6.5 → T2DM Condition. Same
// new/existing split as the HTN rule: cond-dm2-new has literals (the
// diagnosis we create), cond-dm2-existing has AttrVars on display /
// status / recordedDate so the NAC matches any pre-existing DM2.
// ============================================================
const dm2Nodes: Node[] = [
  {
    id: 'obs-a1c', type: 'Observation', x: 280, y: 380,
    legs: ['L', 'K', 'R'],
    fields: {
      codeSystem: 'http://loinc.org', codeValue: '4548-4',
      codeDisplay: 'Hemoglobin A1c',
      value: '${a1c}', unit: '%', status: '${status}', effective: '${time}',
    },
  },
  {
    id: 'cond-dm2-new', type: 'Condition', x: 720, y: 380,
    legs: ['R'],
    fields: {
      codeSystem: 'http://snomed.info/sct', codeValue: '44054006',
      codeDisplay: 'Type 2 diabetes mellitus',
      clinicalStatus: 'active', recordedDate: '${now}',
    },
  },
  {
    id: 'cond-dm2-existing', type: 'Condition', x: 720, y: 600,
    legs: ['N1'],
    fields: {
      codeSystem: 'http://snomed.info/sct', codeValue: '44054006',
      codeDisplay: '${existingDisplay}',
      clinicalStatus: '${existingStatus}',
      recordedDate: '${existingDate}',
    },
  },
  {
    id: 'assm-dm2', type: 'ClinicalImpression', x: 500, y: 200,
    legs: ['R'],
    fields: { status: 'completed', date: '${now}' },
  },
];
const dm2Edges: Edge[] = [
  { from: 'assm-dm2', to: 'obs-a1c',     label: 'finding' },
  { from: 'assm-dm2', to: 'cond-dm2-new', label: 'problem' },
];
const dm2Predicates: Predicate[] = [
  {
    id: 'pred-a1c-65', target: 'obs-a1c', label: 'HbA1c ≥ 6.5',
    attribute: 'valueQuantity.value', operator: '>=', value: '6.5',
    fhirpath: "Observation.code.coding.where(system='http://loinc.org' and code='4548-4').exists() and Observation.valueQuantity.value >= 6.5",
  },
];

export const SAMPLE_RULES: SavedRule[] = [
  {
    id: 'sample-htn',
    name: 'Diagnose Hypertension',
    description: 'SBP ≥ 140 mmHg → add HTN Condition (unless already present).',
    enabled: true,
    graph: { nodes: htnNodes, edges: htnEdges, predicates: htnPredicates },
    createdAt: ts, updatedAt: ts,
  },
  {
    id: 'sample-dm2',
    name: 'Diagnose Type 2 Diabetes',
    description: 'HbA1c ≥ 6.5% → add T2DM Condition (unless already present).',
    enabled: true,
    graph: { nodes: dm2Nodes, edges: dm2Edges, predicates: dm2Predicates },
    createdAt: ts, updatedAt: ts,
  },
  {
    id: 'sample-htn-dm2',
    name: 'Diagnose HTN + DM2 (comorbid)',
    description: 'Two SBP readings ≥ 140 mmHg AND HbA1c ≥ 6.5% → add both diagnoses in one fire. Demonstrates that firing this is equivalent to firing the standalone HTN and DM2 rules in sequence.',
    enabled: false,
    graph: { nodes: htnDm2Nodes, edges: htnDm2Edges, predicates: htnDm2Predicates },
    createdAt: ts, updatedAt: ts,
  },
  {
    id: 'sample-metformin',
    name: 'Recommend metformin for DM2',
    description: 'Active T2DM AND no existing metformin order → suggest metformin 1000 mg BID.',
    enabled: false,
    graph: {
      nodes: metforminNodes,
      // reasonReference wires the new prescription back to the DM2
      // diagnosis so the patient graph shows what triggered it.
      // Source is medreq-new (the R-side literal) — medreq-existing is
      // a NAC-only matching pattern with no edges of its own.
      edges: [{ from: 'medreq-new', to: 'cond-dm2', label: 'reasonReference' }],
      predicates: metforminPredicates,
    },
    createdAt: ts, updatedAt: ts,
  },
  {
    id: 'sample-ophth-ref',
    name: 'Recommend ophthalmology referral',
    description: 'Active T2DM AND no fulfilled ophthalmology appointment in the last year → suggest referral.',
    enabled: false,
    graph: {
      nodes: ophthRefNodes,
      // The new appointment references the DM2 condition that
      // motivated it (basedOn is the conventional FHIR field for that).
      edges: [{ from: 'appt-new', to: 'cond-dm2', label: 'basedOn' }],
      predicates: ophthRefPredicates,
    },
    createdAt: ts, updatedAt: ts,
  },
];
