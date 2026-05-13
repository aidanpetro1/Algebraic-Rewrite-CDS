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
# NOTE: _CORE_OBS is hardcoded to the ClinicalState schema's combinatorial
# Ob names. When we eventually support multiple schemas, replace it with a
# runtime lookup via `objects(acset_schema(...))`.

using Catlab
using AlgebraicRewriting

@eval AlgebraicRewriting.CategoricalAlgebra.CSets import Base: collect
@eval AlgebraicRewriting.Rewrite.Constraints    import Base: collect

# Updated for the FHIR-shaped schema: no externalized Code/Value/Status/Time.
# Includes every Ob in SchClinicalState that can carry a rule/NAC node;
# extension_exists pins only those Obs whose L-rows are in the morphism
# domain. Add new Obs here whenever you grow the schema.
const _CORE_OBS = (:Observation, :Condition, :ClinicalImpression,
                   :MedicationRequest, :Appointment, :Encounter,
                   :Finding, :Diagnosis,
                   :MedReason, :ApptBasedOn)

# Does a morphism h: N → G exist extending m: L → G along n: L → N?
# i.e., is there h with h ∘ n = m? Implemented as a constrained
# homomorphism search where the L-image in N is pinned to m's image.
# Returns the witness h when one exists, `nothing` otherwise — callers
# can introspect h to surface "blocked because <row> exists" details.
function extension_witness(n::ACSetTransformation, m::ACSetTransformation)
    L_ = dom(n); N_ = codom(n); G_ = codom(m)
    pairs = []
    for ob in _CORE_OBS
        nparts(L_, ob) > 0 || continue
        d = Dict{Int,Int}(n[ob](i) => m[ob](i) for i in parts(L_, ob))
        push!(pairs, ob => d)
    end
    homomorphism(N_, G_; initial=NamedTuple(pairs))
end
extension_exists(n::ACSetTransformation, m::ACSetTransformation) =
    !isnothing(extension_witness(n, m))

# Pure-CT AppCond(n, positive) semantics. Returns true iff the AC is
# VIOLATED (i.e., the match m should be blocked):
#   - positive=false (NAC): violated iff an extension exists
#   - positive=true  (PAC): violated iff no extension exists
appcond_violated(n::ACSetTransformation, m::ACSetTransformation; positive::Bool) =
    positive ? !extension_exists(n, m) : extension_exists(n, m)

# Per-Ob list of attribute slots to surface in the "blocked because…"
# detail. Picked to identify the row clinically — codes for matching,
# clinical status / date for context, dropped raw IDs and zero-value
# numerics that don't help debugging.
const _VIOLATOR_ATTRS = Dict(
    :Observation        => (:obsCodeValue, :obsCodeDisplay, :obsValueMagnitude, :obsValueUnit, :obsEffective),
    :Condition          => (:condCodeValue, :condCodeDisplay, :condClinicalStatus, :condRecordedDate),
    :ClinicalImpression => (:ciStatus, :ciDate),
    :MedicationRequest  => (:mrCodeValue, :mrCodeDisplay, :mrStatus),
    :Appointment        => (:apptCodeValue, :apptCodeDisplay, :apptStatus, :apptStart),
    :Encounter          => (:encCodeValue, :encCodeDisplay, :encStatus, :encStart),
)

# Format a "blocked because…" detail by introspecting the witness
# homomorphism h: N → G. We pick the first row in N that's NOT in
# n's image (i.e., the "extra" forbidden context), follow h to find
# the corresponding G row, and dump a curated set of its attributes.
# Falls back to a generic NAC label if no extra row is present
# (degenerate NAC where N == L) or the Ob isn't in the diagnostic map.
function _describe_violator(n::ACSetTransformation, h::ACSetTransformation, nac_index::Int)
    L_ = dom(n); N_ = codom(n); G_ = codom(h)
    for ob in _CORE_OBS
        haskey(_VIOLATOR_ATTRS, ob) || continue
        nparts(N_, ob) > 0 || continue
        # L's image in N — every L-row maps to one of these.
        l_image = nparts(L_, ob) > 0 ? Set(n[ob](i) for i in parts(L_, ob)) : Set{Int}()
        for ni in parts(N_, ob)
            ni in l_image && continue
            # `ni` is an N-row not in L's image — this is the "extra"
            # NAC context. h maps it to a row in G.
            gi = h[ob](ni)
            parts_str = String[]
            for sub in _VIOLATOR_ATTRS[ob]
                v = G_[gi, sub]
                # Skip empty / sentinel values that don't help debugging.
                v isa AbstractString && isempty(v) && continue
                v isa Real && v == 0 && continue
                v isa Dates.DateTime && v == DateTime(0) && continue
                push!(parts_str, "$(string(sub))=$(v)")
            end
            attr_str = isempty(parts_str) ? "" : " (" * join(parts_str, ", ") * ")"
            return "NAC #$nac_index — blocked because $(string(ob))$attr_str already exists in patient state"
        end
    end
    return "NAC #$nac_index"
end

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
# higher-layer wrappers). Returns (status, m, detail) on success
# (status=:matched, detail="") or on failure (m=nothing, detail=
# human-readable reason like "NAC #1" / "PAC #2"). Detail is surfaced
# in the server's response so the UI can show users WHICH application
# condition blocked the fire, instead of just "blocked by NAC".
function _find_valid_match(r::RuleWithACs, state)
    L_pattern = codom(r.rule.L)
    m = homomorphism(L_pattern, state; any=true)
    isnothing(m) && return (:no_match, nothing, "L pattern not matched in host state")
    for (i, (morph, is_pos)) in enumerate(r.acs)
        if is_pos
            # PAC: violated when no extension exists. We don't have a
            # witness to introspect (none exists, by definition), so
            # the detail is just a label.
            if !extension_exists(morph, m)
                return (:pac_unmet, nothing, "PAC #$i")
            end
        else
            # NAC: violated when an extension DOES exist. The witness
            # `h: N → G` tells us exactly which patient row triggered
            # the block — surface that in the detail string.
            h = extension_witness(morph, m)
            if !isnothing(h)
                return (:nac_violated, nothing, _describe_violator(morph, h, i))
            end
        end
    end
    (:matched, m, "")
end

function fire(r::RuleWithACs, state)
    status, m, detail = _find_valid_match(r, state)
    status === :matched || return (status, state, detail)
    (:fired, rewrite_match(r.rule, m), "")
end
