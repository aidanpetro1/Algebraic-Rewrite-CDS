# test_new_resources.jl — verifies MedicationRequest and Appointment now
# round-trip cleanly through the engine, schema-up.
#
# Two scenarios per resource type:
#   1. Engine-only: build the rule + host directly in Julia and fire.
#   2. Round-trip: serialize the post-fire host to a FHIR Bundle,
#      re-parse it, then fire the rule again. The NAC should block on
#      this second fire because the previously-created MedicationRequest
#      / Appointment is now in the host.
#
# Run: julia --project=. test_new_resources.jl

include("fhir_to_rule.jl")
include("fhir_serialize.jl")
include("fhir_parse.jl")
include("state_builders.jl")

using Catlab
using AlgebraicRewriting
using Dates

println("="^70)
println("Test 1 — Metformin rule (Condition + MedicationRequest)")
println("="^70)

# ---------- Build the metformin rule ----------
# L: 1 cond (DM2, AttrVar attrs)
# K: same as L
# R: cond-dm2 + medreq (newly created MedicationRequest)
# N1: cond-dm2 + medreq (forbidden — already has metformin)

function _alloc_string(st)
    add_part!(st, :StringAttr)
end
function _alloc_time(st)
    add_part!(st, :TimeAttr)
end

function metformin_L_or_K()
    st = empty_state()
    cs = _alloc_string(st)
    rd = _alloc_time(st)
    add_part!(st, :Condition;
        condCodeSystem     = "http://snomed.info/sct",
        condCodeValue      = "44054006",
        condCodeDisplay    = "Type 2 diabetes mellitus",
        condClinicalStatus = AttrVar(cs),
        condRecordedDate   = AttrVar(rd))
    st
end

function metformin_R_or_N1()
    st = empty_state()
    cs = _alloc_string(st)
    rd = _alloc_time(st)
    add_part!(st, :Condition;
        condCodeSystem     = "http://snomed.info/sct",
        condCodeValue      = "44054006",
        condCodeDisplay    = "Type 2 diabetes mellitus",
        condClinicalStatus = AttrVar(cs),
        condRecordedDate   = AttrVar(rd))
    add_part!(st, :MedicationRequest;
        mrMedication = "metformin 1000 mg",
        mrStatus     = "active",
        mrIntent     = "order",
        mrDosage     = "1 tab BID")
    st
end

L_met  = metformin_L_or_K()
K_met  = metformin_L_or_K()
R_met  = metformin_R_or_N1()
N1_met = metformin_R_or_N1()

l_met = homomorphism(K_met, L_met; monic=true, initial=(Condition=Dict(1=>1),))
r_met = homomorphism(K_met, R_met; monic=true, initial=(Condition=Dict(1=>1),))
n_met = homomorphism(L_met, N1_met; monic=true, initial=(Condition=Dict(1=>1),))
@assert !isnothing(l_met) "metformin l: K→L failed"
@assert !isnothing(r_met) "metformin r: K→R failed"
@assert !isnothing(n_met) "metformin n: L→N1 failed"

rule_met = RuleWithACs(Rule{:DPO}(l_met, r_met); nacs=[n_met])

# Host: active DM2 Condition, no metformin yet.
host_met = empty_state()
add_condition!(host_met;
    code_system="http://snomed.info/sct", code_value="44054006",
    code_display="Type 2 diabetes mellitus",
    clinical_status="active", time=DateTime("2025-12-01T10:00:00"))

println("\nFire 1 — pre-state has $(nparts(host_met, :Condition)) cond, $(nparts(host_met, :MedicationRequest)) medreq")
status1, host_met_after_1, _ = fire(rule_met, host_met)
println("  status: $status1  →  cond=$(nparts(host_met_after_1, :Condition)) medreq=$(nparts(host_met_after_1, :MedicationRequest))")
@assert status1 === :fired "expected metformin to fire on first call, got $status1"
@assert nparts(host_met_after_1, :MedicationRequest) == 1 "expected 1 medreq after fire, got $(nparts(host_met_after_1, :MedicationRequest))"

println("\nFire 2 — pre-state has $(nparts(host_met_after_1, :MedicationRequest)) medreq")
status2, _, detail2 = fire(rule_met, host_met_after_1)
println("  status: $status2  detail: '$detail2'")
@assert status2 === :nac_violated "expected metformin NAC to block on second call, got $status2"
println("✓ Metformin rule fires once and is blocked on second fire.")

println("\n— FHIR round-trip:")
bundle_met = acset_to_fhir(host_met_after_1)
println("  serialized $(length(bundle_met["entry"])) entries")
host_met_reparsed = fhir_to_acset(bundle_met)
println("  reparsed: cond=$(nparts(host_met_reparsed, :Condition)) medreq=$(nparts(host_met_reparsed, :MedicationRequest))")
@assert nparts(host_met_reparsed, :MedicationRequest) == 1 "round-trip lost MedicationRequest"
status3, _, _ = fire(rule_met, host_met_reparsed)
@assert status3 === :nac_violated "NAC failed through round-trip: got $status3"
println("✓ Metformin NAC blocks through FHIR round-trip.")

println("\n" * "="^70)
println("Test 2 — Ophthalmology referral rule (Condition + Appointment)")
println("="^70)

# ---------- Build the ophth-referral rule ----------
# L: 1 cond (DM2)
# K: same
# R: cond + appt-new (proposed appointment)
# N1: cond + appt-existing (any fulfilled appointment — blocks rule)

function ophth_L_or_K()
    st = empty_state()
    cs = _alloc_string(st)
    rd = _alloc_time(st)
    add_part!(st, :Condition;
        condCodeSystem     = "http://snomed.info/sct",
        condCodeValue      = "44054006",
        condCodeDisplay    = "Type 2 diabetes mellitus",
        condClinicalStatus = AttrVar(cs),
        condRecordedDate   = AttrVar(rd))
    st
end

function ophth_R()
    st = ophth_L_or_K()
    add_part!(st, :Appointment;
        apptStatus  = "proposed",
        apptStart   = Dates.now(),
        apptEnd     = Dates.now(),
        apptDisplay = "Ophthalmology consultation")
    st
end

function ophth_N1()
    st = ophth_L_or_K()
    # NAC matches any fulfilled appointment regardless of start/end.
    start_idx = _alloc_time(st)
    end_idx   = _alloc_time(st)
    disp_idx  = _alloc_string(st)
    add_part!(st, :Appointment;
        apptStatus  = "fulfilled",
        apptStart   = AttrVar(start_idx),
        apptEnd     = AttrVar(end_idx),
        apptDisplay = AttrVar(disp_idx))
    st
end

L_oph  = ophth_L_or_K()
K_oph  = ophth_L_or_K()
R_oph  = ophth_R()
N1_oph = ophth_N1()

l_oph = homomorphism(K_oph, L_oph; monic=true, initial=(Condition=Dict(1=>1),))
r_oph = homomorphism(K_oph, R_oph; monic=true, initial=(Condition=Dict(1=>1),))
n_oph = homomorphism(L_oph, N1_oph; monic=true, initial=(Condition=Dict(1=>1),))
@assert !isnothing(l_oph) "ophth l: K→L failed"
@assert !isnothing(r_oph) "ophth r: K→R failed"
@assert !isnothing(n_oph) "ophth n: L→N1 failed"

rule_oph = RuleWithACs(Rule{:DPO}(l_oph, r_oph); nacs=[n_oph])

# Host with NO existing appointment.
host_oph_a = empty_state()
add_condition!(host_oph_a;
    code_system="http://snomed.info/sct", code_value="44054006",
    code_display="Type 2 diabetes mellitus",
    clinical_status="active", time=DateTime("2025-12-01T10:00:00"))

println("\nNo existing appt — rule should fire:")
status_a, host_oph_after_a, _ = fire(rule_oph, host_oph_a)
println("  status: $status_a   appts now: $(nparts(host_oph_after_a, :Appointment))")
@assert status_a === :fired

# Host WITH a prior fulfilled appointment.
host_oph_b = empty_state()
add_condition!(host_oph_b;
    code_system="http://snomed.info/sct", code_value="44054006",
    code_display="Type 2 diabetes mellitus",
    clinical_status="active", time=DateTime("2025-12-01T10:00:00"))
add_appointment!(host_oph_b;
    status="fulfilled",
    start=DateTime("2026-02-10T14:00:00"),
    stop=DateTime("2026-02-10T14:30:00"),
    display="Ophthalmology consultation")

println("\nWith prior fulfilled appt — NAC should block:")
status_b, _, detail_b = fire(rule_oph, host_oph_b)
println("  status: $status_b  detail: '$detail_b'")
@assert status_b === :nac_violated "expected NAC to block, got $status_b"
println("✓ Ophthalmology rule fires when no appt, blocks when one exists.")

println("\n— FHIR round-trip:")
bundle_oph = acset_to_fhir(host_oph_b)
println("  serialized $(length(bundle_oph["entry"])) entries")
host_oph_reparsed = fhir_to_acset(bundle_oph)
println("  reparsed: appts=$(nparts(host_oph_reparsed, :Appointment))")
@assert nparts(host_oph_reparsed, :Appointment) == 1
status_c, _, _ = fire(rule_oph, host_oph_reparsed)
@assert status_c === :nac_violated "NAC failed through round-trip: got $status_c"
println("✓ Ophthalmology NAC blocks through FHIR round-trip.")

println("\n" * "="^70)
println("All tests passed — MedicationRequest and Appointment are wired up correctly.")
println("="^70)
