# Multi-finding / multi-diagnosis clinical state:
#   Observation ← Finding → Assessment ← Diagnosis → Problem
# Finding and Diagnosis are junction objects encoding many-to-many relations.

using Catlab
using Dates

@present SchClinicalStateMulti(FreeSchema) begin
  Observation::Ob
  Assessment::Ob
  Problem::Ob

  Finding::Ob
  findObs::Hom(Finding, Observation)
  findAssm::Hom(Finding, Assessment)

  Diagnosis::Ob
  diagAssm::Hom(Diagnosis, Assessment)
  diagProb::Hom(Diagnosis, Problem)

  # FHIR-style associated objects
  Code::Ob
  Value::Ob
  Status::Ob
  Time::Ob

  obsCode::Hom(Observation, Code)
  obsValue::Hom(Observation, Value)
  obsStatus::Hom(Observation, Status)
  obsTime::Hom(Observation, Time)

  probCode::Hom(Problem, Code)
  probStatus::Hom(Problem, Status)
  probTime::Hom(Problem, Time)

  assmStatus::Hom(Assessment, Status)
  assmTime::Hom(Assessment, Time)

  # Attribute types
  StringAttr::AttrType
  FloatAttr::AttrType
  TimeAttr::AttrType

  codeSystem::Attr(Code, StringAttr)
  codeValue::Attr(Code, StringAttr)
  codeDisplay::Attr(Code, StringAttr)

  valMagnitude::Attr(Value, FloatAttr)
  valUnit::Attr(Value, StringAttr)

  statusCode::Attr(Status, StringAttr)
  timeInstant::Attr(Time, TimeAttr)
end

@acset_type ClinicalStateMulti(SchClinicalStateMulti,
                               index=[:findObs, :findAssm, :diagAssm, :diagProb])

const CStateMulti = ClinicalStateMulti{String, Float64, DateTime}
