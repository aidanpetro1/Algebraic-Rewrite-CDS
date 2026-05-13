# test_htn_nac.jl — diagnostic for the HTN-rule "fires twice" bug.
#
# What this does:
#   1. Builds the HTN rule directly in Julia (via state_builders.jl + a
#      hand-rolled Rule{:DPO}) — bypassing the UI's bundle round-trip.
#   2. Builds a host with: 2 BP obs (152, 148) + 0 HTN Conditions.
#   3. Fires once. Asserts :fired and gets the post-fire state.
#   4. Fires again on the post-fire state. Asserts :nac_violated.
#
# Then it does the same thing through the FHIR-bundle pipeline
# (fhir_to_rule + acset_to_fhir + fhir_to_acset) to isolate whether the
# bug is in the engine itself or the UI's serialize/parse round trip.
#
# Run with: julia --project=. test_htn_nac.jl

include("fhir_to_rule.jl")     # also pulls cds_rule.jl, cds_predicates.jl
include("fhir_serialize.jl")
include("fhir_parse.jl")
include("state_builders.jl")

using Catlab
using AlgebraicRewriting
using Dates

println("="^70)
println("Test 1 — engine-only (no FHIR bundle round-trip)")
println("="^70)

# ---------- Build HTN rule directly ----------
# L: 1 obs (BP, AttrVar attrs)
# K: 1 obs (same as L)
# R: 1 obs + 1 cond-htn-new + 1 assm + 2 edges (finding, problem)
# N1: 1 obs + 1 cond-htn-existing
#
# Direct construction, no FHIR.

function build_L_or_K()
    st = empty_state()
    # Allocate AttrVar slots: bp(value), unit, status, time
    bp_idx     = add_part!(st, :FloatAttr)
    status_idx = add_part!(st, :StringAttr)
    time_idx   = add_part!(st, :TimeAttr)
    add_part!(st, :Observation;
        obsCodeSystem = "http://loinc.org",
        obsCodeValue  = "8480-6",
        obsCodeDisplay = "Systolic blood pressure",
        obsValueMagnitude = AttrVar(bp_idx),
        obsValueUnit  = "mmHg",
        obsStatus     = AttrVar(status_idx),
        obsEffective  = AttrVar(time_idx),
    )
    st
end

function build_R()
    st = empty_state()
    bp_idx     = add_part!(st, :FloatAttr)
    status_idx = add_part!(st, :StringAttr)
    time_idx   = add_part!(st, :TimeAttr)
    obs = add_part!(st, :Observation;
        obsCodeSystem = "http://loinc.org",
        obsCodeValue  = "8480-6",
        obsCodeDisplay = "Systolic blood pressure",
        obsValueMagnitude = AttrVar(bp_idx),
        obsValueUnit  = "mmHg",
        obsStatus     = AttrVar(status_idx),
        obsEffective  = AttrVar(time_idx),
    )
    cond = add_part!(st, :Condition;
        condCodeSystem = "http://snomed.info/sct",
        condCodeValue  = "38341003",
        condCodeDisplay = "Hypertensive disorder",
        condClinicalStatus = "active",
        condRecordedDate = Dates.now(),
    )
    ci = add_part!(st, :ClinicalImpression;
        ciStatus = "completed",
        ciDate   = Dates.now(),
    )
    add_part!(st, :Finding; finImpression=ci, finObservation=obs)
    add_part!(st, :Diagnosis; diagImpression=ci, diagCondition=cond)
    st
end

function build_N1()
    st = empty_state()
    # L's slots
    bp_idx     = add_part!(st, :FloatAttr)
    status_idx = add_part!(st, :StringAttr)
    time_idx   = add_part!(st, :TimeAttr)
    # Plus N1's extra existing-cond slots
    exDisp_idx   = add_part!(st, :StringAttr)
    exStat_idx   = add_part!(st, :StringAttr)
    exDate_idx   = add_part!(st, :TimeAttr)
    add_part!(st, :Observation;
        obsCodeSystem = "http://loinc.org",
        obsCodeValue  = "8480-6",
        obsCodeDisplay = "Systolic blood pressure",
        obsValueMagnitude = AttrVar(bp_idx),
        obsValueUnit  = "mmHg",
        obsStatus     = AttrVar(status_idx),
        obsEffective  = AttrVar(time_idx),
    )
    add_part!(st, :Condition;
        condCodeSystem = "http://snomed.info/sct",
        condCodeValue  = "38341003",
        condCodeDisplay = AttrVar(exDisp_idx),
        condClinicalStatus = AttrVar(exStat_idx),
        condRecordedDate = AttrVar(exDate_idx),
    )
    st
end

L = build_L_or_K()
K = build_L_or_K()
R = build_R()
N1 = build_N1()

# Morphisms — l: K→L pins K's obs#1 to L's obs#1.
l = homomorphism(K, L; monic=true, initial=(Observation=Dict(1=>1),))
r = homomorphism(K, R; monic=true, initial=(Observation=Dict(1=>1),))
n = homomorphism(L, N1; monic=true, initial=(Observation=Dict(1=>1),))

@assert !isnothing(l) "could not build l: K→L"
@assert !isnothing(r) "could not build r: K→R"
@assert !isnothing(n) "could not build n: L→N1"

# Predicate: SBP ≥ 140
pred_bp = AttrPredicate("http://loinc.org", "8480-6", "SBP",
                        :obsValueMagnitude, ≥, 140.0)

base_rule = RuleWithACs(Rule{:DPO}(l, r); nacs=[n])
rule = CDSRule(base_rule; preds=[pred_bp])

# ---------- Build host: 2 BP obs (152, 148), no HTN cond ----------
host = empty_state()
add_observation!(host;
    code_system="http://loinc.org", code_value="8480-6",
    code_display="Systolic blood pressure",
    magnitude=152.0, unit="mmHg", time=DateTime("2026-04-22T10:30:00"))
add_observation!(host;
    code_system="http://loinc.org", code_value="8480-6",
    code_display="Systolic blood pressure",
    magnitude=148.0, unit="mmHg", time=DateTime("2026-03-15T09:00:00"))

println("\nFire 1 — pre-state has $(nparts(host, :Observation)) obs, $(nparts(host, :Condition)) cond")
status1, host_after_1, detail1 = fire(rule, host)
println("  status: $status1   detail: '$detail1'")
println("  post-state: $(nparts(host_after_1, :Observation)) obs, $(nparts(host_after_1, :Condition)) cond")
@assert status1 === :fired "expected :fired on first call, got $status1"

println("\nFire 2 — pre-state has $(nparts(host_after_1, :Observation)) obs, $(nparts(host_after_1, :Condition)) cond")
status2, host_after_2, detail2 = fire(rule, host_after_1)
println("  status: $status2   detail: '$detail2'")
println("  post-state: $(nparts(host_after_2, :Observation)) obs, $(nparts(host_after_2, :Condition)) cond")

if status2 === :nac_violated
    println("\n✓ Engine NAC works correctly when called directly.")
else
    println("\n✗ Engine NAC FAILED: expected :nac_violated, got $status2")
    println("  This means the bug is in the engine itself, not the UI.")
end

# ---------- Test 2: same thing but through the FHIR round-trip ----------
println("\n" * "="^70)
println("Test 2 — through FHIR bundle round-trip (host serialized + reparsed)")
println("="^70)

host_bundle_after_1 = acset_to_fhir(host_after_1)
println("\nSerialized post-fire-1 host as FHIR Bundle:")
println("  entries: $(length(host_bundle_after_1["entry"]))")
for e in host_bundle_after_1["entry"]
    rt = e["resource"]["resourceType"]
    if rt == "Condition"
        coding = e["resource"]["code"]["coding"][1]
        cat = get(e["resource"], "category", [])
        cat_codes = isempty(cat) ? "(no category)" : [c["code"] for c in cat[1]["coding"]]
        println("  - $rt code=$(coding["system"]):$(coding["code"]) display=$(coding["display"]) category=$cat_codes")
    elseif rt == "Observation"
        coding = e["resource"]["code"]["coding"][1]
        val = get(get(e["resource"], "valueQuantity", Dict()), "value", "?")
        println("  - $rt code=$(coding["code"]) value=$val")
    end
end

host_after_1_reparsed = fhir_to_acset(host_bundle_after_1)
println("\nReparsed: $(nparts(host_after_1_reparsed, :Observation)) obs, $(nparts(host_after_1_reparsed, :Condition)) cond")

if nparts(host_after_1_reparsed, :Condition) == 0
    println("✗ The Condition is being LOST in the FHIR round trip.")
    println("  fhir_parse.jl is filtering it out — likely the problem-list-item check.")
end

println("\nFire 2 (after FHIR round-trip):")
status2b, _, detail2b = fire(rule, host_after_1_reparsed)
println("  status: $status2b   detail: '$detail2b'")

if status2b === :nac_violated
    println("\n✓ NAC blocks correctly through the FHIR round-trip.")
else
    println("\n✗ NAC FAILED through FHIR round-trip: got $status2b")
    println("  The bug is in fhir_serialize.jl ↔ fhir_parse.jl, not the engine.")
end
