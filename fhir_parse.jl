# fhir_parse.jl — parse a FHIR R4 Bundle (Dict-shaped) into a CState.
#
# Inverse of acset_to_fhir. With the FHIR-shaped schema there's nothing
# to externalize — every FHIR field maps directly to one CState attribute
# slot. The parser is essentially a Bundle-walk that allocates one ACSet
# row per resource entry.
#
# Cross-resource references inside ClinicalImpression.finding[].itemReference
# and ClinicalImpression.problem[].reference resolve via Bundle.entry.
# fullUrl in a fullUrl→row-index map. Two-pass so a ClinicalImpression
# can reference resources defined later in the Bundle.
#
# Public API:
#   fhir_to_acset(bundle) -> CState

include("clinical_state_multi.jl")
include("state_builders.jl")

using Catlab
using Dates

_first_coding(cc) = first(cc["coding"])

# Defensive: serializers vary on whether "display" is emitted; treat as ""
# when missing rather than blowing up.
_get_display(c) = get(c, "display", "")

function _parse_observation_entry!(state::CState, resource, fullurl::String,
                                    obs_index::Dict{String,Int})
    coding = _first_coding(resource["code"])

    # valueQuantity is optional; if absent or partial, fall back to sentinels.
    val = get(resource, "valueQuantity", Dict{String,Any}())
    mag_raw = get(val, "value", nothing)
    magnitude = mag_raw === nothing ? 0.0 : Float64(mag_raw)
    unit = String(get(val, "unit", ""))

    status = String(get(resource, "status", ""))

    eff_str = String(get(resource, "effectiveDateTime", ""))
    time = isempty(eff_str) ? DateTime(0) : DateTime(eff_str)

    oi = add_observation!(state;
        code_system  = String(coding["system"]),
        code_value   = String(coding["code"]),
        code_display = String(_get_display(coding)),
        magnitude    = magnitude,
        unit         = unit,
        status       = status,
        time         = time)
    obs_index[fullurl] = oi
end

function _parse_condition_entry!(state::CState, resource, fullurl::String,
                                  cond_index::Dict{String,Int})
    coding = _first_coding(resource["code"])

    # clinicalStatus is optional in FHIR R4 and some authoring flows leave
    # it blank — default to empty string rather than blowing up the parse.
    status_code = ""
    if haskey(resource, "clinicalStatus")
        cs_arr = get(resource["clinicalStatus"], "coding", [])
        if !isempty(cs_arr)
            status_code = String(get(cs_arr[1], "code", ""))
        end
    end

    # recordedDate similarly — fall back to a sentinel if missing/empty so
    # the schema's TimeAttr stays inhabited.
    rec_str = String(get(resource, "recordedDate", ""))
    rec = isempty(rec_str) ? DateTime(0) : DateTime(rec_str)

    ci = add_condition!(state;
        code_system     = String(coding["system"]),
        code_value      = String(coding["code"]),
        code_display    = String(_get_display(coding)),
        clinical_status = status_code,
        time            = rec)
    cond_index[fullurl] = ci
end

function _parse_clinical_impression_entry!(state::CState, resource,
                                            fullurl::String,
                                            ci_index::Dict{String,Int})
    status = String(get(resource, "status", ""))
    date_str = String(get(resource, "date", ""))
    time = isempty(date_str) ? DateTime(0) : DateTime(date_str)
    ai = add_clinical_impression!(state; status=status, time=time)
    ci_index[fullurl] = ai
end

# MedicationRequest. The UI emits `medication` as a top-level string; the
# Julia serializer round-trips it as medicationCodeableConcept.coding[0].display.
# Accept both shapes so a hand-authored Bundle works either way.
function _parse_medication_request_entry!(state::CState, resource,
                                           fullurl::String,
                                           mr_index::Dict{String,Int})
    status = String(get(resource, "status", "active"))
    intent = String(get(resource, "intent", "order"))

    # Pull (system, code, display) from medicationCodeableConcept.coding[0].
    # Falls back to a flat top-level `medication` string for legacy
    # bundles — display gets the string, system/code stay empty.
    code_sys = ""; code_val = ""; code_disp = ""
    cc = get(resource, "medicationCodeableConcept", nothing)
    if cc !== nothing
        coding_arr = get(cc, "coding", [])
        if !isempty(coding_arr)
            code_sys  = String(get(coding_arr[1], "system",  ""))
            code_val  = String(get(coding_arr[1], "code",    ""))
            code_disp = String(get(coding_arr[1], "display", ""))
        end
    end
    if isempty(code_disp)
        code_disp = String(get(resource, "medication", ""))
    end

    # Dosage: dosageInstruction[0].text is the FHIR shape; flat `dosage`
    # is the legacy fallback.
    dosage_str = ""
    di = get(resource, "dosageInstruction", [])
    if !isempty(di)
        dosage_str = String(get(di[1], "text", ""))
    end
    if isempty(dosage_str)
        dosage_str = String(get(resource, "dosage", ""))
    end

    mri = add_medication_request!(state;
        code_system  = code_sys,
        code_value   = code_val,
        code_display = code_disp,
        status       = status,
        intent       = intent,
        dosage       = dosage_str)
    mr_index[fullurl] = mri
end

function _parse_encounter_entry!(state::CState, resource, fullurl::String,
                                  enc_index::Dict{String,Int})
    status = String(get(resource, "status", ""))
    klass  = String(get(resource, "class",  ""))

    # Period.start / .end are nested in FHIR R4. Accept both nested and
    # the legacy flat top-level shape (some hand-authored bundles flatten).
    period = get(resource, "period", Dict())
    start_str = String(get(period, "start", get(resource, "start", "")))
    end_str   = String(get(period, "end",   get(resource, "end",   "")))
    start_t = isempty(start_str) ? DateTime(0) : DateTime(start_str)
    end_t   = isempty(end_str)   ? DateTime(0) : DateTime(end_str)

    # type[0].coding[0] carries the (system, code, display) triple.
    code_sys = ""; code_val = ""; code_disp = ""
    type_arr = get(resource, "type", [])
    if !isempty(type_arr)
        coding_arr = get(type_arr[1], "coding", [])
        if !isempty(coding_arr)
            code_sys  = String(get(coding_arr[1], "system",  ""))
            code_val  = String(get(coding_arr[1], "code",    ""))
            code_disp = String(get(coding_arr[1], "display", ""))
        end
    end

    ei = add_encounter!(state;
        status       = status,
        class        = klass,
        start        = start_t,
        stop         = end_t,
        code_system  = code_sys,
        code_value   = code_val,
        code_display = code_disp)
    enc_index[fullurl] = ei
end

function _parse_appointment_entry!(state::CState, resource, fullurl::String,
                                    appt_index::Dict{String,Int})
    status = String(get(resource, "status", ""))
    start_str = String(get(resource, "start", ""))
    end_str   = String(get(resource, "end",   ""))
    start_t = isempty(start_str) ? DateTime(0) : DateTime(start_str)
    end_t   = isempty(end_str)   ? DateTime(0) : DateTime(end_str)

    # Pull the (system, code, display) triple from serviceType[0].coding[0].
    # Falls back to the legacy top-level "display" string if a hand-authored
    # bundle skips serviceType — keeps the demo Bundles loading cleanly.
    code_sys = ""; code_val = ""; code_disp = ""
    st_arr = get(resource, "serviceType", [])
    if !isempty(st_arr)
        coding_arr = get(st_arr[1], "coding", [])
        if !isempty(coding_arr)
            code_sys  = String(get(coding_arr[1], "system",  ""))
            code_val  = String(get(coding_arr[1], "code",    ""))
            code_disp = String(get(coding_arr[1], "display", ""))
        end
    end
    if isempty(code_disp)
        code_disp = String(get(resource, "display", ""))
    end

    ai = add_appointment!(state;
        status       = status,
        start        = start_t,
        stop         = end_t,
        code_system  = code_sys,
        code_value   = code_val,
        code_display = code_disp)
    appt_index[fullurl] = ai
end

# Tolerate either cardinality: a single Reference {} or a Reference[].
# Strict FHIR R4 says these fields are 0..*, but UIs sometimes collapse
# single-element arrays to a bare object. Returning a Vector here lets
# downstream linkers iterate uniformly without dispatching on shape.
function _refs_array(maybe)
    if maybe isa AbstractDict
        return [maybe]
    elseif maybe isa AbstractVector
        return maybe
    else
        return []
    end
end

# Second-pass linkers: now that every Condition/MedReq/Appointment has a
# row, resolve cross-resource References as junction rows.
function _link_med_reasons!(state::CState, resource,
                             mri::Int,
                             cond_index::Dict{String,Int})
    for r in _refs_array(get(resource, "reasonReference", nothing))
        ref = String(get(r, "reference", ""))
        haskey(cond_index, ref) || continue
        link_med_reason!(state; request=mri, condition=cond_index[ref])
    end
end

function _link_appt_based_on!(state::CState, resource,
                               ai::Int,
                               cond_index::Dict{String,Int})
    for r in _refs_array(get(resource, "basedOn", nothing))
        ref = String(get(r, "reference", ""))
        haskey(cond_index, ref) || continue
        link_appt_based_on!(state; appointment=ai, condition=cond_index[ref])
    end
end

# Second-pass linker: now that every Observation and Condition has a row,
# resolve the ClinicalImpression's finding/problem references.
function _link_clinical_impression!(state::CState, resource,
                                     ai::Int,
                                     obs_index::Dict{String,Int},
                                     cond_index::Dict{String,Int})
    for f in get(resource, "finding", [])
        ref = String(f["itemReference"]["reference"])
        oi = obs_index[ref]
        link_finding!(state; impression=ai, observation=oi)
    end
    for p in get(resource, "problem", [])
        ref = String(p["reference"])
        ci = cond_index[ref]
        link_diagnosis!(state; impression=ai, condition=ci)
    end
end

"""
    fhir_to_acset(bundle) -> CState

Parse a FHIR R4 Bundle (Dict-shaped, type=collection) into a CState.
Allocates one row per resource entry; resolves ClinicalImpression's
finding[] and problem[] references in a second pass.

Conditions whose category is not problem-list-item are skipped (only
problem-list Conditions map to the schema's Condition Ob). Other
resource types are silently skipped — the schema doesn't have homes
for them yet.
"""
function fhir_to_acset(bundle)
    state = empty_state()
    obs_index  = Dict{String,Int}()
    cond_index = Dict{String,Int}()
    ci_index   = Dict{String,Int}()
    mr_index   = Dict{String,Int}()
    appt_index = Dict{String,Int}()
    enc_index  = Dict{String,Int}()

    impressions = Tuple{Any,Int}[]
    medreqs     = Tuple{Any,Int}[]
    appts       = Tuple{Any,Int}[]

    for entry in bundle["entry"]
        resource = entry["resource"]
        fullurl  = String(entry["fullUrl"])
        rt = String(resource["resourceType"])

        if rt == "Observation"
            _parse_observation_entry!(state, resource, fullurl, obs_index)
        elseif rt == "Condition"
            cats = get(resource, "category", [])
            is_problem = any(cats) do cat
                any(get(cat, "coding", [])) do c
                    String(get(c, "code", "")) == "problem-list-item"
                end
            end
            is_problem && _parse_condition_entry!(state, resource, fullurl, cond_index)
        elseif rt == "ClinicalImpression"
            _parse_clinical_impression_entry!(state, resource, fullurl, ci_index)
            push!(impressions, (resource, ci_index[fullurl]))
        elseif rt == "MedicationRequest"
            _parse_medication_request_entry!(state, resource, fullurl, mr_index)
            push!(medreqs, (resource, mr_index[fullurl]))
        elseif rt == "Appointment"
            _parse_appointment_entry!(state, resource, fullurl, appt_index)
            push!(appts, (resource, appt_index[fullurl]))
        elseif rt == "Encounter"
            _parse_encounter_entry!(state, resource, fullurl, enc_index)
        end
    end

    # Two-pass linking — references can target Conditions defined later
    # in the bundle than the resource that points to them.
    for (resource, ai) in impressions
        _link_clinical_impression!(state, resource, ai, obs_index, cond_index)
    end
    for (resource, mri) in medreqs
        _link_med_reasons!(state, resource, mri, cond_index)
    end
    for (resource, ai) in appts
        _link_appt_based_on!(state, resource, ai, cond_index)
    end

    state
end
