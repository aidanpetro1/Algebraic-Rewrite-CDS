# main.jl — populate one ClinicalStateMulti instance and inspect it.
# Scenario: new-patient workup. Four observations (HbA1c, fasting glucose,
# systolic BP, BMI) feed one Assessment, which concludes three Problems
# (type 2 diabetes, essential hypertension, obesity).

include("clinical_state_multi.jl")

state = CStateMulti()

# ---------- shared objects ----------
t = add_part!(state, :Time, timeInstant=DateTime("2026-04-23T10:30:00"))

s_final     = add_part!(state, :Status, statusCode="final")      # observations
s_completed = add_part!(state, :Status, statusCode="completed")  # assessment
s_active    = add_part!(state, :Status, statusCode="active")     # problems

# ---------- LOINC codes for the observations ----------
c_hba1c = add_part!(state, :Code,
    codeSystem="http://loinc.org", codeValue="4548-4",
    codeDisplay="Hemoglobin A1c")
c_fbg = add_part!(state, :Code,
    codeSystem="http://loinc.org", codeValue="1558-6",
    codeDisplay="Fasting plasma glucose")
c_sbp = add_part!(state, :Code,
    codeSystem="http://loinc.org", codeValue="8480-6",
    codeDisplay="Systolic blood pressure")
c_bmi = add_part!(state, :Code,
    codeSystem="http://loinc.org", codeValue="39156-5",
    codeDisplay="Body mass index")

# ---------- SNOMED codes for the problems ----------
c_dm2 = add_part!(state, :Code,
    codeSystem="http://snomed.info/sct", codeValue="44054006",
    codeDisplay="Type 2 diabetes mellitus")
c_htn = add_part!(state, :Code,
    codeSystem="http://snomed.info/sct", codeValue="59621000",
    codeDisplay="Essential hypertension")
c_obes = add_part!(state, :Code,
    codeSystem="http://snomed.info/sct", codeValue="414915002",
    codeDisplay="Obesity")

# ---------- values ----------
v_hba1c = add_part!(state, :Value, valMagnitude=9.8,   valUnit="%")
v_fbg   = add_part!(state, :Value, valMagnitude=186.0, valUnit="mg/dL")
v_sbp   = add_part!(state, :Value, valMagnitude=152.0, valUnit="mmHg")
v_bmi   = add_part!(state, :Value, valMagnitude=34.2,  valUnit="kg/m2")

# ---------- observations ----------
o_hba1c = add_part!(state, :Observation,
    obsCode=c_hba1c, obsValue=v_hba1c, obsStatus=s_final, obsTime=t)
o_fbg = add_part!(state, :Observation,
    obsCode=c_fbg, obsValue=v_fbg, obsStatus=s_final, obsTime=t)
o_sbp = add_part!(state, :Observation,
    obsCode=c_sbp, obsValue=v_sbp, obsStatus=s_final, obsTime=t)
o_bmi = add_part!(state, :Observation,
    obsCode=c_bmi, obsValue=v_bmi, obsStatus=s_final, obsTime=t)

# ---------- the assessment ----------
a = add_part!(state, :Assessment, assmStatus=s_completed, assmTime=t)

# ---------- findings: all four observations feed the assessment ----------
add_part!(state, :Finding, findObs=o_hba1c, findAssm=a)
add_part!(state, :Finding, findObs=o_fbg,   findAssm=a)
add_part!(state, :Finding, findObs=o_sbp,   findAssm=a)
add_part!(state, :Finding, findObs=o_bmi,   findAssm=a)

# ---------- problems ----------
p_dm2  = add_part!(state, :Problem, probCode=c_dm2,  probStatus=s_active, probTime=t)
p_htn  = add_part!(state, :Problem, probCode=c_htn,  probStatus=s_active, probTime=t)
p_obes = add_part!(state, :Problem, probCode=c_obes, probStatus=s_active, probTime=t)

# ---------- diagnoses: the assessment concludes three problems ----------
add_part!(state, :Diagnosis, diagAssm=a, diagProb=p_dm2)
add_part!(state, :Diagnosis, diagAssm=a, diagProb=p_htn)
add_part!(state, :Diagnosis, diagAssm=a, diagProb=p_obes)


# ============================================================
# Inspection
# ============================================================

println("="^60)
println("ClinicalStateMulti — raw ACSet tables")
println("="^60)
show(stdout, "text/plain", state)
println()

println("\n" * "="^60)
println("Query: evidence and conclusions of Assessment $a")
println("="^60)

# preimage: which Finding rows point at assessment a?
findings = incident(state, a, :findAssm)
# hop across Finding -> Observation
supporting_obs = subpart(state, findings, :findObs)

println("\nSupporting observations ($(length(supporting_obs))):")
for o in supporting_obs
    code = state[o, :obsCode]
    val  = state[o, :obsValue]
    println("  Obs $o: ",
            state[code, :codeDisplay], " = ",
            state[val, :valMagnitude], " ",
            state[val, :valUnit])
end

# preimage: which Diagnosis rows point at assessment a?
diagnoses = incident(state, a, :diagAssm)
concluded = subpart(state, diagnoses, :diagProb)

println("\nConcluded problems ($(length(concluded))):")
for p in concluded
    code = state[p, :probCode]
    println("  Problem $p: ",
            state[code, :codeDisplay],
            " (", state[code, :codeSystem], "/", state[code, :codeValue], ")")
end
