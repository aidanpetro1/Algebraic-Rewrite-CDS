# viz_suite.jl — narrative visualization suite for the algebraic-CDS approach.
#
# Run as `julia viz_suite.jl`. The visuals are intentionally STRIPPED-DOWN —
# their job is to teach the L←K→R structure of clinical decision-support
# rules, not to expose the full ACSet bookkeeping. Code/Value/Status/Time
# objects are folded into Obs/Problem/Assessment labels; AttrVars are hidden
# (so the difference between L, K, and R shows up as which information is
# visible). Each rule's span is also split into one-file-per-leg under its
# own subdirectory so L, K, and R can be inspected individually.
#
# Outputs in out/suite/:
#   01_schema.svg               schema as a category
#   02_initial_state.svg        a patient state on that schema
#   03_rule_add/{L,K,R,combined}.svg     DM2-add rule, four files
#   04_rule_add_predicates.svg  HbA1c ≥ 6.5
#   05_rule_add_nac.svg         the negative application condition
#   06_step_add_ba.svg          before / after firing DM2-add
#   07_rule_resolve/{L,K,R,combined}.svg DM2-resolve rule (design-only)
#   08_rule_resolve_predicates.svg       HbA1c < 5.7
#   09_pathway.svg              longitudinal three-step pathway

include("rule_dm2_core.jl")
include("rule_dm2_resolve_core.jl")
include("state_builders.jl")
include("viz_helpers.jl")

const SUITE = "suite"

# 01 — schema
save_svg("$SUITE/01_schema.svg", schema_view())

# 02 — patient state (didactic, single ACSet)
state_initial = build_vignette()
save_svg("$SUITE/02_initial_state.svg", didactic_state_view(state_initial))

# 03 — DM2-add rule split into L / K / R / combined.
#      Pass rule.preds so L's HbA1c Obs displays "[≥ 6.5]" inline — the
#      trigger threshold reads off the picture without a separate predicate
#      file lookup.
let ur = underlying_rule(rule)
    save_span_split("$SUITE/03_rule_add", ur.L, ur.R; predicates=rule.preds)
end

# 04 — DM2-add predicates
save_svg("$SUITE/04_rule_add_predicates.svg", predicates_view(rule.preds))

# 05 — DM2-add NAC
save_svg("$SUITE/05_rule_add_nac.svg", didactic_nac_view(n; positive=false))

# 06 — DM2-add fires on the vignette (before / after)
status_add, state_after_add = fire(rule, state_initial)
status_add === :fired || error("DM2-add did not fire on vignette: $status_add")
save_svg("$SUITE/06_step_add_ba.svg",
         pathway_view([state_initial, state_after_add],
                      ["rule_dm2 fires"];
                      titles=["before", "after"]))

# 07 — DM2-resolve rule split (design-only — see rule_dm2_resolve_core.jl).
#      Pass the resolve predicate so L's HbA1c Obs shows "[< 5.7]" — together
#      with R's "Prob 1: DM2 (resolved)" the picture makes the trigger-and-
#      response chain obvious.
save_span_split("$SUITE/07_rule_resolve", l_resolve, r_resolve;
                predicates=[hba1c_resolve_pred])

# 08 — DM2-resolve predicate
save_svg("$SUITE/08_rule_resolve_predicates.svg",
         predicates_view([hba1c_resolve_pred]))

# 09 — longitudinal pathway: rule fires, then NAC blocks re-firing on
#      a follow-up observation.
p0 = build_hba1c_scenario(; hba1c=9.8, with_dm2=false)
status_p, p1 = fire(rule, p0)
status_p === :fired || error("path step 1 unexpected: $status_p")

p2 = deepcopy(p1)
add_observation!(p2;
    code_system  = "http://loinc.org",
    code_value   = "4548-4",
    code_display = "Hemoglobin A1c",
    magnitude    = 10.2,
    unit         = "%",
    time         = DateTime("2026-07-23T10:30:00"))

status_blocked, _ = fire(rule, p2)
status_blocked === :nac_violated ||
    error("expected NAC to block rule_dm2 on p2, got $status_blocked")

save_svg("$SUITE/09_pathway.svg",
    pathway_view([p0, p1, p2],
                 ["rule_dm2 fires",
                  "follow-up obs added → NAC blocks rule_dm2"];
                 titles=["initial: HbA1c high",
                         "after add: DM2 active",
                         "follow-up obs"]))

println("\n" * "="^60)
println("viz suite written to out/$SUITE/")
println("="^60)
