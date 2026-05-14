// Rule templates — generic starting patterns, not specific clinical
// scenarios. Each template captures a *shape* of rule (add diagnosis,
// add medication, resolve diagnosis, add assessment) with placeholder
// codes and values the user fills in for their use case.
//
// Templates use the FHIR-shaped schema for the three round-trippable
// types (Observation, Condition, ClinicalImpression) plus one or two
// shapes that aren't engine-handled yet (MedicationRequest, Procedure)
// — those are useful for authoring even though firing them through the
// Julia engine is a no-op.
//
// Convention: ${field} placeholders mark slots the user customizes.
// codeSystem and codeValue are left empty (literal blanks) because those
// are typically the literal trigger the user wants concrete; everything
// else defaults to a template variable so the rule pattern is general.

import type { Edge, Node, Predicate } from '../lib/types';

export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  nodes: Node[];
  edges: Edge[];
  predicates: Predicate[];
  defaultSelectedId: string;
}

// ============================================================
// 1. Add diagnosis from observation
//    L  = Observation (preserved)
//    R  = + Condition + ClinicalImpression linking them
//    N1 = the diagnosis Condition (forbidden as pre-existing).
//         Only the "extra" forbidden-context node carries the N1 tag;
//         L nodes get auto-extended into every meaningful NAC at export
//         (see expandLegsForNACs in ruleBundle.ts), so we no longer tag
//         the L pattern explicitly.
//    Predicate: Observation.valueQuantity.value OP threshold
// ============================================================
const addDiagnosis: Pick<RuleTemplate, 'nodes' | 'edges' | 'predicates' | 'defaultSelectedId'> = {
  nodes: [
    {
      id: 'obs',
      type: 'Observation',
      x: 280, y: 420,
      legs: ['L', 'K', 'R'],
      fields: {
        codeSystem:  '',
        codeValue:   '',
        codeDisplay: '${display}',
        value:       '${value}',
        unit:        '${unit}',
        status:      '${status}',
        effective:   '${time}',
      },
    },
    {
      id: 'diagnosis',
      type: 'Condition',
      x: 720, y: 420,
      legs: ['R', 'N1'],
      fields: {
        codeSystem:     '',
        codeValue:      '',
        codeDisplay:    '${diagnosisDisplay}',
        clinicalStatus: 'active',
        recordedDate:   '${now}',
      },
    },
    {
      id: 'assessment',
      type: 'ClinicalImpression',
      x: 500, y: 220,
      legs: ['R'],
      fields: { status: 'completed', date: '${now}' },
    },
  ],
  edges: [
    { from: 'assessment', to: 'obs',       label: 'finding' },
    { from: 'assessment', to: 'diagnosis', label: 'problem' },
  ],
  predicates: [
    {
      id: 'pred-threshold',
      target: 'obs',
      label: 'Value threshold',
      attribute: 'valueQuantity.value',
      operator: '>=',
      value: '0',
      // Generated lazily — UI re-derives once the user fills in obs code.
      fhirpath: 'Observation.valueQuantity.value >= 0',
    },
  ],
  defaultSelectedId: 'obs',
};

// ============================================================
// 2. Add medication for an existing condition
//    L  = Condition (preserved)
//    R  = + MedicationRequest tied to that Condition
//    N1 = the same MedicationRequest (forbidden as pre-existing). Only
//         the new MedicationRequest carries the N1 tag — the L pattern
//         gets auto-extended at export time.
//    Note: MedicationRequest IS in the engine schema now; firing this
//    template lands a real MedicationRequest in patient state.
// ============================================================
const addMedication: Pick<RuleTemplate, 'nodes' | 'edges' | 'predicates' | 'defaultSelectedId'> = {
  nodes: [
    {
      id: 'cond',
      type: 'Condition',
      x: 280, y: 380,
      legs: ['L', 'K', 'R'],
      fields: {
        codeSystem:     '',
        codeValue:      '',
        codeDisplay:    '${display}',
        clinicalStatus: 'active',
        recordedDate:   '${time}',
      },
    },
    {
      id: 'medreq',
      type: 'MedicationRequest',
      x: 720, y: 380,
      legs: ['R', 'N1'],
      fields: {
        medication: '${medication}',
        status:     'active',
        intent:     'order',
        dosage:     '${dosage}',
      },
    },
  ],
  edges: [],
  predicates: [],
  defaultSelectedId: 'cond',
};

// ============================================================
// (Removed: "Add procedure recommendation" — engine has no Procedure Ob
// yet. Re-add once clinical_state_multi.jl ships one.)
// ============================================================

// ============================================================
// Resolve diagnosis
//    L  = Condition + Observation that disagrees with the diagnosis
//    K  = Observation (preserved)
//    R  = Observation only — the Condition is DELETED by L \ K
//    Predicate: observation back in normal range
//    Note: deletes the Condition. If the Condition is referenced by any
//    Diagnosis junction, the engine will refuse this rule (DPO dangling
//    edge condition). Keep for simple resolutions.
// ============================================================
const resolveDiagnosis: Pick<RuleTemplate, 'nodes' | 'edges' | 'predicates' | 'defaultSelectedId'> = {
  nodes: [
    {
      id: 'obs',
      type: 'Observation',
      x: 280, y: 420,
      legs: ['L', 'K', 'R'],
      fields: {
        codeSystem:  '',
        codeValue:   '',
        codeDisplay: '${display}',
        value:       '${value}',
        unit:        '${unit}',
        status:      '${status}',
        effective:   '${time}',
      },
    },
    {
      id: 'cond',
      type: 'Condition',
      x: 720, y: 420,
      // L only — gets deleted on rewrite (not preserved into K or R).
      legs: ['L'],
      fields: {
        codeSystem:     '',
        codeValue:      '',
        codeDisplay:    '${diagnosisDisplay}',
        clinicalStatus: 'active',
        recordedDate:   '${condTime}',
      },
    },
  ],
  edges: [],
  predicates: [
    {
      id: 'pred-normal',
      target: 'obs',
      label: 'Value back in normal range',
      attribute: 'valueQuantity.value',
      operator: '<',
      value: '0',
      fhirpath: 'Observation.valueQuantity.value < 0',
    },
  ],
  defaultSelectedId: 'cond',
};

// ============================================================
// 5. Add assessment for existing condition
//    L  = Condition (preserved)
//    R  = + ClinicalImpression with Diagnosis link
// ============================================================
const addAssessment: Pick<RuleTemplate, 'nodes' | 'edges' | 'predicates' | 'defaultSelectedId'> = {
  nodes: [
    {
      id: 'cond',
      type: 'Condition',
      x: 280, y: 380,
      legs: ['L', 'K', 'R'],
      fields: {
        codeSystem:     '',
        codeValue:      '',
        codeDisplay:    '${display}',
        clinicalStatus: 'active',
        recordedDate:   '${time}',
      },
    },
    {
      id: 'assessment',
      type: 'ClinicalImpression',
      x: 720, y: 380,
      legs: ['R'],
      fields: { status: 'completed', date: '${now}' },
    },
  ],
  edges: [
    { from: 'assessment', to: 'cond', label: 'problem' },
  ],
  predicates: [],
  defaultSelectedId: 'cond',
};

// ============================================================
// 6. Refer to specialty
//    L  = Condition (preserved) — the diagnosis motivating the referral
//    R  = + Appointment (proposed referral)
//    N1 = past Encounter with the same specialty code (any prior visit
//         to that specialty blocks a duplicate referral)
//    Mirrors the shipped "ophthalmology referral for diabetic
//    retinopathy" rule, generalized so the user fills in the specialty
//    + condition codes for any specialty referral.
// ============================================================
const referToSpecialty: Pick<RuleTemplate, 'nodes' | 'edges' | 'predicates' | 'defaultSelectedId'> = {
  nodes: [
    {
      id: 'cond',
      type: 'Condition',
      x: 240, y: 380,
      legs: ['L', 'K', 'R'],
      fields: {
        codeSystem:     '',
        codeValue:      '',
        codeDisplay:    '${display}',
        clinicalStatus: '${status}',
        recordedDate:   '${time}',
      },
    },
    {
      id: 'enc-prev',
      type: 'Encounter',
      x: 240, y: 180,
      legs: ['N1'],
      fields: {
        // The user fills in the specialty code (e.g. SNOMED 408451005
        // Ophthalmology). Status is literal "finished" — only completed
        // visits count as "we've already been there."
        codeSystem:  '',
        codeValue:   '',
        codeDisplay: '${prevDisplay}',
        status:      'finished',
        class:       '${prevClass}',
        start:       '${prevStart}',
        end:         '${prevEnd}',
      },
    },
    {
      id: 'appt-new',
      type: 'Appointment',
      x: 720, y: 380,
      legs: ['R'],
      fields: {
        codeSystem:  '',
        codeValue:   '',
        codeDisplay: '${referralDisplay}',
        status:      'proposed',
        start:       '${now}',
        end:         '${now}',
      },
    },
  ],
  edges: [
    { from: 'appt-new', to: 'cond', label: 'basedOn' },
  ],
  predicates: [],
  defaultSelectedId: 'cond',
};

// ============================================================
// (Removed: "Re-screen if overdue" — depended on a Procedure Ob the
// engine doesn't ship yet. Re-add when the schema grows one. The
// referToSpecialty template uses Encounter for the same prior-event
// pattern and can serve as the model.)
// ============================================================

// ============================================================
// Drug-disease contraindication
//    L  = Condition (the contraindicating diagnosis, e.g. CKD)
//         AND existing MedicationRequest of the contraindicated drug
//    R  = MedicationRequest deleted (status changed via the rewrite —
//         simplest model is L\K = the medreq, so it gets removed)
//    Note: the canonical workflow is to flag rather than remove. The
//    template authors a removal as the structural change — the user
//    can edit R-side to "stopped" status if their app prefers a flag.
// ============================================================
const drugDiseaseContraindication: Pick<RuleTemplate, 'nodes' | 'edges' | 'predicates' | 'defaultSelectedId'> = {
  nodes: [
    {
      id: 'cond',
      type: 'Condition',
      x: 240, y: 380,
      legs: ['L', 'K', 'R'],
      fields: {
        codeSystem:     '',
        codeValue:      '',
        codeDisplay:    '${condDisplay}',
        clinicalStatus: 'active',
        recordedDate:   '${condTime}',
      },
    },
    {
      id: 'medreq',
      type: 'MedicationRequest',
      x: 720, y: 380,
      // L only — the rewrite removes this medreq. To FLAG instead of
      // remove, change legs to ['L','K','R'] and set status to 'stopped'
      // on the R-side copy.
      legs: ['L'],
      fields: {
        medication: '${contraindicatedMed}',
        status:     'active',
        intent:     'order',
        dosage:     '${dosage}',
      },
    },
  ],
  edges: [],
  predicates: [],
  defaultSelectedId: 'medreq',
};

// ============================================================
// 9. Empty starter — single Observation in L,K,R; user builds from here.
// ============================================================
const empty: Pick<RuleTemplate, 'nodes' | 'edges' | 'predicates' | 'defaultSelectedId'> = {
  nodes: [{
    id: 'obs',
    type: 'Observation',
    x: 500, y: 400,
    legs: ['L', 'K', 'R'],
    fields: {
      codeSystem:  '',
      codeValue:   '',
      codeDisplay: '${display}',
      value:       '${value}',
      unit:        '${unit}',
      status:      '${status}',
      effective:   '${time}',
    },
  }],
  edges: [],
  predicates: [],
  defaultSelectedId: 'obs',
};

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: 'add-diagnosis',
    name: 'Add diagnosis',
    description: 'Observation crosses threshold → add Condition + ClinicalImpression. Fill in obs/condition codes + threshold.',
    ...addDiagnosis,
  },
  {
    id: 'add-medication',
    name: 'Add medication',
    description: 'Condition exists → add MedicationRequest. Fill in condition code + medication details.',
    ...addMedication,
  },
  {
    id: 'resolve-diagnosis',
    name: 'Resolve diagnosis',
    description: 'Observation in normal range alongside Condition → delete the Condition. Fill in codes + threshold.',
    ...resolveDiagnosis,
  },
  {
    id: 'add-assessment',
    name: 'Add assessment',
    description: 'Condition exists → add ClinicalImpression linked to it. Fill in condition code.',
    ...addAssessment,
  },
  {
    id: 'refer-to-specialty',
    name: 'Refer to specialty',
    description: 'Condition exists AND no recent specialty Encounter → propose a referral Appointment. Fill in condition code + specialty code.',
    ...referToSpecialty,
  },
  {
    id: 'drug-disease-contraindication',
    name: 'Drug-disease contraindication',
    description: 'Condition + active MedicationRequest of a contraindicated drug → remove (or flag) the order. Fill in condition + medication.',
    ...drugDiseaseContraindication,
  },
  {
    id: 'empty',
    name: 'Empty starter rule',
    description: 'Single Observation in L/K/R with template-variable fields. Build a custom rule from scratch.',
    ...empty,
  },
];
