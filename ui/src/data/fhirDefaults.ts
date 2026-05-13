// Default field templates for newly-created FHIR resources.
//
// When the user drops a resource type onto the canvas, the new node should
// already have the fields it would carry on the wire — empty strings where
// the user needs to fill in (`code`, `value`, dates), sensible defaults
// where there's a canonical answer (`status: "final"` on Observations,
// `intent: "order"` on MedicationRequests, etc.).
//
// These templates are intentionally aligned with what fhir_serialize.jl
// emits and fhir_parse.jl consumes for the three round-trippable types
// (Observation, Condition, ClinicalImpression) — so a node authored in the
// UI from the default template can be exported to a Bundle and parsed by
// the Julia side without manual fixup.
//
// For the other palette types (Patient, Encounter, etc.), the templates
// match the seed scenario in palette.ts so the visual feel is consistent.

import type { FieldMap } from '../lib/types';

// One template per resource type. Lookup miss falls back to `{ id }` only.
const DEFAULTS: Record<string, FieldMap> = {
  // Round-trippable through the Julia FHIR pipeline (FHIR-shaped schema).
  Observation: {
    codeSystem:  '',
    codeValue:   '',
    codeDisplay: '',
    value:       '',
    unit:        '',
    status:      'final',
    effective:   '',
  },
  Condition: {
    codeSystem:     '',
    codeValue:      '',
    codeDisplay:    '',
    clinicalStatus: 'active',
    recordedDate:   '',
  },
  ClinicalImpression: {
    display: '',
    status: 'completed',
    date: '',
  },

  // Patient is a UI passthrough — the engine doesn't have an Ob for it,
  // but every clinical resource auto-wires a subject → Patient edge after
  // fire (see App.tsx mergePostFire), so authoring one is meaningful.
  Patient: {
    name: '',
    gender: '',
    birthDate: '',
    identifier: '',
  },

  Encounter: {
    codeSystem:  '',
    codeValue:   '',
    codeDisplay: '',
    status:      'finished',
    class:       'ambulatory',
    start:       '',
    end:         '',
  },
  Appointment: {
    codeSystem:  '',
    codeValue:   '',
    codeDisplay: '',
    status:      'booked',
    start:       '',
    end:         '',
  },

  MedicationRequest: {
    codeSystem:  '',
    codeValue:   '',
    codeDisplay: '',
    status:      'active',
    intent:      'order',
    dosage:      '',
  },
};

// Build the default field set for a freshly-created node of `type`. The
// node's id lives on `node.id` (edited via DetailPanel's Identity input)
// and is intentionally NOT duplicated into `fields` — having both was
// confusing because the same value showed up in two places. _id is unused
// here so the addNode caller doesn't need to special-case it either.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function defaultFieldsFor(type: string, _id: string): FieldMap {
  return DEFAULTS[type] ? { ...DEFAULTS[type] } : {};
}

// Field display order is stable across renders by virtue of `Object` insertion
// order. Templates above are written in the order we want fields to appear —
// `id` first, then identity (code/name), value, status, time. Detail panel
// `slice(0, 4)` gives a consistent "quick fields" view because of this.
