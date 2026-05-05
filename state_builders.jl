# state_builders.jl — helpers for constructing ClinicalStateMulti instances.
#
# Low-level primitives (add_observation!, add_problem!, add_assessment!)
# plus scenario factories (build_hba1c_scenario, build_vignette).

include("clinical_state_multi.jl")

using Catlab
using Dates

empty_state() = CStateMulti()

"""
Add an Observation together with its associated Code, Value, Status, and
Time rows (all freshly created). Returns the new Observation's index.
"""
function add_observation!(st::CStateMulti;
                          code_system::String, code_value::String,
                          code_display::String,
                          magnitude::Real, unit::String,
                          status::String = "final",
                          time::DateTime)
    c = add_part!(st, :Code, codeSystem=code_system,
                              codeValue=code_value,
                              codeDisplay=code_display)
    v = add_part!(st, :Value, valMagnitude=Float64(magnitude), valUnit=unit)
    s = add_part!(st, :Status, statusCode=status)
    t = add_part!(st, :Time, timeInstant=time)
    add_part!(st, :Observation, obsCode=c, obsValue=v, obsStatus=s, obsTime=t)
end

"""
Add a Problem together with its Code, Status, and Time rows. Returns the
new Problem's index.
"""
function add_problem!(st::CStateMulti;
                      code_system::String, code_value::String,
                      code_display::String,
                      status::String = "active",
                      time::DateTime)
    c = add_part!(st, :Code, codeSystem=code_system,
                              codeValue=code_value,
                              codeDisplay=code_display)
    s = add_part!(st, :Status, statusCode=status)
    t = add_part!(st, :Time, timeInstant=time)
    add_part!(st, :Problem, probCode=c, probStatus=s, probTime=t)
end

"""
Add an Assessment with its Status and Time rows. Returns the new
Assessment's index.
"""
function add_assessment!(st::CStateMulti;
                         status::String = "completed",
                         time::DateTime)
    s = add_part!(st, :Status, statusCode=status)
    t = add_part!(st, :Time, timeInstant=time)
    add_part!(st, :Assessment, assmStatus=s, assmTime=t)
end

# ============= scenario factories =============

"""
Build an HbA1c test scenario used by rule_dm2.jl's 4-scenario matrix:
one HbA1c Observation at magnitude `hba1c`, optionally preceded by an
already-active DM2 Problem on the patient's problem list.
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
        add_problem!(st;
            code_system  = "http://snomed.info/sct",
            code_value   = "44054006",
            code_display = "Type 2 diabetes mellitus",
            status       = dm2_status,
            time         = t)
    end
    st
end

"""
A 55-year-old patient at an initial clinic visit. Presents with several
abnormal observations (HbA1c 9.8%, fasting glucose 186, systolic BP 152,
BMI 34.2, total cholesterol 245) and a prior-PCP problem list of
hypertension, obesity, and hyperlipidemia — but no diabetes diagnosis
on the record yet.
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

    add_problem!(st; code_system="http://snomed.info/sct", code_value="59621000",
                 code_display="Essential hypertension", time=prior)
    add_problem!(st; code_system="http://snomed.info/sct", code_value="414915002",
                 code_display="Obesity", time=prior)
    add_problem!(st; code_system="http://snomed.info/sct", code_value="55822004",
                 code_display="Hyperlipidemia", time=prior)

    st
end
