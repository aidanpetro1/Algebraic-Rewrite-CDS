# cds_rule.jl — shared infrastructure for CDS rules.
#
# Provides:
#   RuleWithACs     wrapper bundling a Rule with application conditions
#                   (NACs + PACs) and attribute predicates
#   fire            apply a RuleWithACs to a state; returns (:status, state)
#   extension_exists, appcond_violated   pure-CT AppCond(n, positive) semantics
#
# Also installs workaround patches for two upstream AlgebraicRewriting bugs
# (missing `using Base: collect` imports in two submodules).
#
# NOTE: _CORE_OBS is hardcoded to the ClinicalStateMulti schema's
# combinatorial Ob names. When we eventually support multiple schemas,
# replace it with a runtime lookup via `objects(acset_schema(...))`.

using Catlab
using AlgebraicRewriting

@eval AlgebraicRewriting.CategoricalAlgebra.CSets import Base: collect
@eval AlgebraicRewriting.Rewrite.Constraints    import Base: collect

const _CORE_OBS = (:Observation, :Assessment, :Problem, :Finding, :Diagnosis,
                    :Code, :Value, :Status, :Time)

# Does a morphism h: N → G exist extending m: L → G along n: L → N?
# i.e., is there h with h ∘ n = m? Implemented as a constrained
# homomorphism search where the L-image in N is pinned to m's image.
function extension_exists(n::ACSetTransformation, m::ACSetTransformation)
    L_ = dom(n); N_ = codom(n); G_ = codom(m)
    pairs = []
    for ob in _CORE_OBS
        nparts(L_, ob) > 0 || continue
        d = Dict{Int,Int}(n[ob](i) => m[ob](i) for i in parts(L_, ob))
        push!(pairs, ob => d)
    end
    !isnothing(homomorphism(N_, G_; initial=NamedTuple(pairs)))
end

# Pure-CT AppCond(n, positive) semantics. Returns true iff the AC is
# VIOLATED (i.e., the match m should be blocked):
#   - positive=false (NAC): violated iff an extension exists
#   - positive=true  (PAC): violated iff no extension exists
appcond_violated(n::ACSetTransformation, m::ACSetTransformation; positive::Bool) =
    positive ? !extension_exists(n, m) : extension_exists(n, m)

# Wrapper bundling a Rule with its (purely categorical) application
# conditions — NACs and PACs. Attribute-value predicates are NOT part
# of this layer; they live in cds_predicates.jl as a separate `CDSRule`
# wrapper that composes around a `RuleWithACs`.
#
#   RuleWithACs(rule; nacs=[n1], pacs=[p1])
# is equivalent to
#   Rule{:DPO}(l, r; ac=[AppCond(n1, false), AppCond(p1, true)])
# once upstream AlgebraicRewriting's pipelines are unblocked.
struct RuleWithACs
    rule::Rule
    acs::Vector{Tuple{ACSetTransformation, Bool}}   # (morphism, is_positive)
end

function RuleWithACs(rule::Rule;
                     nacs=ACSetTransformation[],
                     pacs=ACSetTransformation[])
    acs = Tuple{ACSetTransformation, Bool}[]
    for n in nacs; push!(acs, (n, false)); end
    for p in pacs; push!(acs, (p, true));  end
    RuleWithACs(rule, acs)
end

# The underlying Catlab Rule — for dispatch from visualization helpers
# and from layered wrappers like CDSRule.
underlying_rule(r::RuleWithACs) = r.rule

# Match + AC validity check (shared by fire for RuleWithACs and any
# higher-layer wrappers). Returns (:matched, m) on success or a reason
# tag plus nothing on failure.
function _find_valid_match(r::RuleWithACs, state)
    L_pattern = codom(r.rule.L)
    m = homomorphism(L_pattern, state; any=true)
    isnothing(m) && return (:no_match, nothing)
    for (morph, is_pos) in r.acs
        if appcond_violated(morph, m; positive=is_pos)
            return (is_pos ? :pac_unmet : :nac_violated, nothing)
        end
    end
    (:matched, m)
end

function fire(r::RuleWithACs, state)
    status, m = _find_valid_match(r, state)
    status === :matched || return (status, state)
    (:fired, rewrite_match(r.rule, m))
end
