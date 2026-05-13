# cds_predicates.jl — attribute-value predicate layer on top of the
# categorical RuleWithACs (defined in cds_rule.jl).
#
# A predicate is a Julia function `match -> Bool` evaluated after the
# structural match + AC check succeeds. This is the "logical layer":
# it operates on concrete attribute values in the host state and is not
# expressible as a homomorphism-level constraint in plain ACSet
# categorical machinery.
#
# In the FHIR-shaped schema, Code/Value/Status are no longer separate Obs;
# they live as inlined attributes on Observation/Condition/etc. So the
# predicate evaluator reads them off the resource directly:
#   G[obs_idx, :obsCodeSystem], G[obs_idx, :obsValueMagnitude], etc.
#
# Every AttrPredicate is mechanically translatable to FHIRPath
# (the planned serialization format for predicates inside rule Bundles):
#   AttrPredicate("http://loinc.org", "4548-4", "Hemoglobin A1c",
#                 :obsValueMagnitude, ≥, 6.5)
# becomes
#   Observation.code.coding.where(system='http://loinc.org' and code='4548-4').exists()
#     and Observation.valueQuantity.value >= 6.5

include("cds_rule.jl")

# ================= AttrPredicate =================
# A callable struct carrying its own specification, so it can be
# introspected, described, rendered, and serialized to FHIRPath.
# Verifies that L's Observation#1 has the given (code_system, code_value)
# and that the named attribute satisfies `op(value, threshold)`.
struct AttrPredicate <: Function
    code_system::String
    code_value::String
    code_display::String   # human-readable label, used by describe()
    attr::Symbol           # e.g. :obsValueMagnitude
    op::Function           # e.g. ≥, <, ==
    threshold::Any
end

function (p::AttrPredicate)(m)
    G = codom(m)
    L = dom(m)
    # Find the L observation whose literal codes match the predicate's
    # (code_system, code_value), then evaluate the threshold against the
    # corresponding G row via m. Previously this hardcoded obs index 1,
    # which broke rules with multiple Observations in L because every
    # predicate would check the same matched obs regardless of which obs
    # the predicate's code identified.
    for L_oi in parts(L, :Observation)
        sys = L[L_oi, :obsCodeSystem]
        cod = L[L_oi, :obsCodeValue]
        # Skip L observations whose codes are AttrVars (general patterns);
        # only literal codes can be matched against the predicate's codes.
        sys isa AttrVar && continue
        cod isa AttrVar && continue
        if sys == p.code_system && cod == p.code_value
            G_oi = m[:Observation](L_oi)
            return p.op(G[G_oi, p.attr], p.threshold)
        end
    end
    # Predicate's target code didn't appear in L — treat as fail rather
    # than silently passing.
    return false
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
    status, m, detail = _find_valid_match(r.base, state)
    status === :matched || return (status, state, detail)
    for p in r.preds
        if !p(m)
            # describe() gives a human-readable predicate summary —
            # propagated to the UI so the user can see which specific
            # threshold blocked the fire.
            return (:pred_failed, state, describe(p))
        end
    end
    (:fired, rewrite_match(r.base.rule, m), "")
end
