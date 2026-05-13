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
# kind + ACSet row index, so the same state serializes to identical JSON
# across calls — required for byte-equal round-trip and diffability.
#
# Public API:
#   acset_to_fhir(state) -> Dict   FHIR Bundle
#   fhir_fullurl(kind, idx) -> String   urn:uuid:<v5> for (kind, row)

include("clinical_state_multi.jl")

using Catlab
using Dates
using UUIDs

# Stable namespace for Algebraic_CDS-generated UUIDs. Chosen once, fixed.
const _CDS_UUID_NAMESPACE = UUID("8a4b1f0e-3c2a-4d57-9f1e-5b3c2d1a0f9b")

"""
    fhir_fullurl(kind::Symbol, idx::Int) -> String

Deterministic Bundle.entry.fullUrl for an ACSet row identified by
(kind, idx). Same inputs always produce the same UUID.
"""
fhir_fullurl(kind::Symbol, idx::Int) =
    "urn:uuid:" * string(uuid5(_CDS_UUID_NAMESPACE, "$(kind)/$(idx)"))

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
    obs_url(i)  = fhir_fullurl(:Observation, i)
    cond_url(i) = fhir_fullurl(:Condition, i)
    ci_url(i)   = fhir_fullurl(:ClinicalImpression, i)
    mr_url(i)   = fhir_fullurl(:MedicationRequest, i)
    appt_url(i) = fhir_fullurl(:Appointment, i)
    enc_url(i)  = fhir_fullurl(:Encounter, i)

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
