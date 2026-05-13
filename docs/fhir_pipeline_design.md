# FHIR-to-FHIR pipeline design

**Status:** draft for review
**Date:** 2026-05-07

## Goal

Replace the Algebraic_CDS package's bespoke surface — custom ACSet schema for
patient state, custom Julia structs for rules — with a FHIR-native interface,
without giving up the categorical foundation.

Concretely:

- A **patient state** is a FHIR Bundle (Patient + Observations + Conditions
  + ClinicalImpressions + …).
- A **rule** is also a FHIR Bundle. It contains FHIR resources of the same
  types as patient data — Observations, Conditions, etc. — grouped into the
  three legs of a DPO span (`L`, `K`, `R`), plus any NACs and predicates.
- The **engine** consumes both, fires what fires, and emits a new patient
  Bundle plus a Provenance trail.

The rule, as the user put it, "looks like an actual FHIR resource it runs on" —
the same resource types, the same shapes, the same coding systems. The only
difference is that some fields carry placeholders instead of literals.

## Architecture

```
┌──────────────────────┐     ┌──────────────────────┐
│  Patient FHIR        │     │  Rule FHIR Bundle    │
│  Bundle              │     │  (L | K | R | NACs   │
│                      │     │   + predicates)      │
└──────────┬───────────┘     └──────────┬───────────┘
           │                            │
           │  fhir_to_acset             │  fhir_to_rule
           ▼                            ▼
┌──────────────────────┐     ┌──────────────────────┐
│  Host ACSet          │     │  RuleWithACs +       │
│  (CStateMulti)       │     │  CDSRule             │
└──────────┬───────────┘     └──────────┬───────────┘
           │                            │
           └─────────────┬──────────────┘
                         ▼
              ┌──────────────────────┐
              │  fire (existing)     │
              │  Catlab homomorphism │
              │  + DPO rewrite       │
              └──────────┬───────────┘
                         ▼
              ┌──────────────────────┐
              │  Host ACSet'         │
              └──────────┬───────────┘
                         │  acset_to_fhir
                         ▼
              ┌──────────────────────┐
              │  Patient Bundle'     │
              │  + Provenance        │
              └──────────────────────┘
```

The engine in the middle is unchanged — it's still `cds_rule.jl` +
`cds_predicates.jl` operating on `ClinicalStateMulti`. What's new is the FHIR
boundary on both ends and a new way of authoring rules.

## Schema correspondence (current → FHIR R4)

| Current Ob       | FHIR resource          | Notes                                                   |
|------------------|------------------------|---------------------------------------------------------|
| `Observation`    | `Observation`          | direct                                                  |
| `Problem`        | `Condition`            | "Problem" is the FHIR Condition with category=problem-list-item |
| `Assessment`     | `ClinicalImpression`   | summary of clinical reasoning event                     |
| `Finding`        | `ClinicalImpression.finding` (BackboneElement) | junction: links a ClinicalImpression to an Observation evidence |
| `Diagnosis`      | `ClinicalImpression.problem` (Reference) or `Condition.evidence` | junction: links a ClinicalImpression to a Condition |
| `Code`           | `CodeableConcept` / `Coding`                  | folded into containing resource                          |
| `Value`          | `Quantity` (`Observation.valueQuantity`)      | folded into containing Observation                       |
| `Status`         | `code`-typed status fields (`Observation.status`, `Condition.clinicalStatus`, `ClinicalImpression.status`) | folded |
| `Time`           | `effectiveDateTime` / `recordedDate` / `date` | folded                                                  |

Two non-trivial points:

1. The current schema *externalizes* `Code`, `Value`, `Status`, `Time` as
   first-class objects so they can be reasoned about as morphism targets.
   In FHIR these are nested inside the containing resource. The translator
   re-internalizes them on serialize, and re-externalizes them on parse —
   the round-trip is lossless for any state that conforms to the schema.
2. `Finding` and `Diagnosis` are junction objects; in FHIR they appear as
   BackboneElements and References inside `ClinicalImpression`. The parser
   creates synthetic ACSet rows for these junctions.

## The rule as a FHIR Bundle

A rule is a single `Bundle` of type `collection`. Its entries are exactly the
FHIR resources that a patient Bundle would contain — Observations, Conditions,
ClinicalImpressions — *plus* a manifest entry that wires them together.

### Entry tagging

Every FHIR resource carries `Resource.meta.tag`. We use that to mark which
leg of the span an entry belongs to:

```
meta.tag.system = http://algebraic-cds.org/rule-leg
meta.tag.code   = L | K | R | N1 | N2 | …
```

So an Observation tagged `L` is part of the L pattern; an Observation tagged
`R` is part of the R rewrite target; a Condition tagged `N1` is part of the
first NAC. An entry can carry multiple tags — a resource preserved across
`L`, `K`, and `R` carries all three tags, on a single entry.

### Cross-leg correspondence via `fullUrl`

The DPO span morphisms `l: K→L` and `r: K→R` are encoded by **identity of
`Bundle.entry.fullUrl`**. If the same `urn:uuid:obs-hba1c` appears as an
entry tagged `L`, `K`, and `R`, then in all three legs that's the same
Observation — it's preserved by the rule. If a `urn:uuid:cond-dm2` appears
only in entries tagged `R`, that's a resource the rule *creates*.

This is exactly the morphism encoding ACSets already use under the hood,
just expressed at the Bundle level.

### Placeholders (the FHIR analog of AttrVars)

Where the current rules use Catlab `AttrVar(n)` for "any value of this
attribute," FHIR resources need a placeholder convention. The cleanest fit
is a FHIR Extension on the slot:

```json
{
  "valueQuantity": {
    "_value": {
      "extension": [{
        "url": "http://algebraic-cds.org/StructureDefinition/template-variable",
        "valueId": "hba1c-magnitude"
      }]
    },
    "unit": "%"
  }
}
```

The `_value` form is FHIR's standard way to attach extensions to primitive
fields. The `valueId` is the variable name; matching variables across L, K,
and R encode that those slots share a value.

For string-typed slots (display names, units), the same pattern applies via
`_display`, `_unit`, etc.

### NACs

Each NAC is a separate set of entries tagged `N1`, `N2`, … with their own
`fullUrl`s. The L→N morphism is encoded by `fullUrl` identity between
entries tagged `L` and entries tagged `Ni`.

### Predicates

Predicates live in a single manifest entry, a `Basic` resource with
`code = http://algebraic-cds.org/CodeSystem/rule-manifest`, carrying a list
of FHIRPath expressions as extensions:

```json
{
  "resourceType": "Basic",
  "code": { ... },
  "extension": [
    {
      "url": "http://algebraic-cds.org/StructureDefinition/predicate",
      "extension": [
        { "url": "target",     "valueUri": "urn:uuid:obs-hba1c" },
        { "url": "fhirpath",
          "valueString": "Observation.code.coding.where(system='http://loinc.org' and code='4548-4').exists() and Observation.valueQuantity.value >= 6.5" },
        { "url": "label",      "valueString": "HbA1c ≥ 6.5" }
      ]
    }
  ]
}
```

The `target` is the `fullUrl` of the resource the predicate runs against;
the `fhirpath` is the predicate body; `label` is the human-readable form
(replaces what `describe(::AttrPredicate)` does today).

Why FHIRPath: the current `AttrPredicate` is essentially FHIRPath in
disguise. `hba1c_pred` —

```julia
AttrPredicate("http://loinc.org", "4548-4", "Hemoglobin A1c",
              :valMagnitude, ≥, 6.5)
```

— is exactly:

```
Observation.code.coding.where(system='http://loinc.org' and code='4548-4').exists()
  and Observation.valueQuantity.value >= 6.5
```

FHIRPath is FHIR-native, has implementations across the ecosystem, and there
are existing Julia-callable bridges (or a small interpreter is feasible
since we only need a small subset).

### What a rule Bundle looks like end-to-end

The DM2-add rule, sketched:

```json
{
  "resourceType": "Bundle",
  "type": "collection",
  "id": "rule-dm2-add",
  "meta": {
    "profile": ["http://algebraic-cds.org/StructureDefinition/CDSRule"]
  },
  "entry": [
    {
      "fullUrl": "urn:uuid:obs-hba1c",
      "resource": {
        "resourceType": "Observation",
        "meta": { "tag": [
          { "system": "http://algebraic-cds.org/rule-leg", "code": "L" },
          { "system": "http://algebraic-cds.org/rule-leg", "code": "K" },
          { "system": "http://algebraic-cds.org/rule-leg", "code": "R" },
          { "system": "http://algebraic-cds.org/rule-leg", "code": "N1" }
        ]},
        "status": "final",
        "code": { "coding": [{ "system": "http://loinc.org", "code": "4548-4" }] },
        "valueQuantity": {
          "_value": { "extension": [{
            "url": "http://algebraic-cds.org/StructureDefinition/template-variable",
            "valueId": "hba1c-magnitude" }] },
          "unit": "%"
        }
      }
    },
    {
      "fullUrl": "urn:uuid:assm-dm2",
      "resource": {
        "resourceType": "ClinicalImpression",
        "meta": { "tag": [
          { "system": "http://algebraic-cds.org/rule-leg", "code": "R" }
        ]},
        "status": "completed",
        "finding":  [{ "itemReference": { "reference": "urn:uuid:obs-hba1c" } }],
        "problem":  [{ "reference": "urn:uuid:cond-dm2" }]
      }
    },
    {
      "fullUrl": "urn:uuid:cond-dm2",
      "resource": {
        "resourceType": "Condition",
        "meta": { "tag": [
          { "system": "http://algebraic-cds.org/rule-leg", "code": "R" },
          { "system": "http://algebraic-cds.org/rule-leg", "code": "N1" }
        ]},
        "clinicalStatus": { "coding": [{ "code": "active" }] },
        "code": { "coding": [{
          "system": "http://snomed.info/sct", "code": "44054006",
          "display": "Type 2 diabetes mellitus" }] }
      }
    },
    {
      "fullUrl": "urn:uuid:rule-manifest",
      "resource": {
        "resourceType": "Basic",
        "code": { "coding": [{ "system": "http://algebraic-cds.org/CodeSystem/rule-manifest", "code": "manifest" }] },
        "extension": [
          { "url": "http://algebraic-cds.org/StructureDefinition/predicate",
            "extension": [
              { "url": "target",   "valueUri": "urn:uuid:obs-hba1c" },
              { "url": "fhirpath", "valueString": "Observation.valueQuantity.value >= 6.5" },
              { "url": "label",    "valueString": "HbA1c ≥ 6.5" }
            ]}
        ]
      }
    }
  ]
}
```

Reading the tags: the HbA1c Observation is in `L`, `K`, `R`, and `N1` —
preserved everywhere, including the NAC. The DM2 Condition appears in `R`
(the rule creates it) and in `N1` (its prior existence is what the NAC
forbids). The ClinicalImpression appears only in `R` (newly created).

## Pipeline stages

### `fhir_to_acset(bundle::FHIRBundle) -> CStateMulti`

1. Iterate `bundle.entry`. For each Observation, allocate an ACSet
   `Observation` row plus a `Code`, `Value`, `Status`, `Time` row;
   wire homs.
2. For each Condition (with category=problem-list-item), allocate
   `Problem` + Code/Status/Time.
3. For each ClinicalImpression, allocate `Assessment` + Status/Time;
   for each `finding` BackboneElement, allocate `Finding`; for each
   `problem` Reference, allocate `Diagnosis`.
4. Resolve all references by `fullUrl` lookup.

### `fhir_to_rule(bundle::FHIRBundle) -> CDSRule`

1. Group entries by their `meta.tag` codes into `L`, `K`, `R`, `N1`, …
2. For each leg, run `fhir_to_acset` over the entries tagged with that
   leg. Replace primitive slots carrying a `template-variable` extension
   with `AttrVar(n)`, sharing variable indices across legs by variable name.
3. Build morphisms `l: K→L`, `r: K→R`, `n_i: L→Ni` from `fullUrl` identity.
4. Parse the manifest: build an `AttrPredicate`-equivalent for each
   FHIRPath expression. (See predicate-evaluation note below.)
5. Assemble `CDSRule(RuleWithACs(Rule{:DPO}(l, r); nacs=[…]); preds=[…])`.

### `acset_to_fhir(state::CStateMulti) -> FHIRBundle`

Inverse of `fhir_to_acset`. Folds the externalized Code/Value/Status/Time
rows back into their parent resources. Generates `fullUrl`s deterministically
(based on a stable hash of the row contents) so successive pipeline runs
produce diffable output.

### Provenance

Each rule firing emits a `Provenance` resource as an additional entry:

```
Provenance.target    = [references to created/modified resources]
Provenance.activity  = "rule-fired"
Provenance.agent     = the rule Bundle's id
Provenance.recorded  = timestamp
Provenance.entity    = the matched L resources
```

This gives downstream tools (auditing, explanation) a FHIR-native way to
ask "which rule created this Condition?" without our having to invent a
bespoke audit log.

## Predicate evaluation

FHIRPath gets evaluated against the *matched* L→state image. The signature
in the engine becomes:

```
predicate(match, bundle_view) -> Bool
```

where `bundle_view` is the matched portion of the host state, presented as
a FHIR-shaped view (just enough for the FHIRPath interpreter to consume —
it doesn't need to be a full Bundle round-trip).

For v1 we can ship a small FHIRPath subset covering the operators the
existing predicates use: `where`, `exists`, comparison operators on
`valueQuantity.value`, and equality on coding `system`/`code`. That's
maybe 200 lines of Julia and covers every predicate we have today.

## Open questions

1. **Profile vs. plain Bundle.** Should the rule Bundle conform to a
   formally-published `StructureDefinition` profile (so external tooling
   can validate it), or is convention enough? A formal profile costs
   maintenance but unlocks `$validate` against any FHIR server.
2. **`Bundle.entry` vs. `contained`.** The current sketch puts everything
   at the Bundle level. An alternative is to put each leg's resources
   inside a `Composition` and use FHIR's Composition/section semantics.
   Verdict tentative: stay at the Bundle level — Compositions imply
   document semantics we don't want.
3. **DM2-resolve.** The current resolve rule is design-only because
   AlgebraicRewriting's monicness check can't accept it. The FHIR layer
   inherits that limitation — *unless* the FHIR-side schema evolves
   toward a junction-event model (`ProblemStatusEvent`-as-resource), at
   which point the resolve rule becomes runnable. Worth flagging as a
   forcing function: the FHIR migration is a natural moment to revisit
   the schema.
4. **Versioning.** Rules will evolve. Use `Bundle.meta.versionId` plus a
   semver tag in `Basic`'s manifest. Cross-version rule equivalence is
   out of scope for v1.
5. **ValueSets.** Right now codes are hardcoded literals (`LOINC|4548-4`).
   The richer FHIR pattern is to bind to a `ValueSet`. Not blocking for
   v1 but easy to layer on once predicates know how to call
   `ValueSet/$expand`.

## Phased plan

| Phase | Scope                                                                                       |
|-------|---------------------------------------------------------------------------------------------|
| 1     | `acset_to_fhir` + `fhir_to_acset` round-trip on the existing DM2 vignette state.            |
| 2     | `fhir_to_rule` for the DM2-add rule. Author the rule Bundle by hand; show it fires identically to the current Julia-coded rule. |
| 3     | FHIRPath subset interpreter; replace `AttrPredicate` with FHIRPath expressions.             |
| 4     | Provenance emission; document the format.                                                   |
| 5     | StructureDefinition profile for `CDSRule`; validate against `hl7.fhir.r4.core`.             |
| 6     | (Stretch) DM2-resolve, contingent on the schema-event change discussed above.               |

Phase 1 alone makes the package consumable from any FHIR-speaking client;
phase 2 is where "rules as FHIR resources" becomes real.
