# rule_dm2_resolve_core.jl — design for a status-transition rule that
# flips an active DM2 Problem to "resolved" once HbA1c is back in the
# non-diabetic range.
#
# Trigger:    active DM2 Problem (SNOMED 44054006) + HbA1c Observation.
# Predicate:  HbA1c valMagnitude < 5.7%.
# Intent:     relabel the Problem's Status from "active" to "resolved".
#
# IMPORTANT — this rule is currently DESIGN-ONLY and cannot be packaged
# into an AlgebraicRewriting `Rule{:DPO}`. The L, K, R objects and the
# l, r morphisms are still constructed below so the rule can be visualized
# (rule_view / span_view), and so the design is documented in code, but
# `Rule{:DPO}(l_resolve, r_resolve)` is intentionally NOT called.
#
# Why it can't fire under the current AlgebraicRewriting + schema combo:
#   1. AlgebraicRewriting's Rule constructor enforces that each AttrType
#      component of r: K → R is monic.
#   2. With the schema's `probStatus::Hom(Problem, Status)` being total
#      and the Problem preserved across K, Hom commutation forces K's
#      AttrVar at the Problem's statusCode slot to map to R's AttrVar at
#      the same slot. That R AttrVar therefore has a K-preimage and is
#      classified "preserved", so `expr` can't override its value.
#   3. The alternative — sending K's AttrVar to R's literal "resolved" —
#      makes the AttrType component non-monic (the literal acquires two
#      preimages: K's AttrVar and the implicit identity-on-literals),
#      which the constructor rejects.
#
# A clean fix is a schema change: replace `probStatus::Hom(Problem, Status)`
# with a `ProblemStatusEvent::Ob` junction, making status changes purely
# additive. That's deferred until we revisit schema evolution.

include("clinical_state_multi.jl")
include("cds_rule.jl")
include("cds_predicates.jl")

# AttrVar conventions (kept identical across L, K, R for the unchanged ones):
#   StringAttr  1: codeDisplay for the DM2 Problem Code
#               2: codeDisplay for the HbA1c Observation Code
#               3: valUnit for the HbA1c Value
#               4: statusCode for the HbA1c Observation's Status
#               5: statusCode for the DM2 Problem's Status (only in K)
#   FloatAttr   1: HbA1c valMagnitude
#   TimeAttr    1: timeInstant for the Problem
#               2: timeInstant for the Observation

# ============================== L ==============================
# Active DM2 Problem + HbA1c Observation. The Problem's statusCode is the
# LITERAL "active" — that's the structural guard against re-firing on an
# already-resolved problem (no NAC needed for the status check).
L_resolve = @acset CStateMulti begin
    Problem     = 1
    Observation = 1
    Code        = 2
    Value       = 1
    Status      = 2
    Time        = 2
    StringAttr  = 4
    FloatAttr   = 1
    TimeAttr    = 2

    probCode   = [1]
    probStatus = [1]
    probTime   = [1]

    obsCode   = [2]
    obsValue  = [1]
    obsStatus = [2]
    obsTime   = [2]

    codeSystem   = ["http://snomed.info/sct", "http://loinc.org"]
    codeValue    = ["44054006",               "4548-4"]
    codeDisplay  = [AttrVar(1),               AttrVar(2)]

    valMagnitude = [AttrVar(1)]
    valUnit      = [AttrVar(3)]

    statusCode   = ["active",     AttrVar(4)]   # P-status literal, O-status free
    timeInstant  = [AttrVar(1),   AttrVar(2)]
end

# ============================== K ==============================
# Same combinatorial shape as L, but the Problem's Status carries an
# AttrVar instead of a literal so it can be rebound by l and r.
K_resolve = @acset CStateMulti begin
    Problem     = 1
    Observation = 1
    Code        = 2
    Value       = 1
    Status      = 2
    Time        = 2
    StringAttr  = 5
    FloatAttr   = 1
    TimeAttr    = 2

    probCode   = [1]
    probStatus = [1]
    probTime   = [1]

    obsCode   = [2]
    obsValue  = [1]
    obsStatus = [2]
    obsTime   = [2]

    codeSystem   = ["http://snomed.info/sct", "http://loinc.org"]
    codeValue    = ["44054006",               "4548-4"]
    codeDisplay  = [AttrVar(1),               AttrVar(2)]

    valMagnitude = [AttrVar(1)]
    valUnit      = [AttrVar(3)]

    statusCode   = [AttrVar(5),   AttrVar(4)]   # P-status now a variable
    timeInstant  = [AttrVar(1),   AttrVar(2)]
end

# ============================== R ==============================
# Same combinatorial shape as K, with the Problem's statusCode bound to
# the literal "resolved".
R_resolve = @acset CStateMulti begin
    Problem     = 1
    Observation = 1
    Code        = 2
    Value       = 1
    Status      = 2
    Time        = 2
    StringAttr  = 4
    FloatAttr   = 1
    TimeAttr    = 2

    probCode   = [1]
    probStatus = [1]
    probTime   = [1]

    obsCode   = [2]
    obsValue  = [1]
    obsStatus = [2]
    obsTime   = [2]

    codeSystem   = ["http://snomed.info/sct", "http://loinc.org"]
    codeValue    = ["44054006",               "4548-4"]
    codeDisplay  = [AttrVar(1),               AttrVar(2)]

    valMagnitude = [AttrVar(1)]
    valUnit      = [AttrVar(3)]

    statusCode   = ["resolved",   AttrVar(4)]   # P-status literal "resolved"
    timeInstant  = [AttrVar(1),   AttrVar(2)]
end

# ============================ morphisms ============================
# l: K → L sends K's StringAttr-AttrVar(5) to L's literal "active";
# r: K → R sends the same AttrVar to R's literal "resolved".
# All other AttrVars carry through identically; Ob components are the
# identity (K, L, R share the same combinatorial shape).
#
# These are constructed manually rather than via `homomorphism(...)`
# because Catlab's homomorphism finder does not search the AttrVar →
# literal binding space we need here.

const _RESOLVE_OB_IDENTITY = (
    Observation = [1],   Assessment = Int[],   Problem    = [1],
    Finding     = Int[], Diagnosis  = Int[],
    Code        = [1, 2], Value     = [1],
    Status      = [1, 2], Time      = [1, 2],
)

l_resolve = ACSetTransformation(K_resolve, L_resolve;
    _RESOLVE_OB_IDENTITY...,
    StringAttr = Any[AttrVar(1), AttrVar(2), AttrVar(3), AttrVar(4), "active"],
    FloatAttr  = [AttrVar(1)],
    TimeAttr   = [AttrVar(1), AttrVar(2)])

r_resolve = ACSetTransformation(K_resolve, R_resolve;
    _RESOLVE_OB_IDENTITY...,
    StringAttr = Any[AttrVar(1), AttrVar(2), AttrVar(3), AttrVar(4), "resolved"],
    FloatAttr  = [AttrVar(1)],
    TimeAttr   = [AttrVar(1), AttrVar(2)])

# ========================= attribute predicate =========================
# Below the resolution threshold (HbA1c < 5.7 = non-diabetic per ADA).
hba1c_resolve_pred =
    AttrPredicate("http://loinc.org", "4548-4", "Hemoglobin A1c",
                  :valMagnitude, <, 5.7)

# ============================== rule ==============================
# Intentionally NOT constructing `Rule{:DPO}(l_resolve, r_resolve)` — see
# the file header for the categorical reasons. The structural pieces above
# (L_resolve, K_resolve, R_resolve, l_resolve, r_resolve, hba1c_resolve_pred)
# are sufficient for visualization via `span_view(l_resolve, r_resolve)`.
