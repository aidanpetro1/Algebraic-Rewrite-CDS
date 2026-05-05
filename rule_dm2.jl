# rule_dm2.jl — scenario matrix + visualization for the DM2 rule.
#
# The rule itself is defined in rule_dm2_core.jl. Scenario states are
# built via state_builders.build_hba1c_scenario.

include("rule_dm2_core.jl")
include("state_builders.jl")
include("viz_helpers.jl")

# ========================== 4-scenario matrix ==========================
# {HbA1c ≥ 6.5, HbA1c < 6.5} × {DM2 on problem list, not}

scenarios = [
    (:high_clear,   build_hba1c_scenario(; hba1c=9.8, with_dm2=false)),
    (:high_blocked, build_hba1c_scenario(; hba1c=9.8, with_dm2=true)),
    (:low_clear,    build_hba1c_scenario(; hba1c=5.2, with_dm2=false)),
    (:low_blocked,  build_hba1c_scenario(; hba1c=5.2, with_dm2=true)),
]

# rule-level viz (scenario-independent)
save_svg("rule_dm2/span.svg",          rule_view(underlying_rule(rule)))
save_svg("rule_dm2/span_detailed.svg", rule_view_detailed(underlying_rule(rule)))
save_svg("rule_dm2/N.svg",             everything_view(N))
save_svg("rule_dm2/predicates.svg",    predicates_view(rule.preds))

println("-"^60)
for (name, st) in scenarios
    status, result = fire(rule, st)
    println(rpad(string(name), 14), " → ", status)

    dir = "rule_dm2/$name"
    save_svg("$dir/before_compact.svg", full_view(st))
    save_svg("$dir/before_full.svg",    everything_view(st))
    if status === :fired
        save_svg("$dir/after_compact.svg", full_view(result))
        save_svg("$dir/after_full.svg",    everything_view(result))
        save_svg("$dir/ba.svg",            before_after_view(st, result))
        save_svg("$dir/ba_detailed.svg",   before_after_view_detailed(st, result))
    end
end
println("-"^60)
