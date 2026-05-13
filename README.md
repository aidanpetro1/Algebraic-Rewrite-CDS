# Algebraic CDS

Clinical decision support expressed as **ACSet rewriting** in
[Catlab.jl](https://github.com/AlgebraicJulia/Catlab.jl) and
[AlgebraicRewriting.jl](https://github.com/AlgebraicJulia/AlgebraicRewriting.jl),
with **FHIR R4** as the wire format on both ends.

## Concept

A clinical state is an ACSet whose Obs are FHIR resource types
(Observation, Condition, ClinicalImpression, MedicationRequest,
Appointment, Encounter) and whose attributes are the resources' FHIR
fields, inlined. The ACSet is structurally a FHIR Bundle in disguise: one
row per entry, attributes for fields, Homs for References.

A CDS rule is a span `L ← K → R` of ACSets, optionally guarded by one or
more *negative application conditions* (NACs) and attribute-value
predicates. Rule firing is a homomorphism search for `m: L → state`
followed by a DPO rewrite. Composition of rules is composition of spans —
clinical pathways become morphisms in the rewriting category.

The matching and rewriting engine (Catlab + AlgebraicRewriting) operates
on ACSets at runtime. FHIR is purely the on-disk / on-the-wire format; a
parser turns FHIR Bundles into ACSets at the door, a serializer turns
them back on the way out. With the FHIR-shaped schema, that round-trip
is byte-equal — every FHIR field has exactly one ACSet attribute slot.

For the longer design discussion (rules-as-FHIR-Bundles, FHIRPath
predicates, Provenance emission) see
[`docs/fhir_pipeline_design.md`](docs/fhir_pipeline_design.md).

## Install

```bash
julia --project=. -e 'using Pkg; Pkg.instantiate()'
cd ui && npm ci
```

## Run

Local dev needs two processes — the Julia engine and the Vite UI:

```bash
# terminal 1 — engine on :8081
julia --project=. cds_server.jl

# terminal 2 — UI on :5173 (proxies /fire to the engine)
cd ui && npm run dev
```

Open the UI, pick a sample rule (HTN, DM2, metformin, ophth referral)
from the library, click **Run** or **Step** to fire it. NACs that block
firing produce counterfactual diagnostics naming the specific violating
resource.

To deploy publicly: see [`DEPLOY.md`](DEPLOY.md).

## End-to-end tests

```bash
julia --project=. test_htn_nac.jl         # HTN/DM2 NAC blocking
julia --project=. test_new_resources.jl   # MedicationRequest, Appointment, cross-resource refs
```

## File guide

**Schema and state**

| File | What |
|---|---|
| `clinical_state_multi.jl` | The `SchClinicalState` schema (`@present` + `@acset_type`). FHIR-shaped — Obs are FHIR resource types, attributes are FHIR fields. |
| `state_builders.jl`       | `add_observation!`, `add_condition!`, … plus the cross-resource link helpers. |

**Rule infrastructure**

| File | What |
|---|---|
| `cds_rule.jl`       | `RuleWithACs` — a Catlab `Rule` plus pure-CT NACs/PACs and a `fire` driver. `_describe_violator` produces counterfactual NAC detail. |
| `cds_predicates.jl` | `AttrPredicate` and `CDSRule` — the value-level predicate layer. Each `AttrPredicate` translates mechanically to FHIRPath. |

**FHIR boundary**

| File | What |
|---|---|
| `fhir_serialize.jl` | `acset_to_fhir(state) -> Bundle::Dict`. Deterministic UUIDv5 fullUrls. |
| `fhir_parse.jl`     | `fhir_to_acset(bundle::Dict) -> CState`. Two-pass to resolve cross-resource References. |
| `fhir_to_rule.jl`   | `fhir_to_rule(bundle::Dict) -> CDSRule`. Per-Ob builders + leg morphism construction. |

**Server**

| File | What |
|---|---|
| `cds_server.jl` | HTTP.jl server. One endpoint: `POST /fire { rule, host } → { status, detail, state }`. PORT reads from `ENV["PORT"]` for hosted environments, falls back to 8081 locally. |

**UI**

| Path | What |
|---|---|
| `ui/` | Vite + React + TypeScript app for visually composing FHIR resource graphs (nodes = resources, edges = references). Reads/writes the same FHIR Bundles the engine consumes. Engine URL comes from `VITE_CDS_URL` (defaults to `http://localhost:8081`). |

**Deploy**

| File | What |
|---|---|
| `Dockerfile`, `.dockerignore`, `railway.json` | Engine container for Railway (or any container host). |
| `.github/workflows/deploy-ui.yml`             | Builds `ui/dist` and publishes to Cloudflare Pages on push to main. |
| `DEPLOY.md`                                   | Full walkthrough including account setup. |
