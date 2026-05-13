# state_builders.jl — helpers for constructing CState instances.
#
# Low-level primitives (add_observation!, add_condition!,
# add_clinical_impression!, link_finding!, link_diagnosis!) plus scenario
# factories (build_hba1c_scenario, build_vignette).
#
# Renamed from the prior schema's add_problem!/add_assessment! to match
# the FHIR-shaped Ob names.

include("clinical_state_multi.jl")

using Catlab
using Dates

empty_state() = CState()

"""
Add a FHIR Observation row with all fields inlined. Returns its row index.
"""
function add_observation!(st::CState;
                          code_system::String, code_value::String,
                          code_display::String,
                          magnitude::Real, unit::String,
                          status::String = "final",
                          time::DateTime)
    add_part!(st, :Observation;
        obsCodeSystem     = code_system,
        obsCodeValue      = code_value,
        obsCodeDisplay    = code_display,
        obsValueMagnitude = Float64(magnitude),
        obsValueUnit      = unit,
        obsStatus         = status,
        obsEffective      = time,
    )
end

"""
Add a FHIR Condition row (problem-list-item) with all fields inlined.
Returns its row index.
"""
function add_condition!(st::CState;
                        code_system::String, code_value::String,
                        code_display::String,
                        clinical_status::String = "active",
                        time::DateTime)
    add_part!(st, :Condition;
        condCodeSystem     = code_system,
        condCodeValue      = code_value,
        condCodeDisplay    = code_display,
        condClinicalStatus = clinical_status,
        condRecordedDate   = time,
    )
end

"""
Add a FHIR ClinicalImpression row (status + date). Returns its row index.
"""
function add_clinical_impression!(st::CState;
                                   status::String = "completed",
                                   time::DateTime)
    add_part!(st, :ClinicalImpression;
        ciStatus = status,
        ciDate   = time,
    )
end

"""
Link a ClinicalImpression to an Observation as a finding. Inserts a
Finding junction row.
"""
function link_finding!(st::CState; impression::Int, observation::Int)
    add_part!(st, :Finding;
        finImpression = impression,
        finObservation = observation,
    )
end

"""
Link a ClinicalImpression to a Condition as a diagnosis. Inserts a
Diagnosis junction row.
"""
function link_diagnosis!(st::CState; impression::Int, condition::Int)
    add_part!(st, :Diagnosis;
        diagImpression = impression,
        diagCondition  = condition,
    )
end

"""
Add a FHIR MedicationRequest row. The (code_system, code_value, code_display)
triple maps to medicationCodeableConcept.coding[0] on serialize. RxNorm
is conventional for prescriptions (e.g. "861007 metformin 1000 MG oral
tablet") — engine matching is literal equality on (system, value).
"""
function add_medication_request!(st::CState;
                                  code_system::String  = "",
                                  code_value::String   = "",
                                  code_display::String = "",
                                  status::String = "active",
                                  intent::String = "order",
                                  dosage::String = "")
    add_part!(st, :MedicationRequest;
        mrCodeSystem  = code_system,
        mrCodeValue   = code_value,
        mrCodeDisplay = code_display,
        mrStatus      = status,
        mrIntent      = intent,
        mrDosage      = dosage,
    )
end

"""
Add a FHIR Appointment row. `code_*` populate the serviceType.coding[0]
triple — the SNOMED code identifying the appointment kind (e.g.
"408451005 Ophthalmology" or "722112000 Diabetic retinopathy screening").
"""
function add_appointment!(st::CState;
                          status::String,
                          start::DateTime,
                          stop::DateTime = start,
                          code_system::String  = "",
                          code_value::String   = "",
                          code_display::String = "")
    add_part!(st, :Appointment;
        apptStatus      = status,
        apptStart       = start,
        apptEnd         = stop,
        apptCodeSystem  = code_system,
        apptCodeValue   = code_value,
        apptCodeDisplay = code_display,
    )
end

"""
Add a FHIR Encounter row. Code triple goes to Encounter.type[0].coding[0]
(SNOMED specialty codes work well here, e.g. "408451005 Ophthalmology").
"""
function add_encounter!(st::CState;
                        status::String,
                        class::String = "ambulatory",
                        start::DateTime,
                        stop::DateTime  = start,
                        code_system::String  = "",
                        code_value::String   = "",
                        code_display::String = "")
    add_part!(st, :Encounter;
        encStatus      = status,
        encClass       = class,
        encStart       = start,
        encEnd         = stop,
        encCodeSystem  = code_system,
        encCodeValue   = code_value,
        encCodeDisplay = code_display,
    )
end

"""
Wire a MedicationRequest's `reasonReference` to a Condition. Inserts
one MedReason junction row.
"""
function link_med_reason!(st::CState; request::Int, condition::Int)
    add_part!(st, :MedReason;
        mrReasonRequest   = request,
        mrReasonCondition = condition,
    )
end

"""
Wire an Appointment's `basedOn` to a Condition. Inserts one
ApptBasedOn junction row.
"""
function link_appt_based_on!(st::CState; appointment::Int, condition::Int)
    add_part!(st, :ApptBasedOn;
        abAppointment = appointment,
        abCondition   = condition,
    )
end

# ============= scenario factories =============

"""
Build an HbA1c test scenario: one HbA1c Observation at magnitude `hba1c`,
optionally preceded by an already-active DM2 Condition.
"""
function build_hba1c_scenario(; hba1c::Float64, with_dm2::Bool,
                              dm2_status::String="active")
    t = DateTime("2026-04-23T10:30:00")
    st = empty_state()
    add_observation!(st;
        code_system  = "http://loinc.org",
        code_value   = "4548-4",
        code_display = "Hemoglobin A1c",
        magnitude    = hba1c,
        unit         = "%",
        time         = t)
    if with_dm2
        add_condition!(st;
            code_system     = "http://snomed.info/sct",
            code_value      = "44054006",
            code_display    = "Type 2 diabetes mellitus",
            clinical_status = dm2_status,
            time            = t)
    end
    st
end

"""
A 55-year-old patient at an initial clinic visit. Five abnormal observations
(HbA1c 9.8%, fasting glucose 186, systolic BP 152, BMI 34.2, total
cholesterol 245) and a prior problem list of hypertension, obesity, and
hyperlipidemia — but no diabetes diagnosis on the record yet.
"""
function build_vignette()
    visit = DateTime("2026-04-23T10:30:00")
    prior = DateTime("2024-01-15T09:00:00")
    st = empty_state()

    add_observation!(st; code_system="http://loinc.org", code_value="4548-4",
                     code_display="Hemoglobin A1c",
                     magnitude=9.8, unit="%", time=visit)
    add_observation!(st; code_system="http://loinc.org", code_value="1558-6",
                     code_display="Fasting plasma glucose",
                     magnitude=186.0, unit="mg/dL", time=visit)
    add_observation!(st; code_system="http://loinc.org", code_value="8480-6",
                     code_display="Systolic blood pressure",
                     magnitude=152.0, unit="mmHg", time=visit)
    add_observation!(st; code_system="http://loinc.org", code_value="39156-5",
                     code_display="Body mass index",
                     magnitude=34.2, unit="kg/m2", time=visit)
    add_observation!(st; code_system="http://loinc.org", code_value="2093-3",
                     code_display="Total cholesterol",
                     magnitude=245.0, unit="mg/dL", time=visit)

    add_condition!(st; code_system="http://snomed.info/sct", code_value="59621000",
                   code_display="Essential hypertension", time=prior)
    add_condition!(st; code_system="http://snomed.info/sct", code_value="414915002",
                   code_display="Obesity", time=prior)
    add_condition!(st; code_system="http://snomed.info/sct", code_value="55822004",
                   code_display="Hyperlipidemia", time=prior)

    st
end
