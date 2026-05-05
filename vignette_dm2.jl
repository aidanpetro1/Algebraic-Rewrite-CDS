# vignette_dm2.jl — realistic clinical vignette for the DM2 rule.
#
# A 55yo patient at their initial clinic visit presents with several
# abnormal observations (HbA1c 9.8%, FBG 186, SBP 152, BMI 34.2,
# cholesterol 245) and a prior-PCP problem list of HTN, obesity, and
# hyperlipidemia — no diabetes diagnosis yet.  We apply rule_dm2 and
# show:
#   (1) It fires, adding a DM2 Assessment + Finding + Diagnosis + Problem.
#   (2) A second firing is blocked by the NAC — DM2 Problem is now present.
#   (3) Adding a follow-up HbA1c three months later does NOT reopen firing;
#       the NAC checks for any DM2 Problem, not for new observations.

include("rule_dm2_core.jl")
include("state_builders.jl")
include("viz_helpers.jl")

println("="^60)

# ---------- step 0: initial patient state ----------
state_0 = build_vignette()
println("step 0 — initial patient state built")
println("  Observations: $(nparts(state_0, :Observation))")
println("  Problems:     $(nparts(state_0, :Problem))")
println("  Codes:        $(nparts(state_0, :Code))")

save_svg("vignette_dm2/predicates.svg",      predicates_view(rule.preds))
save_svg("vignette_dm2/00_initial.svg",      full_view(state_0))
save_svg("vignette_dm2/00_initial_full.svg", everything_view(state_0))

# ---------- step 1: first application of the rule ----------
status_1, state_1 = fire(rule, state_0)
println("\nstep 1 — apply rule_dm2 → $status_1")
if status_1 === :fired
    println("  +1 Assessment, +1 Finding, +1 Diagnosis, +1 Problem (DM2)")
    println("  post-fire: Obs=$(nparts(state_1, :Observation)) " *
            "Assm=$(nparts(state_1, :Assessment)) " *
            "Diag=$(nparts(state_1, :Diagnosis)) " *
            "Prob=$(nparts(state_1, :Problem))")
end

save_svg("vignette_dm2/01_after_fire.svg",      full_view(state_1))
save_svg("vignette_dm2/01_after_fire_full.svg", everything_view(state_1))
save_svg("vignette_dm2/00_01_ba.svg",           before_after_view(state_0, state_1))
save_svg("vignette_dm2/00_01_ba_detailed.svg",  before_after_view_detailed(state_0, state_1))

# ---------- step 2: try to re-fire ----------
status_2, state_2 = fire(rule, state_1)
println("\nstep 2 — re-fire rule_dm2 on the result → $status_2")
if status_2 === :nac_violated
    println("  NAC blocked firing — DM2 Problem already on list.")
end

# ---------- step 3: add a follow-up HbA1c three months later ----------
follow_up = DateTime("2026-07-23T10:30:00")
state_3 = deepcopy(state_2)
add_observation!(state_3;
    code_system  = "http://loinc.org",
    code_value   = "4548-4",
    code_display = "Hemoglobin A1c",
    magnitude    = 10.2,
    unit         = "%",
    time         = follow_up)
println("\nstep 3 — added follow-up HbA1c (10.2%) three months later")

status_3, _ = fire(rule, state_3)
println("  apply rule_dm2 → $status_3")
if status_3 === :nac_violated
    println("  still blocked — NAC checks Problem presence, not Observation count.")
end

save_svg("vignette_dm2/03_with_followup.svg",      full_view(state_3))
save_svg("vignette_dm2/03_with_followup_full.svg", everything_view(state_3))

println("\n" * "="^60)
println("summary: rule fired once, refused to re-fire twice " *
        "(once after adding a fresh HbA1c).")
