// ruleBundle.ts — convert between the UI's graph model and FHIR R4 Bundles.
//
// Two flavors of bundle:
//   * "patient bundle" — same shape as fhir_serialize.jl emits: a flat
//     collection of Observation/Condition/ClinicalImpression entries with
//     references via fullUrl. No leg tags, no manifest.
//   * "rule bundle"    — entries carry meta.tag with system
//     `http://algebraic-cds.org/rule-leg` and codes L|K|R|N1|N2|… ;
//     fields can hold template-variable extensions (FHIR primitive _field
//     pattern) as the analog of Catlab AttrVar; predicates live in a
//     single Basic resource manifest entry. Per docs/fhir_pipeline_design.md.
//
// The buildBundle entry point picks which flavor based on `mode`.
//
// Layout coordinates round-trip via a custom extension on each resource:
//   Resource.extension[url=...layout-coords].extension[url=x|y].valueDecimal
// Resolves the design doc's open question about where to stash coords.

import type { Edge, Node, Predicate } from './types';
import { RULE_LEG_SYSTEM } from './legs';
import { parseFhirpath } from './fhirpath';

// Base URL for our extension/CodeSystem URLs. Stable so a rule Bundle is
// recognizable across calls and across the UI/Julia split.
const NS = 'http://algebraic-cds.org';
const URL_TEMPLATE_VAR  = `${NS}/StructureDefinition/template-variable`;
const URL_LAYOUT_COORDS = `${NS}/StructureDefinition/layout-coords`;
const URL_PREDICATE     = `${NS}/StructureDefinition/predicate`;
const RULE_MANIFEST_CODE = `${NS}/CodeSystem/rule-manifest`;

// fullUrl for a UI node. We use `urn:uuid:` as the URN scheme and the node
// id as the lookup key. Strictly speaking urn:uuid: requires a real UUID,
// but the spec is widely used loosely and FHIR servers don't validate the
// content past the prefix. Keeps the wire format diffable + stable.
const fullUrlFor = (id: string): string => `urn:uuid:${id}`;

// Auto-extend each NAC to include the L pattern. The categorical
// requirement is that the morphism `n: L → Ni` exists, which means every
// L-tagged node must also appear in Ni. Forcing the user to tag L nodes
// in every NAC is a UX wart, so the UI lets them tag only the *extra*
// forbidden context. At export time we splice the L tags through:
// for every NAC index `Ni` in use, every L-tagged node gets `Ni` added.
function expandLegsForNACs(nodes: Node[]): Node[] {
  const nacs = new Set<string>();
  for (const n of nodes) {
    for (const leg of n.legs ?? []) {
      if (leg.startsWith('N')) nacs.add(leg);
    }
  }
  if (nacs.size === 0) return nodes;
  return nodes.map((n) => {
    const legs = n.legs ?? [];
    if (!legs.includes('L')) return n;
    // Add any NAC tags that aren't already present.
    const expanded = [...legs];
    for (const nac of nacs) {
      if (!expanded.includes(nac)) expanded.push(nac);
    }
    return { ...n, legs: expanded };
  });
}

// Detect "${varname}" template placeholder. Whole-string match only —
// "${a}-suffix" isn't a valid placeholder, just a literal.
function templateName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.match(/^\$\{([^}]+)\}$/);
  return m ? m[1] : null;
}

// FHIR primitive-extension form. When a primitive slot carries a template
// variable, emit `{ "_field": { "extension": [...] } }` *without* the field
// itself, per the FHIR spec on primitive-type extensions. Plain literals
// emit `{ "field": value }` directly.
//
// Empty literal strings are dropped entirely — emitting `{ field: "" }` for
// a date or numeric field downstream causes parse errors (Julia DateTime("")
// throws, Float64("") throws), and FHIR R4 treats most of these slots as
// optional anyway. The Julia parsers fall back to sentinels when a field
// is missing, so dropping is safe.
function primitiveOrTemplate(field: string, raw: string,
                              coerce: (s: string) => unknown): Record<string, unknown> {
  const v = templateName(raw);
  if (v !== null) {
    return {
      [`_${field}`]: { extension: [{ url: URL_TEMPLATE_VAR, valueId: v }] },
    };
  }
  if (raw === '') return {};
  return { [field]: coerce(raw) };
}

// Number coercion — empty/non-numeric strings stay as strings (the FHIR
// validator will flag them). We don't want to silently emit 0 when the
// user typed garbage; round-trip must surface the input.
const asNumber = (s: string): unknown => {
  if (s === '') return s;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
};
const asString = (s: string): unknown => s;

// CodeableConcept builder for the (system, code, display) trio. Empty
// values are dropped from the coding so a partially-filled card doesn't
// emit `{ system: "" }` noise. Each slot is template-aware: a value of
// the form "${name}" emits the FHIR primitive-extension form
// (`_field: { extension: [{ url: TEMPLATE_VAR, valueId: name }] }`)
// instead of the literal. This is critical for NAC patterns whose
// codeDisplay is meant to be "any prior diagnosis" — without templating,
// the engine sees the literal "${existingDisplay}" and the homomorphism
// fails because no real Condition has that as its codeDisplay.
function buildCodeableConcept(system: string, code: string, display: string): Record<string, unknown> | undefined {
  if (!system && !code && !display) return undefined;
  const coding: Record<string, unknown> = {};
  Object.assign(coding, primitiveOrTemplate('system',  system,  asString));
  Object.assign(coding, primitiveOrTemplate('code',    code,    asString));
  Object.assign(coding, primitiveOrTemplate('display', display, asString));
  return { coding: [coding] };
}

// Display fields are presentation labels — useful for humans, but a
// frequent footgun in NAC patterns where a literal "Hypertensive
// disorder" would forbid only that exact string while we want to forbid
// any pre-existing HTN. So we auto-templatize literal display values
// into throwaway AttrVars that the engine treats as free.
//
// IMPORTANT: only fires for nodes that are *preserved* across the
// rewrite (in K, equivalently L+K+R) or are pure matching patterns
// (NAC-only, no R). Nodes in R but NOT in K — i.e. R-only material the
// rewrite materializes — must keep literal values. Templating an
// R-only attribute creates an AttrVar in R with no source binding in
// K, and Catlab refuses to fire the rule ("Must set AttrVar value for
// newly introduced attribute via `exprs`").
//
// User-authored ${var} stays as-is — auto-templating only fires on
// plain literals. Empty strings stay empty.
function isMatchingLeg(legs: string[] | undefined): boolean {
  if (!legs) return false;
  const hasR = legs.includes('R');
  const hasK = legs.includes('K');
  const hasL = legs.includes('L');
  // R-only (no K) → don't templatize: R needs concrete values to
  // materialize. Also don't templatize R+NAC mixes — same problem.
  if (hasR && !hasK) return false;
  // Otherwise we're in K (preserved through rewrite — AttrVar binding
  // propagates from L's match through K to R) or in NAC-only mode
  // (pure matching, free attrs are correct).
  return hasL || hasK || legs.some((l) => l.startsWith('N'));
}
function autoFreeDisplay(field: string, value: string, n: Node): string {
  if (!isMatchingLeg(n.legs)) return value;
  if (templateName(value) !== null) return value;   // already templated
  if (value === '') return value;                    // nothing to free
  // Variable name unique to (node, field) so two nodes can't accidentally
  // share an AttrVar slot. Underscore prefix avoids collisions with user
  // names like ${existingDisplay}.
  const safeId = n.id.replace(/[^a-zA-Z0-9]/g, '_');
  return `\${_auto_${safeId}_${field}}`;
}

// Outgoing edges from a source node, applied to the resource being built
// as FHIR reference fields. Edge label becomes the field name, target
// becomes a Reference. Junction labels (`finding`, `problem`) are
// skipped here because they're handled in buildClinicalImpression with
// their proper backbone-element shape.
//
// FHIR cardinalities differ per field — `subject` and `encounter` are
// 0..1 (single Reference), but `reasonReference`, `basedOn`,
// `hasMember`, `derivedFrom`, `partOf`, `performer`, `participant`,
// `recorder`, `asserter`, `note` etc. are 0..* (Reference[]). When in
// doubt we prefer arrays so a downstream parser doesn't have to
// special-case "one-element collapsed to object".
const JUNCTION_LABELS = new Set(['finding', 'problem']);
const ARRAY_VALUED_REF_FIELDS = new Set([
  'reasonReference', 'basedOn', 'hasMember', 'derivedFrom', 'partOf',
  'performer', 'participant', 'note', 'addresses',
  'supportingInfo', 'result',
]);
function applyOutgoingRefs(out: Record<string, unknown>, n: Node, edges: Edge[]): void {
  const grouped = new Map<string, string[]>();
  for (const e of edges) {
    if (e.from !== n.id) continue;
    if (JUNCTION_LABELS.has(e.label)) continue;
    if (!e.label) continue;
    const list = grouped.get(e.label) ?? [];
    list.push(fullUrlFor(e.to));
    grouped.set(e.label, list);
  }
  for (const [label, refs] of grouped) {
    const arrayValued = ARRAY_VALUED_REF_FIELDS.has(label) || refs.length > 1;
    if (arrayValued) {
      // Always-array field, e.g. Observation.performer or
      // MedicationRequest.reasonReference. Emit as Reference[].
      out[label] = refs.map((r) => ({ reference: r }));
    } else {
      // Single-cardinality field, e.g. Observation.subject. Emit as a
      // single Reference object.
      out[label] = { reference: refs[0] };
    }
  }
}

// Per-resource builders. Each takes the node + outgoing edges (for
// junctions) and returns the FHIR resource body. Template variables in
// any primitive slot are handled by primitiveOrTemplate.
function buildObservation(n: Node, edges: Edge[]): Record<string, unknown> {
  const f = n.fields;
  const out: Record<string, unknown> = { resourceType: 'Observation' };

  // status (string)
  Object.assign(out, primitiveOrTemplate('status', f.status ?? '', asString));

  // code: (codeSystem, codeValue, codeDisplay) → CodeableConcept.
  // codeDisplay gets auto-freed in matching legs so a literal label
  // doesn't accidentally constrain L/N homomorphisms.
  const cc = buildCodeableConcept(
    f.codeSystem ?? '',
    f.codeValue ?? '',
    autoFreeDisplay('codeDisplay', f.codeDisplay ?? '', n));
  if (cc) out.code = cc;

  // valueQuantity = { value, unit }, with template-variable on either slot
  const vq: Record<string, unknown> = {};
  Object.assign(vq, primitiveOrTemplate('value', f.value ?? '', asNumber));
  Object.assign(vq, primitiveOrTemplate('unit',  f.unit  ?? '', asString));
  if (Object.keys(vq).length > 0) out.valueQuantity = vq;

  // effectiveDateTime
  Object.assign(out, primitiveOrTemplate('effectiveDateTime', f.effective ?? '', asString));

  // Outgoing edges (subject, encounter, performer, …) → reference fields.
  applyOutgoingRefs(out, n, edges);

  return out;
}

function buildCondition(n: Node, edges: Edge[]): Record<string, unknown> {
  const f = n.fields;
  const out: Record<string, unknown> = {
    resourceType: 'Condition',
    // Required by fhir_parse.jl to recognize this as a problem-list Condition.
    category: [{
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/condition-category',
        code:   'problem-list-item',
      }],
    }],
  };

  const cc = buildCodeableConcept(
    f.codeSystem ?? '',
    f.codeValue ?? '',
    autoFreeDisplay('codeDisplay', f.codeDisplay ?? '', n));
  if (cc) out.code = cc;

  // clinicalStatus is a CodeableConcept whose .coding[0].code is what
  // fhir_parse.jl reads. We only emit the code (no system) to match the
  // shape produced by fhir_serialize.jl.
  if (f.clinicalStatus) {
    const cs = templateName(f.clinicalStatus);
    if (cs !== null) {
      // template-variable status — emit as a {coding:[{_code: …}]}
      out.clinicalStatus = {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          _code:  { extension: [{ url: URL_TEMPLATE_VAR, valueId: cs }] },
        }],
      };
    } else {
      out.clinicalStatus = {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          code:   f.clinicalStatus,
        }],
      };
    }
  }

  Object.assign(out, primitiveOrTemplate('recordedDate', f.recordedDate ?? '', asString));

  // Outgoing edges (subject, encounter, asserter, …) → reference fields.
  applyOutgoingRefs(out, n, edges);

  return out;
}

function buildClinicalImpression(n: Node, edges: Edge[]): Record<string, unknown> {
  const f = n.fields;
  const out: Record<string, unknown> = { resourceType: 'ClinicalImpression' };

  Object.assign(out, primitiveOrTemplate('status', f.status ?? '', asString));
  Object.assign(out, primitiveOrTemplate('date',   f.date   ?? '', asString));

  // finding[] from outgoing "finding" edges; problem[] from "problem" edges.
  // Targets are referenced by fullUrl — the consuming parser resolves them
  // via the Bundle.entry index.
  const findings: Record<string, unknown>[] = [];
  const problems: Record<string, unknown>[] = [];
  for (const e of edges) {
    if (e.from !== n.id) continue;
    if (e.label === 'finding') {
      findings.push({ itemReference: { reference: fullUrlFor(e.to) } });
    } else if (e.label === 'problem') {
      problems.push({ reference: fullUrlFor(e.to) });
    }
  }
  out.finding = findings;
  out.problem = problems;

  // Other outgoing edges (subject, encounter, assessor, …) — finding and
  // problem are skipped inside applyOutgoingRefs by the JUNCTION_LABELS guard.
  applyOutgoingRefs(out, n, edges);

  return out;
}

// Generic builder for resource types we don't have first-class support
// for yet (Patient, Practitioner, Encounter, MedicationRequest, ...).
// Emits the type, copies fields into top-level keys verbatim, AND folds
// outgoing edges into reference fields the same way the typed builders
// do — so a Patient.subject or MedicationRequest.medication edge becomes
// a real FHIR Reference in the bundle JSON.
// Display-like fields per resource type that get auto-freed in matching
// legs (so NACs don't accidentally constrain on labels). codeDisplay
// for Observation/Condition is handled inside buildCodeableConcept via
// the per-type builders; this map is for top-level display-ish fields
// reached through buildGeneric (e.g. Appointment.display).
const AUTO_FREE_DISPLAY_FIELDS: Record<string, string[]> = {
  Appointment: ['display'],
  // MedicationRequest.medication intentionally omitted — the metformin
  // NAC matches against the medication string literally.
};

function buildGeneric(n: Node, edges: Edge[]): Record<string, unknown> {
  const out: Record<string, unknown> = { resourceType: n.type };
  const freeFields = new Set(AUTO_FREE_DISPLAY_FIELDS[n.type] ?? []);
  for (const [k, v] of Object.entries(n.fields)) {
    if (k === 'id') continue;   // id lives on fullUrl
    const value = freeFields.has(k) ? autoFreeDisplay(k, v, n) : v;
    Object.assign(out, primitiveOrTemplate(k, value, asString));
  }
  applyOutgoingRefs(out, n, edges);
  return out;
}

// MedicationRequest: medicationCodeableConcept.coding[0] holds the
// (system, code, display) triple — same shape as Observation/Condition.
// dosageInstruction[0].text holds the dosage string.
function buildMedicationRequest(n: Node, edges: Edge[]): Record<string, unknown> {
  const f = n.fields;
  const out: Record<string, unknown> = { resourceType: 'MedicationRequest' };

  Object.assign(out, primitiveOrTemplate('status', f.status ?? '', asString));
  Object.assign(out, primitiveOrTemplate('intent', f.intent ?? '', asString));

  const cc = buildCodeableConcept(
    f.codeSystem ?? '',
    f.codeValue ?? '',
    autoFreeDisplay('codeDisplay', f.codeDisplay ?? '', n));
  if (cc) out.medicationCodeableConcept = cc;

  // Dosage as dosageInstruction[0].text. Templated dosages survive the
  // primitiveOrTemplate path.
  if (f.dosage && f.dosage.trim()) {
    const dose: Record<string, unknown> = {};
    Object.assign(dose, primitiveOrTemplate('text', f.dosage, asString));
    if (Object.keys(dose).length > 0) out.dosageInstruction = [dose];
  }

  applyOutgoingRefs(out, n, edges);
  return out;
}

// Appointment: serviceType[0].coding[0] holds the (system, code, display)
// triple. codeDisplay gets auto-freed in matching legs so a literal
// label doesn't constrain L/N homomorphisms.
function buildAppointment(n: Node, edges: Edge[]): Record<string, unknown> {
  const f = n.fields;
  const out: Record<string, unknown> = { resourceType: 'Appointment' };

  Object.assign(out, primitiveOrTemplate('status', f.status ?? '', asString));
  Object.assign(out, primitiveOrTemplate('start',  f.start  ?? '', asString));
  Object.assign(out, primitiveOrTemplate('end',    f.end    ?? '', asString));

  const cc = buildCodeableConcept(
    f.codeSystem ?? '',
    f.codeValue ?? '',
    autoFreeDisplay('codeDisplay', f.codeDisplay ?? '', n));
  if (cc) out.serviceType = [cc];

  applyOutgoingRefs(out, n, edges);
  return out;
}

// Encounter: type[0].coding[0] holds the service-type triple, and the
// visit window is nested under `period`. Mirrors the FHIR R4 shape and
// matches what _build_encounter / _parse_encounter_entry expect on the
// Julia side.
function buildEncounter(n: Node, edges: Edge[]): Record<string, unknown> {
  const f = n.fields;
  const out: Record<string, unknown> = { resourceType: 'Encounter' };

  Object.assign(out, primitiveOrTemplate('status', f.status ?? '', asString));
  Object.assign(out, primitiveOrTemplate('class',  f.class  ?? '', asString));

  // period.start / .end as a nested object. Keep templated values
  // routed through primitiveOrTemplate so ${time} survives.
  const period: Record<string, unknown> = {};
  Object.assign(period, primitiveOrTemplate('start', f.start ?? '', asString));
  Object.assign(period, primitiveOrTemplate('end',   f.end   ?? '', asString));
  if (Object.keys(period).length > 0) out.period = period;

  const cc = buildCodeableConcept(
    f.codeSystem ?? '',
    f.codeValue ?? '',
    autoFreeDisplay('codeDisplay', f.codeDisplay ?? '', n));
  if (cc) out.type = [cc];

  applyOutgoingRefs(out, n, edges);
  return out;
}

// Layout coords as a complex extension. valueDecimal because x/y are
// floats after force-directed simulation.
function layoutExtension(n: Node): Record<string, unknown> {
  return {
    url: URL_LAYOUT_COORDS,
    extension: [
      { url: 'x', valueDecimal: n.x },
      { url: 'y', valueDecimal: n.y },
    ],
  };
}

// Per-node entry. Wraps the resource with fullUrl + meta.tag (in rule mode)
// + extension[layout-coords].
function buildEntry(n: Node, edges: Edge[], includeLegs: boolean): Record<string, unknown> {
  const builder =
    n.type === 'Observation'         ? buildObservation
  : n.type === 'Condition'           ? buildCondition
  : n.type === 'ClinicalImpression'  ? buildClinicalImpression
  : n.type === 'MedicationRequest'   ? buildMedicationRequest
  : n.type === 'Appointment'         ? buildAppointment
  : n.type === 'Encounter'           ? buildEncounter
  : buildGeneric;

  const resource = builder(n, edges);

  // meta.tag carries leg memberships (rule mode only). We always emit a
  // meta object even if no tags so we have a place to hang the layout
  // coords extension consistently — keeps the parser path simpler.
  const meta: Record<string, unknown> = {};
  if (includeLegs && n.legs && n.legs.length > 0) {
    meta.tag = n.legs.map((leg) => ({ system: RULE_LEG_SYSTEM, code: leg }));
  }
  if (Object.keys(meta).length > 0) resource.meta = meta;

  // Layout coords stash. Only emit if the node has a non-default position
  // (some imported nodes start at 0,0 before physics runs).
  resource.extension = [layoutExtension(n)];

  return {
    fullUrl: fullUrlFor(n.id),
    resource,
  };
}

// Predicate manifest entry. One Basic resource carrying an extension list,
// each predicate as a complex extension with target / fhirpath / label.
function buildManifestEntry(predicates: Predicate[]): Record<string, unknown> {
  return {
    fullUrl: fullUrlFor('rule-manifest'),
    resource: {
      resourceType: 'Basic',
      code: {
        coding: [{ system: RULE_MANIFEST_CODE, code: 'manifest' }],
      },
      extension: predicates.map((p) => ({
        url: URL_PREDICATE,
        extension: [
          { url: 'target',   valueUri:    fullUrlFor(p.target) },
          { url: 'fhirpath', valueString: p.fhirpath },
          { url: 'label',    valueString: p.label },
        ],
      })),
    },
  };
}

// ---- Public API ------------------------------------------------------

export interface BuildOpts {
  ruleId?: string;          // Bundle.id, defaults to "rule" or "patient-state"
  includeLegs?: boolean;    // emit meta.tag; default true if any node has legs
  includeManifest?: boolean;// emit Basic manifest entry; default true if predicates non-empty
}

export function buildBundle(
  nodes: Node[],
  edges: Edge[],
  predicates: Predicate[] = [],
  opts: BuildOpts = {},
): Record<string, unknown> {
  const anyLegs = nodes.some((n) => (n.legs ?? []).length > 0);
  const includeLegs = opts.includeLegs ?? anyLegs;
  const includeManifest = opts.includeManifest ?? predicates.length > 0;
  const id = opts.ruleId ?? (includeLegs ? 'rule' : 'patient-state');

  // Auto-extend each NAC to include the L pattern. The user only has to
  // author the forbidden extra context; the engine sees the proper
  // morphism shape (every L-tagged node also tagged with each Ni).
  const exportNodes = includeLegs ? expandLegsForNACs(nodes) : nodes;
  const entries: Record<string, unknown>[] = exportNodes.map((n) => buildEntry(n, edges, includeLegs));
  if (includeManifest && predicates.length > 0) {
    entries.push(buildManifestEntry(predicates));
  }

  return {
    resourceType: 'Bundle',
    type: 'collection',
    id,
    ...(includeLegs ? { meta: { profile: [`${NS}/StructureDefinition/CDSRule`] } } : {}),
    entry: entries,
  };
}

// ---- Parsing back to graph ---------------------------------------------
//
// Reverse direction. Auto-detects rule vs patient by presence of leg tags
// or a manifest entry. Returns the components App.tsx needs to populate
// the active document state.

export interface ParsedBundle {
  nodes: Node[];
  edges: Edge[];
  predicates: Predicate[];
  isRule: boolean;
}

// Read a primitive slot — handles both literal values and the
// `_field.extension[template-variable]` form. When a template variable
// is present, we emit "${name}" so the UI shows a placeholder where
// the user can re-edit it.
function readPrimitive(parent: Record<string, unknown>, field: string): string {
  const lit = parent[field];
  if (typeof lit === 'string') return lit;
  if (typeof lit === 'number') return String(lit);
  if (typeof lit === 'boolean') return String(lit);
  const tag = parent[`_${field}`] as { extension?: Array<{ url: string; valueId?: string }> } | undefined;
  if (tag?.extension) {
    const tv = tag.extension.find((e) => e.url === URL_TEMPLATE_VAR);
    if (tv?.valueId) return `\${${tv.valueId}}`;
  }
  return '';
}

function readCoding(cc: unknown, idx = 0): Record<string, string> {
  const arr = (cc as { coding?: Array<Record<string, unknown>> })?.coding;
  if (!arr || !arr[idx]) return {};
  const c = arr[idx];
  return {
    system:  readPrimitive(c, 'system'),
    code:    readPrimitive(c, 'code'),
    display: readPrimitive(c, 'display'),
  };
}

function readLegs(resource: Record<string, unknown>): string[] {
  const meta = resource.meta as { tag?: Array<{ system?: string; code?: string }> } | undefined;
  if (!meta?.tag) return [];
  return meta.tag
    .filter((t) => t.system === RULE_LEG_SYSTEM && typeof t.code === 'string')
    .map((t) => t.code as string);
}

function readLayout(resource: Record<string, unknown>): { x: number; y: number } | null {
  const ext = resource.extension as Array<{ url?: string; extension?: Array<{ url?: string; valueDecimal?: number }> }> | undefined;
  const layout = ext?.find((e) => e.url === URL_LAYOUT_COORDS);
  if (!layout?.extension) return null;
  const x = layout.extension.find((e) => e.url === 'x')?.valueDecimal;
  const y = layout.extension.find((e) => e.url === 'y')?.valueDecimal;
  if (typeof x === 'number' && typeof y === 'number') return { x, y };
  return null;
}

// Reconstruct UI fields from a FHIR resource. Inverse of build*. For the
// three round-trippable types we know the exact field set; for others we
// fall back to "copy any string-typed top-level keys".
function readFields(rt: string, r: Record<string, unknown>): Record<string, string> {
  const f: Record<string, string> = {};
  if (rt === 'Observation') {
    f.status = readPrimitive(r, 'status');
    const c = readCoding(r.code);
    f.codeSystem  = c.system  ?? '';
    f.codeValue   = c.code    ?? '';
    f.codeDisplay = c.display ?? '';
    const vq = r.valueQuantity as Record<string, unknown> | undefined;
    if (vq) {
      f.value = readPrimitive(vq, 'value');
      f.unit  = readPrimitive(vq, 'unit');
    }
    f.effective = readPrimitive(r, 'effectiveDateTime');
  } else if (rt === 'Condition') {
    const c = readCoding(r.code);
    f.codeSystem  = c.system  ?? '';
    f.codeValue   = c.code    ?? '';
    f.codeDisplay = c.display ?? '';
    const cs = readCoding(r.clinicalStatus);
    f.clinicalStatus = cs.code ?? '';
    f.recordedDate = readPrimitive(r, 'recordedDate');
  } else if (rt === 'ClinicalImpression') {
    f.status = readPrimitive(r, 'status');
    f.date   = readPrimitive(r, 'date');
  } else if (rt === 'MedicationRequest') {
    // medicationCodeableConcept.coding[0] holds the (system, code, display)
    // triple — same shape as Observation/Condition. Falls back to a flat
    // top-level `medication` string for legacy bundles (display only).
    f.status = readPrimitive(r, 'status');
    f.intent = readPrimitive(r, 'intent');
    const mcc = r.medicationCodeableConcept as { coding?: Array<Record<string, unknown>> } | undefined;
    if (mcc?.coding?.[0]) {
      const c = readCoding(mcc);
      f.codeSystem  = c.system  ?? '';
      f.codeValue   = c.code    ?? '';
      f.codeDisplay = c.display ?? '';
    } else {
      f.codeSystem  = '';
      f.codeValue   = '';
      f.codeDisplay = readPrimitive(r, 'medication');
    }
    const di = r.dosageInstruction as Array<Record<string, unknown>> | undefined;
    if (di && di[0]) {
      f.dosage = readPrimitive(di[0], 'text');
    } else {
      f.dosage = readPrimitive(r, 'dosage');
    }
  } else if (rt === 'Appointment') {
    f.status = readPrimitive(r, 'status');
    f.start  = readPrimitive(r, 'start');
    f.end    = readPrimitive(r, 'end');
    // serviceType[0].coding[0] holds the code triple. Fall back to a
    // top-level `display` for older or hand-authored bundles.
    const stArr = r.serviceType as Array<unknown> | undefined;
    const c = readCoding(stArr?.[0]);
    f.codeSystem  = c.system  ?? '';
    f.codeValue   = c.code    ?? '';
    f.codeDisplay = c.display || readPrimitive(r, 'display');
  } else if (rt === 'Encounter') {
    f.status = readPrimitive(r, 'status');
    f.class  = readPrimitive(r, 'class');
    // period.start / .end with a flat-shape fallback.
    const period = r.period as Record<string, unknown> | undefined;
    f.start = period ? readPrimitive(period, 'start') : readPrimitive(r, 'start');
    f.end   = period ? readPrimitive(period, 'end')   : readPrimitive(r, 'end');
    // type[0].coding[0] holds the code triple. Fall back to a top-level
    // `display` for legacy bundles.
    const typeArr = r.type as Array<unknown> | undefined;
    const c = readCoding(typeArr?.[0]);
    f.codeSystem  = c.system  ?? '';
    f.codeValue   = c.code    ?? '';
    f.codeDisplay = c.display || readPrimitive(r, 'display');
  } else {
    // Generic — copy string-ish top-level keys. Skips nested objects to
    // avoid serializing meta/extension/etc. into the field map.
    for (const [k, v] of Object.entries(r)) {
      if (k === 'resourceType' || k === 'meta' || k === 'extension') continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        f[k] = String(v);
      }
    }
  }
  return f;
}

// Map fullUrl → node id. Per our convention, fullUrl is `urn:uuid:<id>`,
// so reverse-mapping is just stripping the prefix. Robust to either form
// of `urn:uuid:obs-1` (UI-emitted) or `urn:uuid:<real-uuid>` (Julia-emitted).
const idForUrl = (url: string): string =>
  url.startsWith('urn:uuid:') ? url.slice('urn:uuid:'.length) : url;

export function parseBundle(bundle: Record<string, unknown>): ParsedBundle {
  const entries = (bundle.entry as Array<Record<string, unknown>> | undefined) ?? [];
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const predicates: Predicate[] = [];
  let isRule = false;

  // First pass: build nodes (ignore Basic manifest, handle separately).
  let layoutFallbackI = 0;
  for (const entry of entries) {
    const fullUrl = String(entry.fullUrl ?? '');
    const r = entry.resource as Record<string, unknown> | undefined;
    if (!r) continue;
    const rt = String(r.resourceType ?? '');

    if (rt === 'Basic') {
      // Manifest entry — predicates list lives in extension[].
      const ext = r.extension as Array<Record<string, unknown>> | undefined;
      if (!ext) continue;
      for (const e of ext) {
        if (e.url !== URL_PREDICATE) continue;
        const inner = e.extension as Array<{ url?: string; valueUri?: string; valueString?: string }> | undefined;
        if (!inner) continue;
        const get = (key: string) => inner.find((x) => x.url === key);
        const target = idForUrl(get('target')?.valueUri ?? '');
        const fhirpath = get('fhirpath')?.valueString ?? '';
        const label = get('label')?.valueString ?? '';
        // Try to lift the raw FHIRPath into the structured triple. When
        // recognizable, the UI opens the predicate in builder mode; when
        // not, the predicate stays raw and the editor falls back to a
        // textarea.
        const structured = parseFhirpath(fhirpath);
        predicates.push({
          id: `pred-${predicates.length}-${Date.now().toString(36)}`,
          target, fhirpath, label,
          ...(structured ?? {}),
        });
      }
      isRule = true;
      continue;
    }

    if (!rt) continue;
    const id = idForUrl(fullUrl);
    const legs = readLegs(r);
    if (legs.length > 0) isRule = true;

    const layout = readLayout(r);
    // Grid fallback for resources without persisted coords (imported
    // patient bundles, hand-authored Bundles). The force sim takes over
    // immediately on first render.
    const x = layout?.x ?? (200 + (layoutFallbackI % 5) * 200);
    const y = layout?.y ?? (200 + Math.floor(layoutFallbackI / 5) * 200);
    layoutFallbackI++;

    nodes.push({
      id, type: rt, x, y,
      // Don't prepend id into fields — node.id is canonical, duplicating
      // it into the field map confused users (showed up twice in DetailPanel).
      fields: readFields(rt, r),
      legs: legs.length > 0 ? legs : undefined,
      fullUrl,
    });
  }

  // Second pass: rebuild edges. Two shapes recognized:
  //   1. ClinicalImpression's backbone elements — finding[].itemReference
  //      and problem[].reference, labeled "finding"/"problem".
  //   2. Any other top-level field whose value looks like a FHIR Reference:
  //      { reference: "urn:uuid:..." } or array of those. Field name
  //      becomes the edge label (e.g. "subject", "encounter", "performer").
  // This way an export → import round-trip preserves all edges, not just
  // the engine-tracked junctions.
  const isRef = (v: unknown): v is { reference: string } =>
    !!v && typeof v === 'object' && typeof (v as Record<string, unknown>).reference === 'string';

  for (const entry of entries) {
    const r = entry.resource as Record<string, unknown> | undefined;
    if (!r) continue;
    const fromId = idForUrl(String(entry.fullUrl ?? ''));

    // Case 1 — ClinicalImpression backbone elements.
    if (r.resourceType === 'ClinicalImpression') {
      const findings = (r.finding as Array<{ itemReference?: { reference?: string } }> | undefined) ?? [];
      for (const f of findings) {
        const ref = f.itemReference?.reference;
        if (ref) edges.push({ from: fromId, to: idForUrl(ref), label: 'finding' });
      }
      const problems = (r.problem as Array<{ reference?: string }> | undefined) ?? [];
      for (const p of problems) {
        if (p.reference) edges.push({ from: fromId, to: idForUrl(p.reference), label: 'problem' });
      }
    }

    // Case 2 — any other top-level Reference field. Skip the structural
    // keys (resourceType, meta, extension, code, …) and the CI junction
    // arrays already handled above.
    const SKIP_KEYS = new Set([
      'resourceType', 'meta', 'extension', 'code', 'category',
      'clinicalStatus', 'valueQuantity', 'finding', 'problem',
    ]);
    for (const [field, val] of Object.entries(r)) {
      if (SKIP_KEYS.has(field)) continue;
      if (field.startsWith('_')) continue;
      if (isRef(val)) {
        edges.push({ from: fromId, to: idForUrl(val.reference), label: field });
      } else if (Array.isArray(val)) {
        for (const item of val) {
          if (isRef(item)) edges.push({ from: fromId, to: idForUrl(item.reference), label: field });
        }
      }
    }
  }

  return { nodes, edges, predicates, isRule };
}
