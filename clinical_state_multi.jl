# clinical_state_multi.jl — FHIR-shaped clinical state ACSet schema.
#
# Each Ob IS a FHIR R4 resource type. Each Ob's attributes are the
# resource's FHIR fields, inlined — no externalized Code/Value/Status/Time
# bookkeeping. The ACSet is structurally a FHIR Bundle in disguise:
# one row per resource entry, attributes for fields, Homs for References.
# That makes FHIR-Bundle ↔ ACSet round-trip byte-equal: every field has
# exactly one representation on each side.
#
# Renames vs the prior SchClinicalStateMulti:
#   Problem    → Condition
#   Assessment → ClinicalImpression
#
# Code/Value/Status/Time are no longer first-class Obs. The prior schema
# expressed "two resources at the same instant" as a shared Hom into a
# Time Ob. Here that's expressed by AttrVar coordination — multiple
# TimeAttr-typed slots binding the same AttrVar(n). Cleaner, and survives
# round-trip through FHIR's literal-per-resource representation.
#
# Junction Obs (Finding, Diagnosis) survive unchanged in role:
#   Finding   ≘ ClinicalImpression.finding[].itemReference → Observation
#   Diagnosis ≘ ClinicalImpression.problem[].reference     → Condition
# Their hom names are renamed to match the FHIR backbone-element semantics.

using Catlab
using Dates

@present SchClinicalState(FreeSchema) begin
  Observation::Ob
  Condition::Ob
  ClinicalImpression::Ob
  MedicationRequest::Ob
  Appointment::Ob
  Encounter::Ob

  # Junction Obs for cross-resource References. Each junction encodes
  # one FHIR Reference field as a row with two Homs into the source +
  # target Obs. This pattern keeps the schema fully ACSet-shaped (no
  # polymorphic refs), and round-trips losslessly through the FHIR
  # Bundle. Junction-row identity is unimportant — they're created on
  # parse and dropped on serialize. The pattern mirrors how Catlab's
  # category-theoretic infrastructure expects 0..* Homs to be modeled.
  Finding::Ob
  finImpression::Hom(Finding, ClinicalImpression)
  finObservation::Hom(Finding, Observation)

  Diagnosis::Ob
  diagImpression::Hom(Diagnosis, ClinicalImpression)
  diagCondition::Hom(Diagnosis, Condition)

  # MedicationRequest.reasonReference[] → Condition.
  MedReason::Ob
  mrReasonRequest::Hom(MedReason, MedicationRequest)
  mrReasonCondition::Hom(MedReason, Condition)

  # Appointment.basedOn[] → Condition. (FHIR R4 strictly types this as
  # ServiceRequest|CarePlan; we accept Condition too because the Cowork
  # demo authors referrals as basedOn the diagnosis.)
  ApptBasedOn::Ob
  abAppointment::Hom(ApptBasedOn, Appointment)
  abCondition::Hom(ApptBasedOn, Condition)

  # Attribute types
  StringAttr::AttrType
  FloatAttr::AttrType
  TimeAttr::AttrType

  # ----- Observation fields (FHIR Observation, inlined) -----
  obsCodeSystem::Attr(Observation, StringAttr)
  obsCodeValue::Attr(Observation, StringAttr)
  obsCodeDisplay::Attr(Observation, StringAttr)
  obsValueMagnitude::Attr(Observation, FloatAttr)
  obsValueUnit::Attr(Observation, StringAttr)
  obsStatus::Attr(Observation, StringAttr)
  obsEffective::Attr(Observation, TimeAttr)

  # ----- Condition fields (FHIR Condition, inlined) -----
  condCodeSystem::Attr(Condition, StringAttr)
  condCodeValue::Attr(Condition, StringAttr)
  condCodeDisplay::Attr(Condition, StringAttr)
  condClinicalStatus::Attr(Condition, StringAttr)
  condRecordedDate::Attr(Condition, TimeAttr)

  # ----- ClinicalImpression fields -----
  ciStatus::Attr(ClinicalImpression, StringAttr)
  ciDate::Attr(ClinicalImpression, TimeAttr)

  # ----- MedicationRequest fields -----
  # Medication identified by a (system, code, display) triple, round-
  # tripped through FHIR's medicationCodeableConcept.coding[0]. RxNorm
  # is the conventional system for prescriptions but anything FHIR
  # accepts (NDC, SNOMED) works — engine matching is purely literal
  # string equality on (codeSystem, codeValue), letting NACs scope to
  # "no existing metformin order" via RxNorm code rather than a
  # freeform string.
  mrCodeSystem::Attr(MedicationRequest, StringAttr)
  mrCodeValue::Attr(MedicationRequest, StringAttr)
  mrCodeDisplay::Attr(MedicationRequest, StringAttr)
  mrStatus::Attr(MedicationRequest, StringAttr)
  mrIntent::Attr(MedicationRequest, StringAttr)
  mrDosage::Attr(MedicationRequest, StringAttr)

  # ----- Appointment fields -----
  # Service type as a single (system, code, display) triple — round-tripped
  # through FHIR's Appointment.serviceType[0].coding[0]. Matches the
  # codeSystem/codeValue/codeDisplay shape used by Observation and
  # Condition so authors can apply the same mental model across all
  # coded resources. FHIR R4's serviceType is technically 0..*, but the
  # CDS demos only need a single code; we emit one entry on serialize
  # and read just the first on parse.
  apptStatus::Attr(Appointment, StringAttr)
  apptStart::Attr(Appointment, TimeAttr)
  apptEnd::Attr(Appointment, TimeAttr)
  apptCodeSystem::Attr(Appointment, StringAttr)
  apptCodeValue::Attr(Appointment, StringAttr)
  apptCodeDisplay::Attr(Appointment, StringAttr)

  # ----- Encounter fields -----
  # Encounter represents an actual visit/contact (vs. Appointment which
  # is the scheduling resource). For "has the patient been seen by
  # ophthalmology in the past year?" we look at completed Encounters,
  # not Appointments. Code triple maps to FHIR's Encounter.type[0].coding[0].
  encStatus::Attr(Encounter, StringAttr)
  encClass::Attr(Encounter, StringAttr)
  encStart::Attr(Encounter, TimeAttr)
  encEnd::Attr(Encounter, TimeAttr)
  encCodeSystem::Attr(Encounter, StringAttr)
  encCodeValue::Attr(Encounter, StringAttr)
  encCodeDisplay::Attr(Encounter, StringAttr)
end

@acset_type ClinicalState(SchClinicalState,
                          index=[:finImpression, :finObservation,
                                 :diagImpression, :diagCondition,
                                 :mrReasonRequest, :mrReasonCondition,
                                 :abAppointment, :abCondition])

# Concrete attribute types: FHIR strings → Julia String, Quantity values →
# Float64, dateTime/instant → DateTime. CState is what every consumer uses.
const CState = ClinicalState{String, Float64, DateTime}
