// Palette groups + initial scenario seed.
//
// Group classes match the .cat-* tones in app.css (clinical/workflow/meds/
// diag/admin). The seed is a Type-2 diabetes follow-up scenario aligned to
// the design handoff and to Algebraic_CDS's rule_dm2 vignette — opening the
// app drops the user straight into the same data the round-trip test
// processes, so the relationship between the UI and the backend pipeline is
// concrete on first contact.

import type { PaletteGroup, TypeInfo, Node, Edge, Predicate } from '../lib/types';

// Only resource types the engine actually parses are exposed in the
// palette. Adding others here would let users drag a node onto the canvas
// that errors on fire because clinical_state_multi.jl has no Ob for it.
// The mapping is:
//   Patient            — UI passthrough (subject-of-everything; not an Ob)
//   Observation        — clinical_state_multi.jl Ob
//   Condition          — clinical_state_multi.jl Ob
//   ClinicalImpression — clinical_state_multi.jl Ob
//   Encounter          — clinical_state_multi.jl Ob
//   Appointment        — clinical_state_multi.jl Ob
//   MedicationRequest  — clinical_state_multi.jl Ob
// To add a new resource type: extend the schema (Ob + attrs + linker
// Homs), parse/serialize/fhir_to_rule per the file guide in README, then
// add it here. Keeping this list in sync with the engine is enforced
// nowhere — silent palette drift is a real risk.
export const PALETTE_GROUPS: PaletteGroup[] = [
  {
    name: 'Clinical',
    cls: 'cat-clinical',
    items: [
      { type: 'Patient', short: 'Pa' },
      { type: 'Condition', short: 'Co' },
      { type: 'Observation', short: 'Ob' },
      { type: 'ClinicalImpression', short: 'CI' },
    ],
  },
  {
    name: 'Workflow',
    cls: 'cat-workflow',
    items: [
      { type: 'Encounter', short: 'En' },
      { type: 'Appointment', short: 'Ap' },
    ],
  },
  {
    name: 'Medications',
    cls: 'cat-meds',
    items: [
      { type: 'MedicationRequest', short: 'Mr' },
    ],
  },
];

// Flat (type → info) lookup, derived once at module load. Used everywhere a
// component needs the badge tone or shorthand for a given resource type.
export const TYPE_INFO: Record<string, TypeInfo> = {};
for (const g of PALETTE_GROUPS) {
  for (const it of g.items) {
    TYPE_INFO[it.type] = { ...it, cls: g.cls, group: g.name };
  }
}

// Pre-fire scenario tuned to exercise the seeded rules:
//   * HbA1c at 7.2% (LOINC 4548-4)        — DM2 rule fires
//   * 2 SBP readings 152 / 148 (LOINC 8480-6) ~month apart — HTN + comorbid rule fire
//   * Fasting glucose 142 (LOINC 1558-6)  — non-matching obs (control)
//   * NO existing DM2/HTN Conditions      — NACs not violated
//   * Existing fulfilled ophthalmology Appointment within last year —
//     blocks the ophthalmology referral rule (negative test)
// Fields use the FHIR-shaped split (codeSystem / codeValue / codeDisplay)
// matching `clinical_state_multi.jl`'s Observation attributes.
export const INITIAL_NODES: Node[] = [
  {
    id: 'pat-1', type: 'Patient', x: 600, y: 200,
    fields: { name: 'Sample Patient', gender: '', birthDate: '', identifier: 'MRN-0001' },
  },
  // Current visit — endocrinology follow-up where the high A1c and BPs
  // were recorded. SNOMED 394583002 = "Endocrinology" (clinical specialty).
  {
    id: 'enc-1', type: 'Encounter', x: 880, y: 200,
    fields: {
      codeSystem:  'http://snomed.info/sct',
      codeValue:   '394583002',
      codeDisplay: 'Endocrinology follow-up visit',
      status:      'finished',
      class:       'ambulatory',
      start:       '2026-04-22T10:00:00',
      end:         '2026-04-22T10:45:00',
    },
  },
  // HbA1c — triggers DM2 rule
  {
    id: 'obs-a1c', type: 'Observation', x: 280, y: 480,
    fields: {
      codeSystem:  'http://loinc.org',
      codeValue:   '4548-4',
      codeDisplay: 'Hemoglobin A1c',
      value:       '7.2', unit: '%',
      status:      'final', effective: '2026-04-22T10:30:00',
    },
  },
  // First SBP reading — triggers HTN rule
  {
    id: 'obs-sbp1', type: 'Observation', x: 540, y: 480,
    fields: {
      codeSystem:  'http://loinc.org',
      codeValue:   '8480-6',
      codeDisplay: 'Systolic blood pressure',
      value:       '152', unit: 'mmHg',
      status:      'final', effective: '2026-04-22T10:30:00',
    },
  },
  // Second SBP reading ~5 weeks earlier — comorbid rule wants two readings
  {
    id: 'obs-sbp2', type: 'Observation', x: 800, y: 480,
    fields: {
      codeSystem:  'http://loinc.org',
      codeValue:   '8480-6',
      codeDisplay: 'Systolic blood pressure',
      value:       '148', unit: 'mmHg',
      status:      'final', effective: '2026-03-15T09:00:00',
    },
  },
  // Fasting glucose — non-matching control
  {
    id: 'obs-fbg', type: 'Observation', x: 1060, y: 480,
    fields: {
      codeSystem:  'http://loinc.org',
      codeValue:   '1558-6',
      codeDisplay: 'Fasting plasma glucose',
      value:       '142', unit: 'mg/dL',
      status:      'final', effective: '2026-04-22T10:30:00',
    },
  },
  // Past finished Encounter — the actual ophthalmology visit that
  // blocks the referral rule. Date 2026-02-10 is within "past 1 year"
  // relative to 2026-05-08. SNOMED 408451005 = "Ophthalmology" specialty.
  // The rule's NAC looks for a finished ophth Encounter (not Appointment)
  // because Encounter represents the visit that actually happened.
  {
    id: 'enc-ophth-past', type: 'Encounter', x: 280, y: 200,
    fields: {
      codeSystem:  'http://snomed.info/sct',
      codeValue:   '408451005',
      codeDisplay: 'Ophthalmology consultation',
      status:      'finished',
      class:       'ambulatory',
      start:       '2026-02-10T14:00:00',
      end:         '2026-02-10T14:30:00',
    },
  },
];

export const INITIAL_EDGES: Edge[] = [
  { from: 'enc-1',     to: 'pat-1', label: 'subject' },
  { from: 'obs-a1c',   to: 'pat-1', label: 'subject' },
  { from: 'obs-a1c',   to: 'enc-1', label: 'encounter' },
  { from: 'obs-sbp1',  to: 'pat-1', label: 'subject' },
  { from: 'obs-sbp1',  to: 'enc-1', label: 'encounter' },
  { from: 'obs-sbp2',  to: 'pat-1', label: 'subject' },
  { from: 'obs-fbg',   to: 'pat-1', label: 'subject' },
  { from: 'enc-ophth-past', to: 'pat-1', label: 'subject' },
];

// ============================================================
// Rule-mode seed: the DM2-add rule (also available pre-built in sampleRules.ts).
//
//   L = a single HbA1c Observation (LOINC 4548-4)
//   K = same (preserved across rewrite)
//   R = preserves the obs, adds a ClinicalImpression and a DM2 Condition
//   N1 = "an HbA1c obs AND any DM2 Condition coexist" — forbid that
//   Predicate: Observation.valueQuantity.value >= 6.5
//
// In the UI this is three nodes:
//   * obs-hba1c   tagged L+K+R+N1   (preserved everywhere, including NAC)
//   * cond-dm2    tagged R+N1        (created by the rule, forbidden in NAC)
//   * assm-dm2    tagged R           (created by the rule)
//
// ${var} placeholders represent FHIR template-variable extensions
// (per docs/fhir_pipeline_design.md). They round-trip to AttrVar(n) on the
// Julia side. The shared "${time}" across both new resources coordinates
// AttrVar(1) — same effective time on the matched obs and the new
// condition/impression.
// ============================================================
export const INITIAL_RULE_NODES: Node[] = [
  {
    id: 'obs-hba1c',
    type: 'Observation',
    x: 300, y: 420,
    legs: ['L', 'K', 'R', 'N1'],
    fields: {
      codeSystem:  'http://loinc.org',
      codeValue:   '4548-4',
      codeDisplay: 'Hemoglobin A1c',
      value:       '${hba1c-magnitude}',
      unit:        '%',
      status:      'final',
      effective:   '${time}',
    },
  },
  {
    id: 'cond-dm2',
    type: 'Condition',
    x: 700, y: 420,
    legs: ['R', 'N1'],
    fields: {
      codeSystem:     'http://snomed.info/sct',
      codeValue:      '44054006',
      codeDisplay:    'Type 2 diabetes mellitus',
      clinicalStatus: 'active',
      recordedDate:   '${time}',
    },
  },
  {
    id: 'assm-dm2',
    type: 'ClinicalImpression',
    x: 500, y: 220,
    legs: ['R'],
    fields: {
      status: 'completed',
      date:   '${time}',
    },
  },
];

export const INITIAL_RULE_EDGES: Edge[] = [
  // ClinicalImpression.finding[].itemReference → Observation
  { from: 'assm-dm2', to: 'obs-hba1c', label: 'finding' },
  // ClinicalImpression.problem[].reference → Condition
  { from: 'assm-dm2', to: 'cond-dm2',  label: 'problem' },
];

export const INITIAL_RULE_PREDICATES: Predicate[] = [
  {
    id: 'pred-hba1c-65',
    target: 'obs-hba1c',
    fhirpath: "Observation.code.coding.where(system='http://loinc.org' and code='4548-4').exists() and Observation.valueQuantity.value >= 6.5",
    label: 'HbA1c ≥ 6.5',
    // Structured form so the seed predicate opens in builder mode by default.
    attribute: 'valueQuantity.value',
    operator: '>=',
    value: '6.5',
  },
];
