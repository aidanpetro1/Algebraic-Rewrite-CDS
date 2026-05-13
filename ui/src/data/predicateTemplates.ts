// Curated predicate templates — high-level clinical predicates the
// rule author picks instead of writing raw FHIRPath. Each template
// captures a *kind* of clinical condition ("recent", "critical lab",
// "age over") and renders to a structured triple (or raw FHIRPath
// when the engine doesn't have a first-class operator yet).
//
// The detail panel offers these as the primary affordance; the
// existing structured-triple form remains available as "Custom" for
// expressions outside the templated set.

import type { Predicate } from '../lib/types';

export type PredicateTemplateKind =
  | 'critical-high'
  | 'critical-low'
  | 'abnormal-high'
  | 'abnormal-low'
  | 'within-last'
  | 'older-than'
  | 'status-equals'
  | 'value-threshold';

export interface PredicateTemplate {
  id: PredicateTemplateKind;
  label: string;
  description: string;
  // Resource types this template applies to (for filtering the picker
  // when authoring a predicate against a specific node).
  appliesTo: string[];
  // Default fill — produces a partially-bound Predicate. The user
  // tweaks the threshold / value before the template is "complete".
  build: (target: string) => Partial<Predicate>;
}

// ---------- Lab thresholds ----------
// These compile to the existing "Observation.code...exists() and value
// OP threshold" shape so the Julia engine's regex parser picks them up.

export const PREDICATE_TEMPLATES: PredicateTemplate[] = [
  {
    id: 'critical-high',
    label: 'Critical high',
    description: 'Lab value exceeds a critical threshold (e.g. potassium > 6.0).',
    appliesTo: ['Observation'],
    build: (target) => ({
      target,
      label: 'Critical high',
      attribute: 'valueQuantity.value',
      operator:  '>=',
      value:     '0',
    }),
  },
  {
    id: 'critical-low',
    label: 'Critical low',
    description: 'Lab value falls below a critical threshold (e.g. glucose < 50).',
    appliesTo: ['Observation'],
    build: (target) => ({
      target,
      label: 'Critical low',
      attribute: 'valueQuantity.value',
      operator:  '<=',
      value:     '0',
    }),
  },
  {
    id: 'abnormal-high',
    label: 'Abnormal high',
    description: 'Lab is above the normal reference range (e.g. SBP ≥ 140).',
    appliesTo: ['Observation'],
    build: (target) => ({
      target,
      label: 'Abnormal high',
      attribute: 'valueQuantity.value',
      operator:  '>=',
      value:     '0',
    }),
  },
  {
    id: 'abnormal-low',
    label: 'Abnormal low',
    description: 'Lab is below the normal reference range.',
    appliesTo: ['Observation'],
    build: (target) => ({
      target,
      label: 'Abnormal low',
      attribute: 'valueQuantity.value',
      operator:  '<=',
      value:     '0',
    }),
  },

  // ---------- Generic threshold ----------
  {
    id: 'value-threshold',
    label: 'Value threshold',
    description: 'Generic numeric comparison — pick the operator and threshold yourself.',
    appliesTo: ['Observation'],
    build: (target) => ({
      target,
      label: 'Value threshold',
      attribute: 'valueQuantity.value',
      operator:  '>=',
      value:     '0',
    }),
  },

  // ---------- Status checks ----------
  {
    id: 'status-equals',
    label: 'Status is …',
    description: 'Resource status equals a chosen value (e.g. Condition active, Encounter finished).',
    appliesTo: ['Observation', 'Condition', 'ClinicalImpression', 'MedicationRequest', 'Appointment', 'Encounter'],
    build: (target) => ({
      target,
      label: 'Status is …',
      attribute: 'status',
      operator:  '==',
      value:     '',
    }),
  },

  // ---------- Temporal ----------
  // These don't yet round-trip through the Julia engine's regex parser
  // (recency lives in the phase-3 FHIRPath subset interpreter), so the
  // engine treats them as no-op stubs at fire time. Authoring still
  // works and the FHIRPath emitted is canonical.
  {
    id: 'within-last',
    label: 'Within the last …',
    description: 'Resource date falls within a recent window (days). Engine support is stub-only until the FHIRPath subset interpreter ships.',
    appliesTo: ['Observation', 'Condition', 'Encounter', 'Appointment'],
    build: (target) => ({
      target,
      label: 'Within the last 365 days',
      // Raw FHIRPath because the engine's structured form doesn't yet
      // support `now() - X 'days'`. Keeping the structure-aware fields
      // empty signals the editor to render a free-text input.
      attribute: '',
      operator:  '',
      value:     '',
      fhirpath:  "Encounter.period.start >= now() - 365 'days'",
    }),
  },
  {
    id: 'older-than',
    label: 'Older than …',
    description: 'Resource date is older than a window (days). Engine stub for now.',
    appliesTo: ['Observation', 'Condition', 'Encounter', 'Appointment'],
    build: (target) => ({
      target,
      label: 'Older than 90 days',
      attribute: '',
      operator:  '',
      value:     '',
      fhirpath:  "recordedDate <= now() - 90 'days'",
    }),
  },
];

// Pick templates appropriate for a given resource type.
export function templatesFor(resourceType: string | undefined): PredicateTemplate[] {
  if (!resourceType) return [];
  return PREDICATE_TEMPLATES.filter((t) => t.appliesTo.includes(resourceType));
}
