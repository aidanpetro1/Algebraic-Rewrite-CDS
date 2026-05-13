# fhir_to_rule.jl — phase-2 of the FHIR pipeline. Parse a rule FHIR Bundle
# (as emitted by the UI's lib/ruleBundle.ts) into a CDSRule.
#
# What this does:
#   1. Group bundle entries by their meta.tag leg codes (L | K | R | N1 | …).
#   2. Build one CState ACSet per leg. Primitive slots carrying our
#      template-variable extension become AttrVar(n) — same valueId in the
#      same leg gets the same index, per AttrType (StringAttr / FloatAttr /
#      TimeAttr).
#   3. Resolve morphisms l: K→L, r: K→R, n_i: L→Nᵢ via fullUrl identity
#      (an entry tagged in multiple legs with the same fullUrl is the same
#      resource across legs — that's the DPO span morphism encoding).
#   4. Parse the Basic manifest entry for FHIRPath predicates. For predicates
#      matching the recognized "Observation.code.coding.where(... ) and
#      Observation.valueQuantity.value OP X" shape we lift to AttrPredicate;
#      anything else we wrap as a stub that warns and returns true (FHIRPath
#      subset interpreter is phase 3).
#   5. Assemble RuleWithACs(Rule{:DPO}(l, r); nacs=[…]) → CDSRule(base; preds=[…]).
#
# Public entry point:
#   fhir_to_rule(bundle::Dict) -> CDSRule
#
# Conventions match docs/fhir_pipeline_design.md and the UI's wire format
# in ui/src/lib/ruleBundle.ts.

include("clinical_state_multi.jl")
include("cds_rule.jl")
include("cds_predicates.jl")

using Catlab
using AlgebraicRewriting
using Dates

# ---------- URN / extension constants (kept in sync with ruleBundle.ts) ----------

const _NS                = "http://algebraic-cds.org"
const RULE_LEG_SYSTEM    = "$_NS/rule-leg"
const URL_TEMPLATE_VAR   = "$_NS/StructureDefinition/template-variable"
const URL_PREDICATE      = "$_NS/StructureDefinition/predicate"
const RULE_MANIFEST_CODE = "$_NS/CodeSystem/rule-manifest"

# ---------- per-leg variable table ----------
# Same valueId → same AttrVar(idx) within a leg, indexed per AttrType so the
# ACSet schema's `StringAttr = N` declaration matches the variables actually
# used. Indices are 1-based per Catlab convention.

mutable struct VarTable
    string_vars::Dict{String,Int}
    float_vars::Dict{String,Int}
    time_vars::Dict{String,Int}
end
VarTable() = VarTable(Dict{String,Int}(), Dict{String,Int}(), Dict{String,Int}())

# Allocate or look up an AttrVar index for `name` of `kind` in this leg.
# When a fresh variable is allocated we ALSO grow the ACSet's AttrType
# count via add_part!(state, :StringAttr) — Catlab validates that any
# AttrVar(i) reference satisfies i ≤ nparts(state, AttrType), so without
# this the row insertion fires an internal assertion ("0 < getvalue(subpart)
# ≤ ACSetInterface.mpart…").
function _alloc_var!(vt::VarTable, kind::Symbol, name::String, state::CState)
    table = kind === :string ? vt.string_vars :
            kind === :float  ? vt.float_vars  :
            kind === :time   ? vt.time_vars   :
            error("unknown attr kind: $kind")
    return get!(table, name) do
        ob = kind === :string ? :StringAttr :
             kind === :float  ? :FloatAttr  :
             :TimeAttr
        add_part!(state, ob)
    end
end

# ---------- reading literals + template variables ----------
# FHIR's "primitive type extension" pattern: a slot named `field` may be
# replaced by a sibling object `_field` carrying extensions. When the slot
# carries our template-variable extension we treat it as a placeholder.

function _template_name(parent::Dict, field::String)
    key = "_" * field
    haskey(parent, key) || return nothing
    for ext in get(parent[key], "extension", [])
        get(ext, "url", "") == URL_TEMPLATE_VAR || continue
        v = get(ext, "valueId", nothing)
        v === nothing || return String(v)
    end
    return nothing
end

# Returns AttrVar (when the slot is a template-variable) or a literal of the
# right type. Missing or empty slots fall back to type-appropriate sentinels.
# `state` is threaded so _alloc_var! can grow the AttrType counts on demand.
function _read_string!(parent::Dict, field::String, vt::VarTable, state::CState)
    name = _template_name(parent, field)
    name !== nothing && return AttrVar(_alloc_var!(vt, :string, name, state))
    return String(get(parent, field, ""))
end

function _read_float!(parent::Dict, field::String, vt::VarTable, state::CState)
    name = _template_name(parent, field)
    name !== nothing && return AttrVar(_alloc_var!(vt, :float, name, state))
    raw = get(parent, field, nothing)
    raw === nothing && return 0.0
    raw isa AbstractString && isempty(raw) && return 0.0
    return Float64(raw)
end

function _read_time!(parent::Dict, field::String, vt::VarTable, state::CState)
    name = _template_name(parent, field)
    if name !== nothing
        # Special-case `${now}` — bind to the current wall-clock time at
        # rule-parse time (effectively fire time, since rules are parsed
        # per-request by cds_server.jl). Useful for recordedDate / date
        # fields on resources the rule *creates* — those should reflect
        # "diagnosed today" rather than echoing the matched obs's time.
        name == "now" && return Dates.now()
        return AttrVar(_alloc_var!(vt, :time, name, state))
    end
    raw = get(parent, field, nothing)
    raw === nothing && return DateTime(0)
    s = String(raw)
    return isempty(s) ? DateTime(0) : DateTime(s)
end

# Unwrap a CodeableConcept's first coding into (system, code, display)
# triples, each individually template-aware.
function _read_coding!(cc::Dict, vt::VarTable, state::CState)
    arr = get(cc, "coding", [])
    isempty(arr) && error("CodeableConcept missing coding[]")
    c = arr[1]
    sys = _read_string!(c, "system",  vt, state)
    cod = _read_string!(c, "code",    vt, state)
    dsp = haskey(c, "display") || haskey(c, "_display") ?
          _read_string!(c, "display", vt, state) : ""
    return sys, cod, dsp
end

# ---------- per-resource-type leg builders ----------
# Each builder allocates one ACSet row in `state` from a FHIR resource Dict
# and records its fullUrl → row index for later morphism resolution.

function _build_observation!(state::CState, resource::Dict, fullurl::String,
                              urlmap::Dict{String,Tuple{Symbol,Int}}, vt::VarTable)
    sys, cod, dsp = _read_coding!(resource["code"], vt, state)

    # valueQuantity is optional. When present we pass the dict to the
    # readers; when absent we still need typed sentinels so the schema
    # stays inhabited.
    vq = get(resource, "valueQuantity", Dict{String,Any}())
    mag  = _read_float!(vq,       "value",             vt, state)
    unit = _read_string!(vq,      "unit",              vt, state)

    status = _read_string!(resource, "status",            vt, state)
    eff    = _read_time!(resource,   "effectiveDateTime", vt, state)

    oi = add_part!(state, :Observation;
        obsCodeSystem     = sys,
        obsCodeValue      = cod,
        obsCodeDisplay    = dsp,
        obsValueMagnitude = mag,
        obsValueUnit      = unit,
        obsStatus         = status,
        obsEffective      = eff,
    )
    urlmap[fullurl] = (:Observation, oi)
end

function _build_condition!(state::CState, resource::Dict, fullurl::String,
                            urlmap::Dict{String,Tuple{Symbol,Int}}, vt::VarTable)
    sys, cod, dsp = _read_coding!(resource["code"], vt, state)

    # clinicalStatus is optional both in FHIR R4 and in our UI's authoring
    # flow — fall back to an empty literal (which won't be a placeholder)
    # rather than refusing to parse the rule.
    cstatus = if haskey(resource, "clinicalStatus")
        cs_arr = get(resource["clinicalStatus"], "coding", [])
        if isempty(cs_arr)
            ""
        else
            _read_string!(cs_arr[1], "code", vt, state)
        end
    else
        ""
    end

    # recordedDate likewise — sentinel DateTime if absent/empty.
    rec = if haskey(resource, "recordedDate") || haskey(resource, "_recordedDate")
        _read_time!(resource, "recordedDate", vt, state)
    else
        DateTime(0)
    end

    ci = add_part!(state, :Condition;
        condCodeSystem     = sys,
        condCodeValue      = cod,
        condCodeDisplay    = dsp,
        condClinicalStatus = cstatus,
        condRecordedDate   = rec,
    )
    urlmap[fullurl] = (:Condition, ci)
end

function _build_clinical_impression!(state::CState, resource::Dict, fullurl::String,
                                      urlmap::Dict{String,Tuple{Symbol,Int}}, vt::VarTable)
    status = _read_string!(resource, "status", vt, state)
    date   = _read_time!(resource,   "date",   vt, state)
    ai = add_part!(state, :ClinicalImpression;
        ciStatus = status,
        ciDate   = date,
    )
    urlmap[fullurl] = (:ClinicalImpression, ai)
end

# MedicationRequest leg builder. UI authors `medication` as a flat
# top-level string with optional template var; serializer round-trips it
# as medicationCodeableConcept.coding[0].display. Read both shapes so
# rules authored either way build cleanly.
function _build_medication_request!(state::CState, resource::Dict, fullurl::String,
                                     urlmap::Dict{String,Tuple{Symbol,Int}}, vt::VarTable)
    # medicationCodeableConcept.coding[0] holds the (system, code, display)
    # triple, each individually template-aware (matches Observation /
    # Condition shape). Falls back to a flat top-level `medication` for
    # hand-authored or legacy bundles.
    sys = ""; cod = ""; dsp = ""
    cc = get(resource, "medicationCodeableConcept", nothing)
    if cc !== nothing
        arr = get(cc, "coding", [])
        if !isempty(arr)
            c = arr[1]
            sys = _read_string!(c, "system",  vt, state)
            cod = _read_string!(c, "code",    vt, state)
            dsp = haskey(c, "display") || haskey(c, "_display") ?
                  _read_string!(c, "display", vt, state) : ""
        end
    end
    # Legacy flat-string fallback for the display slot.
    if dsp isa String && isempty(dsp) &&
       (haskey(resource, "medication") || haskey(resource, "_medication"))
        dsp = _read_string!(resource, "medication", vt, state)
    end

    status = _read_string!(resource, "status", vt, state)
    intent = _read_string!(resource, "intent", vt, state)

    di = get(resource, "dosageInstruction", [])
    dosage = if !isempty(di) && (haskey(di[1], "text") || haskey(di[1], "_text"))
        _read_string!(di[1], "text", vt, state)
    else
        haskey(resource, "dosage") || haskey(resource, "_dosage") ?
            _read_string!(resource, "dosage", vt, state) : ""
    end

    mri = add_part!(state, :MedicationRequest;
        mrCodeSystem  = sys,
        mrCodeValue   = cod,
        mrCodeDisplay = dsp,
        mrStatus      = status,
        mrIntent      = intent,
        mrDosage      = dosage,
    )
    urlmap[fullurl] = (:MedicationRequest, mri)
end

function _build_encounter!(state::CState, resource::Dict, fullurl::String,
                            urlmap::Dict{String,Tuple{Symbol,Int}}, vt::VarTable)
    status = _read_string!(resource, "status", vt, state)
    klass  = haskey(resource, "class") || haskey(resource, "_class") ?
             _read_string!(resource, "class", vt, state) : ""

    period = get(resource, "period", Dict())
    start_t = period isa AbstractDict && (haskey(period, "start") || haskey(period, "_start")) ?
              _read_time!(period, "start", vt, state) :
              haskey(resource, "start") || haskey(resource, "_start") ?
              _read_time!(resource, "start", vt, state) : DateTime(0)
    end_t   = period isa AbstractDict && (haskey(period, "end") || haskey(period, "_end")) ?
              _read_time!(period, "end", vt, state) :
              haskey(resource, "end") || haskey(resource, "_end") ?
              _read_time!(resource, "end", vt, state) : DateTime(0)

    sys = ""; cod = ""; dsp = ""
    type_arr = get(resource, "type", [])
    if !isempty(type_arr)
        coding_arr = get(type_arr[1], "coding", [])
        if !isempty(coding_arr)
            c = coding_arr[1]
            sys = _read_string!(c, "system",  vt, state)
            cod = _read_string!(c, "code",    vt, state)
            dsp = haskey(c, "display") || haskey(c, "_display") ?
                  _read_string!(c, "display", vt, state) : ""
        end
    end

    ei = add_part!(state, :Encounter;
        encStatus      = status,
        encClass       = klass,
        encStart       = start_t,
        encEnd         = end_t,
        encCodeSystem  = sys,
        encCodeValue   = cod,
        encCodeDisplay = dsp,
    )
    urlmap[fullurl] = (:Encounter, ei)
end

function _build_appointment!(state::CState, resource::Dict, fullurl::String,
                              urlmap::Dict{String,Tuple{Symbol,Int}}, vt::VarTable)
    status  = _read_string!(resource, "status",  vt, state)
    start_t = _read_time!(  resource, "start",   vt, state)
    end_t   = _read_time!(  resource, "end",     vt, state)

    # serviceType[0].coding[0] carries the (system, code, display) triple,
    # each individually template-aware (matches Observation/Condition).
    sys = ""; cod = ""; dsp = ""
    st_arr = get(resource, "serviceType", [])
    if !isempty(st_arr)
        coding_arr = get(st_arr[1], "coding", [])
        if !isempty(coding_arr)
            c = coding_arr[1]
            sys = _read_string!(c, "system",  vt, state)
            cod = _read_string!(c, "code",    vt, state)
            dsp = haskey(c, "display") || haskey(c, "_display") ?
                  _read_string!(c, "display", vt, state) : ""
        end
    end
    # Hand-authored bundles can skip serviceType and put a freeform
    # display at the top level — accept it as the codeDisplay fallback.
    if dsp isa String && isempty(dsp) && (haskey(resource, "display") || haskey(resource, "_display"))
        dsp = _read_string!(resource, "display", vt, state)
    end

    ai = add_part!(state, :Appointment;
        apptStatus      = status,
        apptStart       = start_t,
        apptEnd         = end_t,
        apptCodeSystem  = sys,
        apptCodeValue   = cod,
        apptCodeDisplay = dsp,
    )
    urlmap[fullurl] = (:Appointment, ai)
end

# Second-pass linkers — invoked after every entry in a leg has built
# its row, so cross-references can be resolved by fullUrl regardless of
# entry order. References targeting resources outside the leg are
# silently skipped (the engine only tracks within-leg structure;
# subject/encounter to Patient/Encounter pass through the UI).

function _link_clinical_impression!(state::CState, resource::Dict,
                                     ai::Int, urlmap::Dict{String,Tuple{Symbol,Int}})
    for f in get(resource, "finding", [])
        ref = String(f["itemReference"]["reference"])
        haskey(urlmap, ref) || error("finding ref $ref unresolved within leg")
        kind, oi = urlmap[ref]
        kind === :Observation || error("finding must reference Observation, got $kind")
        add_part!(state, :Finding; finImpression=ai, finObservation=oi)
    end
    for p in get(resource, "problem", [])
        ref = String(p["reference"])
        haskey(urlmap, ref) || error("problem ref $ref unresolved within leg")
        kind, ci = urlmap[ref]
        kind === :Condition || error("problem must reference Condition, got $kind")
        add_part!(state, :Diagnosis; diagImpression=ai, diagCondition=ci)
    end
end

# Tolerate either cardinality: single Reference {} or Reference[].
function _refs_array(maybe)
    if maybe isa AbstractDict
        return [maybe]
    elseif maybe isa AbstractVector
        return maybe
    else
        return []
    end
end

# MedicationRequest.reasonReference[] → Condition junction rows.
function _link_medication_request!(state::CState, resource::Dict,
                                    mri::Int, urlmap::Dict{String,Tuple{Symbol,Int}})
    for r in _refs_array(get(resource, "reasonReference", nothing))
        ref = String(get(r, "reference", ""))
        haskey(urlmap, ref) || continue
        kind, ci = urlmap[ref]
        kind === :Condition || continue
        add_part!(state, :MedReason; mrReasonRequest=mri, mrReasonCondition=ci)
    end
end

# Appointment.basedOn[] → Condition junction rows.
function _link_appointment!(state::CState, resource::Dict,
                             ai::Int, urlmap::Dict{String,Tuple{Symbol,Int}})
    for r in _refs_array(get(resource, "basedOn", nothing))
        ref = String(get(r, "reference", ""))
        haskey(urlmap, ref) || continue
        kind, ci = urlmap[ref]
        kind === :Condition || continue
        add_part!(state, :ApptBasedOn; abAppointment=ai, abCondition=ci)
    end
end

# ---------- leg construction ----------

# Read the leg codes off an entry's resource.meta.tag.
function _entry_legs(resource::Dict)::Vector{String}
    meta = get(resource, "meta", Dict())
    tags = get(meta, "tag", [])
    legs = String[]
    for t in tags
        get(t, "system", "") == RULE_LEG_SYSTEM || continue
        c = get(t, "code", nothing)
        c === nothing || push!(legs, String(c))
    end
    legs
end

# Build one leg's ACSet. Returns (state, urlmap) so the caller can
# cross-reference rows by fullUrl when constructing morphisms.
function _build_leg(entries_for_leg::Vector{Dict})
    state = empty_state()
    urlmap = Dict{String,Tuple{Symbol,Int}}()
    vt = VarTable()

    impressions_to_link = Tuple{Dict,Int}[]
    medreqs_to_link     = Tuple{Dict,Int}[]
    appts_to_link       = Tuple{Dict,Int}[]

    for entry in entries_for_leg
        resource = entry["resource"]
        fullurl  = String(entry["fullUrl"])
        rt = String(resource["resourceType"])
        if rt == "Observation"
            _build_observation!(state, resource, fullurl, urlmap, vt)
        elseif rt == "Condition"
            _build_condition!(state, resource, fullurl, urlmap, vt)
        elseif rt == "ClinicalImpression"
            _build_clinical_impression!(state, resource, fullurl, urlmap, vt)
            push!(impressions_to_link, (resource, urlmap[fullurl][2]))
        elseif rt == "MedicationRequest"
            _build_medication_request!(state, resource, fullurl, urlmap, vt)
            push!(medreqs_to_link, (resource, urlmap[fullurl][2]))
        elseif rt == "Appointment"
            _build_appointment!(state, resource, fullurl, urlmap, vt)
            push!(appts_to_link, (resource, urlmap[fullurl][2]))
        elseif rt == "Encounter"
            _build_encounter!(state, resource, fullurl, urlmap, vt)
        end
        # Other types (Patient/Encounter/...) silently skipped — they don't
        # have a home in the rule-runtime schema.
    end

    # Two-pass linking — references can target rows defined later in
    # the leg than the resource that points to them.
    for (resource, ai) in impressions_to_link
        _link_clinical_impression!(state, resource, ai, urlmap)
    end
    for (resource, mri) in medreqs_to_link
        _link_medication_request!(state, resource, mri, urlmap)
    end
    for (resource, ai) in appts_to_link
        _link_appointment!(state, resource, ai, urlmap)
    end

    state, urlmap
end

# ---------- morphism construction ----------
# Given source and target legs that share a set of fullUrls, derive the
# (Ob, src_row → tgt_row) mappings and feed them as `initial=` to
# Catlab's homomorphism finder. This pins the morphism to the fullUrl-
# encoded identity rather than letting homomorphism guess.

function _morphism(src::CState, tgt::CState,
                    src_urls::Dict{String,Tuple{Symbol,Int}},
                    tgt_urls::Dict{String,Tuple{Symbol,Int}})
    pairs_by_ob = Dict{Symbol,Dict{Int,Int}}()
    for (url, (kind_s, row_s)) in src_urls
        haskey(tgt_urls, url) || continue
        (kind_t, row_t) = tgt_urls[url]
        kind_s === kind_t || error("fullUrl $url mapped to different Obs in src/tgt: $kind_s vs $kind_t")
        d = get!(pairs_by_ob, kind_s) do; Dict{Int,Int}(); end
        d[row_s] = row_t
    end
    # Spread the per-Ob pinning dict as keyword args of a NamedTuple,
    # matching the shape Catlab's `homomorphism(...; initial=…)` expects.
    initial = (; pairs_by_ob...)
    h = homomorphism(src, tgt; monic=true, initial=initial)
    isnothing(h) && error("could not build morphism from leg with $(length(src_urls)) entries " *
                          "to leg with $(length(tgt_urls)) entries")
    h
end

# ---------- predicate parsing ----------
# Recognized FHIRPath shape (matches what the UI seeds for the DM2 rule):
#   Observation.code.coding.where(system='SYS' and code='COD').exists()
#     and Observation.valueQuantity.value OP X
# where OP is one of >= <= > < == !=. Anything else we wrap as a stub.

const _FHIRPATH_OBSERVATION_RX = r"""
    ^Observation\.code\.coding\.where\(
        system='([^']+)'\s+and\s+code='([^']+)'
    \)\.exists\(\)
    \s+and\s+
    Observation\.valueQuantity\.value
    \s*(>=|<=|>|<|==|!=)\s*
    ([\d.]+)\s*$
"""x

const _OP_MAP = Dict(
    ">="=>(>=), "<="=>(<=), ">"=>(>), "<"=>(<),
    "=="=>(==), "!="=>(!=),
)

# Convert one extension-block predicate (target/fhirpath/label) into a
# callable `match -> Bool`. Returns the function plus a description string
# for diagnostics.
function _parse_predicate(ext_block::Dict)
    inner = get(ext_block, "extension", [])
    target = ""; fhirpath = ""; label = ""
    for e in inner
        u = get(e, "url", "")
        if u == "target";   target   = String(get(e, "valueUri",    ""))
        elseif u == "fhirpath"; fhirpath = String(get(e, "valueString", ""))
        elseif u == "label";    label    = String(get(e, "valueString", ""))
        end
    end

    m = match(_FHIRPATH_OBSERVATION_RX, fhirpath)
    if m !== nothing
        sys, cod, op_str, num_str = m.captures
        op = _OP_MAP[op_str]
        threshold = parse(Float64, num_str)
        # Reuse the existing AttrPredicate so the engine path is identical
        # to hand-coded rules. display defaults to label for nicer printing.
        return AttrPredicate(String(sys), String(cod), label,
                             :obsValueMagnitude, op, threshold), label
    end

    # Fallback: stub. Warn once at parse time so the user knows the
    # predicate isn't being enforced.
    @warn "FHIRPath predicate not in recognized form — running as no-op stub" fhirpath label
    return ((m_) -> true), label
end

# ---------- public API ----------

"""
    fhir_to_rule(bundle::Dict) -> CDSRule

Parse a rule FHIR Bundle (as emitted by ruleBundle.ts) into a CDSRule.
The Bundle must:
- be `type=collection`
- carry one or more entries with `meta.tag` codes from
  `http://algebraic-cds.org/rule-leg`
- contain exactly one entry per leg-membership combination
- (optionally) carry a `Basic` manifest entry with predicate extensions

L, K, R must all be present. NACs (`N1`, `N2`, …) are optional.
"""
function fhir_to_rule(bundle::Dict)
    bundle["resourceType"] == "Bundle" || error("not a Bundle")
    entries = bundle["entry"]

    # Group entries by leg. `manifest` holds the Basic manifest entry (if any).
    by_leg = Dict{String,Vector{Dict}}()
    manifest::Union{Dict,Nothing} = nothing
    for entry in entries
        resource = entry["resource"]
        rt = String(get(resource, "resourceType", ""))
        if rt == "Basic"
            # Recognize the manifest by its CodeSystem; ignore other Basic.
            for c in get(get(resource, "code", Dict()), "coding", [])
                String(get(c, "system", "")) == RULE_MANIFEST_CODE || continue
                manifest = resource
                break
            end
            continue
        end
        for leg in _entry_legs(resource)
            push!(get!(by_leg, leg) do; Dict[]; end, entry)
        end
    end

    haskey(by_leg, "L") || error("rule Bundle missing L leg")
    haskey(by_leg, "K") || error("rule Bundle missing K leg")
    haskey(by_leg, "R") || error("rule Bundle missing R leg")

    # Build each leg's ACSet + url→row map.
    L_state, L_urls = _build_leg(by_leg["L"])
    K_state, K_urls = _build_leg(by_leg["K"])
    R_state, R_urls = _build_leg(by_leg["R"])

    # NAC legs: build each, then a morphism L → Nᵢ.
    nac_keys = sort([k for k in keys(by_leg) if startswith(k, "N")];
                    by = k -> parse(Int, k[2:end]))
    nac_morphisms = ACSetTransformation[]
    for nk in nac_keys
        N_state, N_urls = _build_leg(by_leg[nk])
        push!(nac_morphisms, _morphism(L_state, N_state, L_urls, N_urls))
    end

    l = _morphism(K_state, L_state, K_urls, L_urls)
    r = _morphism(K_state, R_state, K_urls, R_urls)

    base = RuleWithACs(Rule{:DPO}(l, r); nacs=nac_morphisms)

    # Predicates from the manifest.
    preds = Function[]
    if manifest !== nothing
        for ext in get(manifest, "extension", [])
            get(ext, "url", "") == URL_PREDICATE || continue
            pred, _label = _parse_predicate(ext)
            push!(preds, pred)
        end
    end

    CDSRule(base; preds=preds)
end
