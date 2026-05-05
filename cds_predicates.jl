# cds_predicates.jl — attribute-value predicate layer on top of the
# categorical RuleWithACs (defined in cds_rule.jl).
#
# A predicate is a Julia function `match -> Bool` evaluated after the
# structural match + AC check succeeds. This is the "logical layer":
# it operates on concrete attribute values in the host state and is
# not expressible as a homomorphism-level constraint in plain ACSet
# categorical machinery (see our earlier discussion on structural vs.
# semantic constraints).
#
# The design keeps the categorical layer (cds_rule.jl) unaware of
# predicates; `CDSRule` composes them around a `RuleWithACs`.

include("cds_rule.jl")

# ================= AttrPredicate =================
# A callable struct carrying its own specification, so it can be
# introspected, described, and rendered — not just executed.
# Verifies that L's Observation#1 has the given (code_system, code_value)
# and that L's Value#1.attr satisfies `op(value, threshold)`.
struct AttrPredicate <: Function
    code_system::String
    code_value::String
    code_display::String   # human-readable label, used by describe()
    attr::Symbol           # e.g. :valMagnitude
    op::Function           # e.g. ≥, <, ==
    threshold::Any
end

function (p::AttrPredicate)(m)
    G = codom(m)
    obs_idx  = m[:Observation](1)
    code_idx = G[obs_idx, :obsCode]
    # Verify system + value only; display is cosmetic metadata and not
    # checked at match time.
    G[code_idx, :codeSystem] == p.code_system || return false
    G[code_idx, :codeValue]  == p.code_value  || return false
    p.op(G[m[:Value](1), p.attr], p.threshold)
end

# Short abbreviation for common code systems, purely cosmetic for printing.
_system_short(s::String) =
    s == "http://loinc.org"         ? "LOINC" :
    s == "http://snomed.info/sct"   ? "SNOMED" :
    s

describe(p::AttrPredicate) =
    "$(p.code_display) [$(_system_short(p.code_system)):$(p.code_value)] → " *
    "$(p.attr) $(nameof(p.op)) $(p.threshold)"

describe(::Function) = "<closure>"   # fallback for raw-closure predicates

# ======================= CDSRule =======================
struct CDSRule
    base::RuleWithACs
    preds::Vector{Function}        # each: match -> Bool
end

CDSRule(base::RuleWithACs; preds=Function[]) = CDSRule(base, preds)

underlying_rule(r::CDSRule) = underlying_rule(r.base)

function fire(r::CDSRule, state)
    status, m = _find_valid_match(r.base, state)
    status === :matched || return (status, state)
    for p in r.preds
        p(m) || return (:pred_failed, state)
    end
    (:fired, rewrite_match(r.base.rule, m))
end
