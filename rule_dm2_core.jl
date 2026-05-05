# rule_dm2_core.jl — definition of the DM2 DPO rule (no scenarios, no viz).
#
# Trigger:  an Observation whose Code is LOINC 4548-4 (HbA1c).
# NAC:      do NOT fire if a Problem with SNOMED 44054006 (DM2) already exists.
# Predicate: only fire if valMagnitude ≥ 6.5.
# Action:   add an Assessment + Finding + Diagnosis + Problem (SNOMED 44054006).
#
# Both rule_dm2.jl (scenario matrix) and vignette_dm2.jl (clinical vignette)
# include this file.

include("clinical_state_multi.jl")
include("cds_rule.jl")         # categorical layer: RuleWithACs, NACs, PACs
include("cds_predicates.jl")   # logical layer: CDSRule with attribute predicates

# ============================== L ==============================
L = @acset CStateMulti begin
    Observation = 1
    Code = 1
    Value = 1
    Status = 1
    Time = 1
    StringAttr = 3
    FloatAttr = 1
    TimeAttr = 1

    obsCode   = [1]
    obsValue  = [1]
    obsStatus = [1]
    obsTime   = [1]

    codeSystem   = ["http://loinc.org"]
    codeValue    = ["4548-4"]
    codeDisplay  = [AttrVar(1)]
    valMagnitude = [AttrVar(1)]
    valUnit      = [AttrVar(2)]
    statusCode   = [AttrVar(3)]
    timeInstant  = [AttrVar(1)]
end

K = L

# ============================== R ==============================
R = @acset CStateMulti begin
    Observation = 1
    Assessment  = 1
    Problem     = 1
    Finding     = 1
    Diagnosis   = 1
    Code        = 2
    Value       = 1
    Status      = 3
    Time        = 1
    StringAttr  = 3
    FloatAttr   = 1
    TimeAttr    = 1

    obsCode   = [1]
    obsValue  = [1]
    obsStatus = [1]
    obsTime   = [1]

    assmStatus = [2]
    assmTime   = [1]

    probCode   = [2]
    probStatus = [3]
    probTime   = [1]

    findObs  = [1]
    findAssm = [1]
    diagAssm = [1]
    diagProb = [1]

    codeSystem   = ["http://loinc.org", "http://snomed.info/sct"]
    codeValue    = ["4548-4",           "44054006"]
    codeDisplay  = [AttrVar(1),         "Type 2 diabetes mellitus"]
    valMagnitude = [AttrVar(1)]
    valUnit      = [AttrVar(2)]
    statusCode   = [AttrVar(3), "completed", "active"]
    timeInstant  = [AttrVar(1)]
end

# ============================== N (NAC) ==============================
N = @acset CStateMulti begin
    Observation = 1
    Problem     = 1
    Code        = 2
    Value       = 1
    Status      = 2
    Time        = 1
    StringAttr  = 5
    FloatAttr   = 1
    TimeAttr    = 1

    obsCode   = [1]
    obsValue  = [1]
    obsStatus = [1]
    obsTime   = [1]

    probCode   = [2]
    probStatus = [2]
    probTime   = [1]

    codeSystem   = ["http://loinc.org", "http://snomed.info/sct"]
    codeValue    = ["4548-4",           "44054006"]
    codeDisplay  = [AttrVar(1),         AttrVar(5)]
    valMagnitude = [AttrVar(1)]
    valUnit      = [AttrVar(2)]
    statusCode   = [AttrVar(3), AttrVar(4)]
    timeInstant  = [AttrVar(1)]
end

# =========================== morphisms ===========================
l = homomorphism(K, L; monic=true)
r = homomorphism(K, R; monic=true)
n = homomorphism(L, N; monic=true)
isnothing(n) && error("failed to build NAC morphism L → N")

# ========================== attribute predicate ==========================
# Reusable AttrPredicate specifying (code, attribute, op, threshold).
# Reads the concrete value from the matched state and compares it.
hba1c_pred = AttrPredicate("http://loinc.org", "4548-4", "Hemoglobin A1c",
                            :valMagnitude, ≥, 6.5)

# =============================== rule ===============================
# Categorical layer: structural rule + its NAC.
base_rule = RuleWithACs(Rule{:DPO}(l, r); nacs=[n])

# Logical layer: attach attribute predicates on top.
rule = CDSRule(base_rule; preds=[hba1c_pred])
