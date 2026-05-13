// Curated clinical-code library — an authoring shortcut so rule authors
// can search by the names they actually carry in their heads ("metformin",
// "type 2 diabetes", "systolic blood pressure") and have the right
// (system, code, display) triple filled in for them.
//
// Coverage: roughly the 60 concepts that show up in the demo's HTN /
// DM2 / metformin / ophth referral chain plus their common siblings
// (other antidiabetics, cardio-renal labs, common chronic conditions,
// preventive screenings). Everything points at the canonical FHIR R4
// terminology system (SNOMED CT, LOINC, RxNorm) so a downstream
// validator gets a clean code.
//
// `category` and `synonyms` exist purely for the UI's filter — neither
// makes it into the FHIR Bundle.

export type CodeKind =
  | 'condition'   // SNOMED — clinical findings, disorders
  | 'observation' // LOINC — lab tests, vital signs
  | 'medication'  // RxNorm — drugs / drug products
  | 'procedure'   // SNOMED — procedures, screenings
  | 'specialty';  // SNOMED — clinical specialties (used on Encounter.type)

export interface CodeEntry {
  system: string;
  code: string;
  display: string;
  kind: CodeKind;
  synonyms?: string[];   // alt names users might type
}

// ---------- Conditions (SNOMED CT) ----------
const SNOMED = 'http://snomed.info/sct';
const conditions: CodeEntry[] = [
  { system: SNOMED, code: '38341003',   display: 'Hypertensive disorder',          kind: 'condition', synonyms: ['htn', 'high blood pressure', 'hypertension'] },
  { system: SNOMED, code: '59621000',   display: 'Essential hypertension',         kind: 'condition', synonyms: ['primary hypertension'] },
  { system: SNOMED, code: '44054006',   display: 'Type 2 diabetes mellitus',       kind: 'condition', synonyms: ['t2dm', 'dm2', 'type 2 diabetes', 'diabetes'] },
  { system: SNOMED, code: '46635009',   display: 'Type 1 diabetes mellitus',       kind: 'condition', synonyms: ['t1dm', 'type 1 diabetes', 'iddm'] },
  { system: SNOMED, code: '4855003',    display: 'Diabetic retinopathy',           kind: 'condition', synonyms: ['retinopathy'] },
  { system: SNOMED, code: '127013003',  display: 'Diabetic nephropathy',           kind: 'condition', synonyms: ['nephropathy'] },
  { system: SNOMED, code: '414915002',  display: 'Obesity',                        kind: 'condition' },
  { system: SNOMED, code: '55822004',   display: 'Hyperlipidemia',                 kind: 'condition', synonyms: ['high cholesterol', 'dyslipidemia'] },
  { system: SNOMED, code: '53741008',   display: 'Coronary artery disease',        kind: 'condition', synonyms: ['cad', 'ihd', 'ischemic heart disease'] },
  { system: SNOMED, code: '195967001',  display: 'Asthma',                         kind: 'condition' },
  { system: SNOMED, code: '13645005',   display: 'Chronic obstructive pulmonary disease', kind: 'condition', synonyms: ['copd'] },
  { system: SNOMED, code: '90708001',   display: 'Kidney disease',                 kind: 'condition', synonyms: ['ckd', 'chronic kidney disease'] },
  { system: SNOMED, code: '49436004',   display: 'Atrial fibrillation',            kind: 'condition', synonyms: ['afib', 'a-fib'] },
  { system: SNOMED, code: '230690007',  display: 'Cerebrovascular accident',       kind: 'condition', synonyms: ['stroke', 'cva'] },
  { system: SNOMED, code: '22298006',   display: 'Myocardial infarction',          kind: 'condition', synonyms: ['mi', 'heart attack'] },
  { system: SNOMED, code: '84114007',   display: 'Heart failure',                  kind: 'condition', synonyms: ['chf', 'congestive heart failure'] },
  { system: SNOMED, code: '370247008',  display: 'Pregnancy',                      kind: 'condition' },
  { system: SNOMED, code: '370388006',  display: 'Tobacco smoking behavior',       kind: 'condition', synonyms: ['smoker', 'smoking'] },
];

// ---------- Observations / labs / vitals (LOINC) ----------
const LOINC = 'http://loinc.org';
const observations: CodeEntry[] = [
  { system: LOINC, code: '8480-6',   display: 'Systolic blood pressure',           kind: 'observation', synonyms: ['sbp', 'bp systolic'] },
  { system: LOINC, code: '8462-4',   display: 'Diastolic blood pressure',          kind: 'observation', synonyms: ['dbp', 'bp diastolic'] },
  { system: LOINC, code: '4548-4',   display: 'Hemoglobin A1c',                    kind: 'observation', synonyms: ['hba1c', 'a1c', 'glycated hemoglobin'] },
  { system: LOINC, code: '1558-6',   display: 'Fasting plasma glucose',            kind: 'observation', synonyms: ['fpg', 'fbs', 'fasting glucose'] },
  { system: LOINC, code: '2345-7',   display: 'Glucose',                           kind: 'observation' },
  { system: LOINC, code: '2160-0',   display: 'Creatinine',                        kind: 'observation', synonyms: ['serum creatinine'] },
  { system: LOINC, code: '33914-3',  display: 'eGFR',                              kind: 'observation', synonyms: ['estimated gfr', 'glomerular filtration rate'] },
  { system: LOINC, code: '2093-3',   display: 'Total cholesterol',                 kind: 'observation', synonyms: ['cholesterol'] },
  { system: LOINC, code: '13457-7',  display: 'LDL cholesterol',                   kind: 'observation', synonyms: ['ldl'] },
  { system: LOINC, code: '2085-9',   display: 'HDL cholesterol',                   kind: 'observation', synonyms: ['hdl'] },
  { system: LOINC, code: '2571-8',   display: 'Triglycerides',                     kind: 'observation' },
  { system: LOINC, code: '39156-5',  display: 'Body mass index',                   kind: 'observation', synonyms: ['bmi'] },
  { system: LOINC, code: '29463-7',  display: 'Body weight',                       kind: 'observation', synonyms: ['weight'] },
  { system: LOINC, code: '8302-2',   display: 'Body height',                       kind: 'observation', synonyms: ['height'] },
  { system: LOINC, code: '8867-4',   display: 'Heart rate',                        kind: 'observation', synonyms: ['pulse', 'hr'] },
  { system: LOINC, code: '2823-3',   display: 'Potassium',                         kind: 'observation', synonyms: ['k+'] },
  { system: LOINC, code: '2951-2',   display: 'Sodium',                            kind: 'observation', synonyms: ['na+'] },
  { system: LOINC, code: '14749-6',  display: 'Glucose tolerance test',            kind: 'observation', synonyms: ['ogtt'] },
];

// ---------- Medications (RxNorm — using RxCUI codes) ----------
const RXNORM = 'http://www.nlm.nih.gov/research/umls/rxnorm';
const medications: CodeEntry[] = [
  { system: RXNORM, code: '861007',   display: 'metformin 1000 MG oral tablet',   kind: 'medication', synonyms: ['metformin'] },
  { system: RXNORM, code: '860975',   display: 'metformin 500 MG oral tablet',    kind: 'medication' },
  { system: RXNORM, code: '197361',   display: 'lisinopril 10 MG oral tablet',    kind: 'medication', synonyms: ['lisinopril', 'ace inhibitor'] },
  { system: RXNORM, code: '197379',   display: 'lisinopril 20 MG oral tablet',    kind: 'medication' },
  { system: RXNORM, code: '316672',   display: 'losartan 50 MG oral tablet',      kind: 'medication', synonyms: ['losartan', 'arb'] },
  { system: RXNORM, code: '198211',   display: 'atorvastatin 40 MG oral tablet',  kind: 'medication', synonyms: ['atorvastatin', 'statin'] },
  { system: RXNORM, code: '617314',   display: 'rosuvastatin 20 MG oral tablet',  kind: 'medication', synonyms: ['rosuvastatin'] },
  { system: RXNORM, code: '849574',   display: 'amlodipine 5 MG oral tablet',     kind: 'medication', synonyms: ['amlodipine', 'calcium channel blocker'] },
  { system: RXNORM, code: '197884',   display: 'hydrochlorothiazide 25 MG oral tablet', kind: 'medication', synonyms: ['hctz', 'hydrochlorothiazide', 'diuretic'] },
  { system: RXNORM, code: '243670',   display: 'metoprolol succinate 50 MG oral tablet', kind: 'medication', synonyms: ['metoprolol', 'beta blocker'] },
  { system: RXNORM, code: '1804447',  display: 'empagliflozin 25 MG oral tablet', kind: 'medication', synonyms: ['empagliflozin', 'sglt2 inhibitor'] },
  { system: RXNORM, code: '1599428',  display: 'liraglutide injection',           kind: 'medication', synonyms: ['liraglutide', 'glp-1'] },
  { system: RXNORM, code: '243845',   display: 'aspirin 81 MG oral tablet',       kind: 'medication', synonyms: ['aspirin', 'asa'] },
  { system: RXNORM, code: '855288',   display: 'warfarin 5 MG oral tablet',       kind: 'medication', synonyms: ['warfarin', 'coumadin'] },
];

// (Procedure / screening codes removed — engine has no Procedure Ob yet.
// Re-add this block when clinical_state_multi.jl gains a Procedure type.)

// ---------- Specialties (SNOMED CT — for Encounter.type) ----------
const specialties: CodeEntry[] = [
  { system: SNOMED, code: '408451005', display: 'Ophthalmology',                  kind: 'specialty', synonyms: ['eye doctor'] },
  { system: SNOMED, code: '394583002', display: 'Endocrinology',                  kind: 'specialty', synonyms: ['endocrine'] },
  { system: SNOMED, code: '394579002', display: 'Cardiology',                     kind: 'specialty', synonyms: ['cardio', 'heart'] },
  { system: SNOMED, code: '394802001', display: 'General medicine',               kind: 'specialty', synonyms: ['internal medicine', 'pcp'] },
  { system: SNOMED, code: '419192003', display: 'Internal medicine',              kind: 'specialty' },
  { system: SNOMED, code: '394814009', display: 'Family medicine',                kind: 'specialty', synonyms: ['family practice'] },
  { system: SNOMED, code: '394591006', display: 'Nephrology',                     kind: 'specialty', synonyms: ['kidney'] },
  { system: SNOMED, code: '394586005', display: 'Gynecology',                     kind: 'specialty' },
  { system: SNOMED, code: '394601007', display: 'Rheumatology',                   kind: 'specialty', synonyms: ['arthritis'] },
];

// All entries flat. The picker filters by the resource type's
// allowed kinds (Condition → 'condition', Observation → 'observation',
// MedicationRequest → 'medication', Encounter → 'specialty', etc.).
export const CODE_LIBRARY: CodeEntry[] = [
  ...conditions, ...observations, ...medications, ...specialties,
];

// Which `kind`s are clinically appropriate for a given FHIR resource type.
// Used to scope the autocomplete so a Condition lookup doesn't surface
// LOINC observation codes.
export const KINDS_FOR_TYPE: Record<string, CodeKind[]> = {
  Condition:         ['condition'],
  Observation:       ['observation'],
  MedicationRequest: ['medication'],
  Appointment:       ['specialty'],
  Encounter:         ['specialty'],
  // Allow everything for ambiguous types so the picker still works.
};

// Resolve a (system, code) pair to its canonical display string. Used
// as a fallback so NAC patterns — whose codeDisplay is a template
// variable like '${existingDisplay}' so the NAC matches any pre-existing
// resource of that code regardless of how its display was authored —
// still render a meaningful label on the canvas. The display surfaces
// from the LITERAL identity (system + value), the NAC's actual matching
// criterion, rather than from a templated string.
const _CODE_INDEX = new Map<string, string>();
for (const e of CODE_LIBRARY) _CODE_INDEX.set(`${e.system}|${e.code}`, e.display);
export function displayByCode(system: string, code: string): string {
  if (!system || !code) return '';
  return _CODE_INDEX.get(`${system}|${code}`) ?? '';
}

// Search the library by free text. Matches against display + synonyms,
// case-insensitive, substring. Limits the kinds to those clinically
// appropriate for the FHIR resource being authored.
export function searchCodes(query: string, type: string | undefined, limit = 12): CodeEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const allowed = type ? KINDS_FOR_TYPE[type] : undefined;
  const hits: CodeEntry[] = [];
  for (const e of CODE_LIBRARY) {
    if (allowed && !allowed.includes(e.kind)) continue;
    const haystack = [e.display, ...(e.synonyms ?? []), e.code].join(' ').toLowerCase();
    if (haystack.includes(q)) hits.push(e);
    if (hits.length >= limit) break;
  }
  return hits;
}
