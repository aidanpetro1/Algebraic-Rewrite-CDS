# Algebraic CDS

Clinical decision support expressed as **ACSet rewriting** in
[Catlab.jl](https://github.com/AlgebraicJulia/Catlab.jl) and
[AlgebraicRewriting.jl](https://github.com/AlgebraicJulia/AlgebraicRewriting.jl).

A clinical state is an ACSet on a fixed schema (Observations, Findings,
Assessments, Diagnoses, Problems + FHIR-style Code/Value/Status/Time). A CDS
rule is a span `L ← K → R` of ACSets, optionally guarded by a *negative
application condition* (NAC) and one or more attribute-value predicates. Rule
firing is a homomorphism search for `m: L → state` followed by a DPO rewrite.
Composition of rules is composition of spans — clinical pathways become
morphisms in the rewriting category.

## Run

```bash
julia viz_suite.jl
```

This produces a narrative SVG suite under `out/suite/`:

```
01_schema.svg                     the schema as a category
02_initial_state.svg              a patient state on that schema
03_rule_add/{L,K,R,combined}.svg  DM2-add rule, one file per leg
04_rule_add_predicates.svg        HbA1c ≥ 6.5
05_rule_add_nac.svg               negative application condition
06_step_add_ba.svg                before / after firing DM2-add
07_rule_resolve/{L,K,R,...}.svg   DM2-resolve rule (design-only)
08_rule_resolve_predicates.svg    HbA1c < 5.7
09_pathway.svg                    longitudinal three-step pathway
```

The didactic renderer hides Code/Value/Status/Time bookkeeping and suppresses
AttrVars from labels, so the difference between L, K, and R reads off as
*which information appears in which leg*. Predicates fold into the L pattern
inline (e.g. `Obs 1: HbA1c [< 5.7]`).

## File guide

**Schema and state**

| File | What |
|---|---|
| `clinical_state_multi.jl` | The `ClinicalStateMulti` schema (`@present` + `@acset_type`). |
| `state_builders.jl`       | Helpers for constructing instances and scenario factories. |

**Rule infrastructure**

| File | What |
|---|---|
| `cds_rule.jl`       | `RuleWithACs` — a Catlab `Rule` plus pure-CT NACs/PACs and a `fire` driver. |
| `cds_predicates.jl` | `AttrPredicate` and `CDSRule` — the value-level predicate layer above `RuleWithACs`. |

**Rules**

| File | What |
|---|---|
| `rule_dm2_core.jl`         | The DM2-add rule (additive; K = L). |
| `rule_dm2_resolve_core.jl` | The DM2-resolve rule (design-only — see header for why it can't be packaged into a runtime `Rule`). |

**Visualization**

| File | What |
|---|---|
| `viz_helpers.jl` | All renderers. The `didactic_*` family is what the suite uses; the older `full_view`, `rule_view`, `before_after_view` etc. are kept for the ad-hoc demo scripts. |
| `viz_suite.jl`   | The narrative suite — produces `out/suite/*`. |

**Ad-hoc demos** (pre-suite, kept for history)

| File | What |
|---|---|
| `main.jl`         | Populates a single rich `ClinicalStateMulti` instance. |
| `visualize.jl`    | Renders schema + that state. |
| `rule_dm2.jl`     | Scenario matrix for the DM2-add rule. |
| `vignette_dm2.jl` | Realistic patient vignette: rule fires, NAC blocks re-firing. |

## A categorical note on the resolve rule

The DM2-resolve rule is intentionally design-only. Status flips on a *preserved*
Hom target cannot be expressed as a runtime `Rule{:DPO}` under
AlgebraicRewriting's current monicness check on r-AttrType components combined
with the schema's total `probStatus::Hom(Problem, Status)`. The structural span
(`L_resolve ← K_resolve → R_resolve`) is still constructed and visualized, so
the design is documented in code; firing it would require a schema change to a
junction-`Ob` event model. See the header of `rule_dm2_resolve_core.jl` for
the full categorical reasoning.
