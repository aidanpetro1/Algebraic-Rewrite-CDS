# fhir_serialize.jl — serialize a CState ACSet to a FHIR R4 Bundle.
#
# With the FHIR-shaped schema, every ACSet row is a single FHIR resource
# and every attribute is a FHIR field — no externalization to fold back
# in. Serialization is a near-direct projection. Round-trip is byte-equal.
#
# The output is a Dict{String,Any} shaped as a FHIR Bundle of
# type=collection. Caller serializes to JSON via JSON3 / JSON / similar.
#
# Bundle.entry.fullUrl is a deterministic UUIDv5 derived from resource
# kind + the row's CONTENT (code triple, time, status, …). It must NOT
# depend on the ACSet row index: AlgebraicRewriting's DPO doesn't
# preserve row indices across rewrites (new rows can prepend, freed
# slots can be recycled), so an index-keyed UUID flips identity between
# fires. Content-keyed UUIDs stay stable for the same logical resource
# across any number of fires, which is what the UI's merge depends on.
#
# Public API:
#   acset_to_fhir(state) -> Dict   FHIR Bundle
#   fhir_fullurl(kind, state, idx) -> String   urn:uuid:<v5> for (kind, row)

include("clinical_state_multi.jl")

using Catlab
using Dates
using UUIDs

# Stable namespace for Algebraic_CDS-generated UUIDs. Chosen once, fixed.
const _CDS_UUID_NAMESPACE = UUID("8a4b1f0e-3c2a-4d57-9f1e-5b3c2d1a0f9b")

"""
    _row_key(state, kind, idx) -> String

Content-based identity string for an ACSet row. The fields chosen are
those that distinguish two logical resources in the FHIR sense — the
code triple plus the time-of-event field. Two rows with the same key
ARE the same logical resource (and so should share a fullUrl). Two
rows with different keys are different resources.
"""
function _row_key(state::CState, kind::Symbol, idx::Int)::String
    if kind == :Observation
        # Effective time + magnitude disambiguate readings of the same
        # code (e.g., two SBP readings a month apart).
        return string(state[idx, :obsCodeSystem], "|",
                      state[idx, :obsCodeValue], "|",
                      state[idx, :obsEffective], "|",
                      state[idx, :obsValueMagnitude])
    elseif kind == :Condition
        # recordedDate disambiguates two same-code diagnoses recorded at
        # different times (e.g., recurrence after resolution).
        return string(state[idx, :condCodeSystem], "|",
                      state[idx, :condCodeValue], "|",
                      state[idx, :condRecordedDate], "|",
                      state[idx, :condClinicalStatus])
    elseif kind == :ClinicalImpression
        # CI has no code — its identity is the date plus the morphisms
        # (problems/findings) it links to. We only have access to local
        # attrs here, so date + status. Two CIs created in the same
        # millisecond would collide; in practice rule fires resolve
        # `${now}` to distinct timestamps.
        return string(state[idx, :ciDate], "|", state[idx, :ciStatus])
    elseif kind == :MedicationRequest
        return string(state[idx, :mrCodeSystem], "|",
                      state[idx, :mrCodeValue], "|",
                      state[idx, :mrStatus], "|",
                      state[idx, :mrIntent])
    elseif kind == :Appointment
        return string(state[idx, :apptCodeSystem], "|",
                      state[idx, :apptCodeValue], "|",
                      state[idx, :apptStart], "|",
                      state[idx, :apptStatus])
    elseif kind == :Encounter
        return string(state[idx, :encCodeSystem], "|",
                      state[idx, :encCodeValue], "|",
                      state[idx, :encStart], "|",
                      state[idx, :encStatus])
    else
        # Junctions and unknown types — no content keys defined, fall
        # back to index. These don't show up in Bundle.entry.fullUrl
        # anyway (they're encoded as nested arrays on their parents),
        # so the fallback is for safety, not for correctness.
        return "$(idx)"
    end
end

"""
    fhir_fullurl(kind::Symbol, state::CState, idx::Int) -> String

Deterministic Bundle.entry.fullUrl. Same content → same UUID, across
fires and across runs. Key is (kind, content) — see _row_key.
"""
fhir_fullurl(kind::Symbol, state::CState, idx::Int) =
    "urn:uuid:" * string(uuid5(_CDS_UUID_NAMESPACE,
        "$(kind)/$(_row_key(state, kind, idx))"))

# ---------- per-resource builders ----------

function _build_observation(state::CState, oi::Int)
    Dict{String,Any}(
        "resourceType" => "Observation",
        "status"       => state[oi, :obsStatus],
        "code" => Dict{String,Any}(
            "coding" => [Dict{String,Any}(
                "system"  => state[oi, :obsCodeSystem],
                "code"    => state[oi, :obsCodeValue],
                "display" => state[oi, :obsCodeDisplay],
            )],
        ),
        "valueQuantity" => Dict{String,Any}(
            "value" => state[oi, :obsValueMagnitude],
            "unit"  => state[oi, :obsValueUnit],
        ),
        "effectiveDateTime" => string(state[oi, :obsEffective]),
    )
end

function _build_condition(state::CState, ci::Int)
    Dict{String,Any}(
        "resourceType" => "Condition",
        "clinicalStatus" => Dict{String,Any}(
            "coding" => [Dict{String,Any}(
                "system" => "http://terminology.hl7.org/CodeSystem/condition-clinical",
                "code"   => state[ci, :condClinicalStatus],
            )],
        ),
        "category" => [Dict{String,Any}(
            "coding" => [Dict{String,Any}(
                "system" => "http://terminology.hl7.org/CodeSystem/condition-category",
                "code"   => "problem-list-item",
            )],
        )],
        "code" => Dict{String,Any}(
            "coding" => [Dict{String,Any}(
                "system"  => state[ci, :condCodeSystem],
                "code"    => state[ci, :condCodeValue],
                "display" => state[ci, :condCodeDisplay],
            )],
        ),
        "recordedDate" => string(state[ci, :condRecordedDate]),
    )
end

function _build_clinical_impression(state::CState, ai::Int,
                                    obs_url::Function, cond_url::Function)
    findings = Dict{String,Any}[]
    for fi in parts(state, :Finding)
        state[fi, :finImpression] == ai || continue
        push!(findings, Dict{String,Any}(
            "itemReference" => Dict{String,Any}(
                "reference" => obs_url(state[fi, :finObservation])),
        ))
    end

    problems = Dict{String,Any}[]
    for di in parts(state, :Diagnosis)
        state[di, :diagImpression] == ai || continue
        push!(problems, Dict{String,Any}(
            "reference" => cond_url(state[di, :diagCondition]),
        ))
    end

    Dict{String,Any}(
        "resourceType" => "ClinicalImpression",
        "status"       => state[ai, :ciStatus],
        "date"         => string(state[ai, :ciDate]),
        "finding"      => findings,
        "problem"      => problems,
    )
end

# MedicationRequest serializes to FHIR R4's medicationCodeableConcept
# shape — coding[0] holds the (system, code, display) triple.
# reasonReference[] fans out each MedReason junction row whose source
# is this MedicationRequest; the parser inverts the same junction.
function _build_medication_request(state::CState, mri::Int, cond_url::Function)
    reasons = Dict{String,Any}[]
    for ri in parts(state, :MedReason)
        state[ri, :mrReasonRequest] == mri || continue
        push!(reasons, Dict{String,Any}(
            "reference" => cond_url(state[ri, :mrReasonCondition])))
    end
    out = Dict{String,Any}(
        "resourceType" => "MedicationRequest",
        "status"       => state[mri, :mrStatus],
        "intent"       => state[mri, :mrIntent],
        "medicationCodeableConcept" => Dict{String,Any}(
            "coding" => [Dict{String,Any}(
                "system"  => state[mri, :mrCodeSystem],
                "code"    => state[mri, :mrCodeValue],
                "display" => state[mri, :mrCodeDisplay],
            )],
        ),
        "dosageInstruction" => [Dict{String,Any}(
            "text" => state[mri, :mrDosage],
        )],
    )
    isempty(reasons) || (out["reasonReference"] = reasons)
    out
end

function _build_encounter(state::CState, ei::Int)
    Dict{String,Any}(
        "resourceType" => "Encounter",
        "status"       => state[ei, :encStatus],
        "class"        => state[ei, :encClass],
        "period" => Dict{String,Any}(
            "start" => string(state[ei, :encStart]),
            "end"   => string(state[ei, :encEnd]),
        ),
        "type" => [Dict{String,Any}(
            "coding" => [Dict{String,Any}(
                "system"  => state[ei, :encCodeSystem],
                "code"    => state[ei, :encCodeValue],
                "display" => state[ei, :encCodeDisplay],
            )],
        )],
    )
end

function _build_appointment(state::CState, ai::Int, cond_url::Function)
    based_on = Dict{String,Any}[]
    for bi in parts(state, :ApptBasedOn)
        state[bi, :abAppointment] == ai || continue
        push!(based_on, Dict{String,Any}(
            "reference" => cond_url(state[bi, :abCondition])))
    end
    out = Dict{String,Any}(
        "resourceType" => "Appointment",
        "status"       => state[ai, :apptStatus],
        "start"        => string(state[ai, :apptStart]),
        "end"          => string(state[ai, :apptEnd]),
        "serviceType"  => [Dict{String,Any}(
            "coding" => [Dict{String,Any}(
                "system"  => state[ai, :apptCodeSystem],
                "code"    => state[ai, :apptCodeValue],
                "display" => state[ai, :apptCodeDisplay],
            )],
        )],
    )
    isempty(based_on) || (out["basedOn"] = based_on)
    out
end

# ---------- public API ----------

"""
    acset_to_fhir(state::CState) -> Dict{String,Any}

Serialize a clinical state ACSet to a FHIR R4 Bundle (type=collection)
shaped as a Dict. One Bundle entry per Observation, Condition, and
ClinicalImpression. Findings and Diagnoses fold into the
ClinicalImpression's `finding` and `problem` arrays — they don't get
their own entries (they have no FHIR resource counterpart, just
backbone-element references).

Deterministic fullUrls (UUIDv5 from a fixed namespace) make the output
diffable across runs and round-trip byte-equal.
"""
function acset_to_fhir(state::CState)
    obs_url(i)  = fhir_fullurl(:Observation, state, i)
    cond_url(i) = fhir_fullurl(:Condition, state, i)
    ci_url(i)   = fhir_fullurl(:ClinicalImpression, state, i)
    mr_url(i)   = fhir_fullurl(:MedicationRequest, state, i)
    appt_url(i) = fhir_fullurl(:Appointment, state, i)
    enc_url(i)  = fhir_fullurl(:Encounter, state, i)

    entries = Dict{String,Any}[]

    for oi in parts(state, :Observation)
        push!(entries, Dict{String,Any}(
            "fullUrl"  => obs_url(oi),
            "resource" => _build_observation(state, oi)))
    end
    for ci in parts(state, :Condition)
        push!(entries, Dict{String,Any}(
            "fullUrl"  => cond_url(ci),
            "resource" => _build_condition(state, ci)))
    end
    for ai in parts(state, :ClinicalImpression)
        push!(entries, Dict{String,Any}(
            "fullUrl"  => ci_url(ai),
            "resource" => _build_clinical_impression(
                state, ai, obs_url, cond_url)))
    end
    for mri in parts(state, :MedicationRequest)
        push!(entries, Dict{String,Any}(
            "fullUrl"  => mr_url(mri),
            "resource" => _build_medication_request(state, mri, cond_url)))
    end
    for ai in parts(state, :Appointment)
        push!(entries, Dict{String,Any}(
            "fullUrl"  => appt_url(ai),
            "resource" => _build_appointment(state, ai, cond_url)))
    end
    for ei in parts(state, :Encounter)
        push!(entries, Dict{String,Any}(
            "fullUrl"  => enc_url(ei),
            "resource" => _build_encounter(state, ei)))
    end

    Dict{String,Any}(
        "resourceType" => "Bundle",
        "type"         => "collection",
        "entry"        => entries,
    )
end
