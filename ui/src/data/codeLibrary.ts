// Curated clinical-code library — an authoring shortcut so rule authors
// can search by the names they actually carry in their heads ("metformin",
// "type 2 diabetes", "systolic blood pressure") and have the right
// (system, code, display) triple filled in for them.
//
// Coverage: the original ~60 concepts from the demo's HTN / DM2 /
// metformin / ophth referral chain, plus a broader catalogue across
// the most common primary-care domains — cardio-metabolic, mental
// health, endocrine, GI, neuro, MSK, infectious disease, oncology,
// vascular, derm/allergy — and the labs / meds / specialties that
// pair with them. Everything points at the canonical FHIR R4
// terminology system (SNOMED CT, LOINC, RxNorm) so a downstream
// validator gets a clean code.
//
// `synonyms` exists purely for the UI's filter — it doesn't make it
// into the FHIR Bundle. Add aggressively: every alternate name a
// clinician might type ("hctz", "afib", "a1c") should resolve to the
// canonical entry.

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
  // Cardio-metabolic
  { system: SNOMED, code: '38341003',   display: 'Hypertensive disorder',          kind: 'condition', synonyms: ['htn', 'high blood pressure', 'hypertension'] },
  { system: SNOMED, code: '59621000',   display: 'Essential hypertension',         kind: 'condition', synonyms: ['primary hypertension'] },
  { system: SNOMED, code: '44054006',   display: 'Type 2 diabetes mellitus',       kind: 'condition', synonyms: ['t2dm', 'dm2', 'type 2 diabetes', 'diabetes'] },
  { system: SNOMED, code: '46635009',   display: 'Type 1 diabetes mellitus',       kind: 'condition', synonyms: ['t1dm', 'type 1 diabetes', 'iddm'] },
  { system: SNOMED, code: '9414007',    display: 'Impaired glucose tolerance',     kind: 'condition', synonyms: ['prediabetes', 'pre-diabetes', 'igt'] },
  { system: SNOMED, code: '4855003',    display: 'Diabetic retinopathy',           kind: 'condition', synonyms: ['retinopathy'] },
  { system: SNOMED, code: '127013003',  display: 'Diabetic nephropathy',           kind: 'condition', synonyms: ['nephropathy'] },
  { system: SNOMED, code: '414915002',  display: 'Obesity',                        kind: 'condition' },
  { system: SNOMED, code: '55822004',   display: 'Hyperlipidemia',                 kind: 'condition', synonyms: ['high cholesterol', 'dyslipidemia'] },
  { system: SNOMED, code: '53741008',   display: 'Coronary artery disease',        kind: 'condition', synonyms: ['cad', 'ihd', 'ischemic heart disease'] },
  { system: SNOMED, code: '49436004',   display: 'Atrial fibrillation',            kind: 'condition', synonyms: ['afib', 'a-fib'] },
  { system: SNOMED, code: '230690007',  display: 'Cerebrovascular accident',       kind: 'condition', synonyms: ['stroke', 'cva'] },
  { system: SNOMED, code: '22298006',   display: 'Myocardial infarction',          kind: 'condition', synonyms: ['mi', 'heart attack'] },
  { system: SNOMED, code: '84114007',   display: 'Heart failure',                  kind: 'condition', synonyms: ['chf', 'congestive heart failure'] },
  { system: SNOMED, code: '399957001',  display: 'Peripheral arterial disease',    kind: 'condition', synonyms: ['pad', 'pvd', 'peripheral vascular disease'] },
  { system: SNOMED, code: '128053003',  display: 'Deep vein thrombosis',           kind: 'condition', synonyms: ['dvt'] },
  { system: SNOMED, code: '59282003',   display: 'Pulmonary embolism',             kind: 'condition', synonyms: ['pe'] },

  // Pulmonary
  { system: SNOMED, code: '195967001',  display: 'Asthma',                         kind: 'condition' },
  { system: SNOMED, code: '13645005',   display: 'Chronic obstructive pulmonary disease', kind: 'condition', synonyms: ['copd'] },
  { system: SNOMED, code: '90708001',   display: 'Kidney disease',                 kind: 'condition', synonyms: ['ckd', 'chronic kidney disease'] },

  // Mental health
  { system: SNOMED, code: '370143000',  display: 'Major depressive disorder',      kind: 'condition', synonyms: ['mdd', 'depression'] },
  { system: SNOMED, code: '48694002',   display: 'Anxiety',                        kind: 'condition', synonyms: ['anxiety disorder', 'gad', 'generalized anxiety'] },
  { system: SNOMED, code: '13746004',   display: 'Bipolar disorder',               kind: 'condition', synonyms: ['bipolar', 'manic depression'] },
  { system: SNOMED, code: '406506008',  display: 'Attention deficit hyperactivity disorder', kind: 'condition', synonyms: ['adhd', 'add'] },
  { system: SNOMED, code: '47505003',   display: 'Posttraumatic stress disorder',  kind: 'condition', synonyms: ['ptsd'] },

  // Endocrine / thyroid
  { system: SNOMED, code: '40930008',   display: 'Hypothyroidism',                 kind: 'condition', synonyms: ['underactive thyroid'] },
  { system: SNOMED, code: '34486009',   display: 'Hyperthyroidism',                kind: 'condition', synonyms: ['overactive thyroid', 'graves disease'] },

  // GI
  { system: SNOMED, code: '235595009',  display: 'Gastroesophageal reflux disease',kind: 'condition', synonyms: ['gerd', 'reflux', 'acid reflux'] },
  { system: SNOMED, code: '10743008',   display: 'Irritable bowel syndrome',       kind: 'condition', synonyms: ['ibs'] },
  { system: SNOMED, code: '34000006',   display: "Crohn's disease",                kind: 'condition', synonyms: ['crohns', 'ibd'] },
  { system: SNOMED, code: '64766004',   display: 'Ulcerative colitis',             kind: 'condition', synonyms: ['uc', 'ibd'] },

  // Neuro
  { system: SNOMED, code: '37796009',   display: 'Migraine',                       kind: 'condition', synonyms: ['migraine headache'] },
  { system: SNOMED, code: '84757009',   display: 'Epilepsy',                       kind: 'condition', synonyms: ['seizure disorder'] },
  { system: SNOMED, code: '49049000',   display: "Parkinson's disease",            kind: 'condition', synonyms: ['parkinsons', 'pd'] },
  { system: SNOMED, code: '26929004',   display: "Alzheimer's disease",            kind: 'condition', synonyms: ['alzheimers'] },
  { system: SNOMED, code: '52448006',   display: 'Dementia',                       kind: 'condition' },

  // MSK / rheum
  { system: SNOMED, code: '396275006',  display: 'Osteoarthritis',                 kind: 'condition', synonyms: ['oa', 'degenerative joint disease', 'djd'] },
  { system: SNOMED, code: '69896004',   display: 'Rheumatoid arthritis',           kind: 'condition', synonyms: ['ra'] },
  { system: SNOMED, code: '64859006',   display: 'Osteoporosis',                   kind: 'condition' },
  { system: SNOMED, code: '90560007',   display: 'Gout',                           kind: 'condition' },
  { system: SNOMED, code: '279039007',  display: 'Low back pain',                  kind: 'condition', synonyms: ['back pain', 'lbp'] },

  // Infectious disease
  { system: SNOMED, code: '233604007',  display: 'Pneumonia',                      kind: 'condition' },
  { system: SNOMED, code: '68566005',   display: 'Urinary tract infection',        kind: 'condition', synonyms: ['uti'] },
  { system: SNOMED, code: '91302008',   display: 'Sepsis',                         kind: 'condition' },
  { system: SNOMED, code: '840539006',  display: 'COVID-19',                       kind: 'condition', synonyms: ['sars-cov-2', 'coronavirus'] },
  { system: SNOMED, code: '6142004',    display: 'Influenza',                      kind: 'condition', synonyms: ['flu'] },
  { system: SNOMED, code: '86406008',   display: 'Human immunodeficiency virus infection', kind: 'condition', synonyms: ['hiv'] },

  // Oncology
  { system: SNOMED, code: '254837009',  display: 'Malignant neoplasm of breast',   kind: 'condition', synonyms: ['breast cancer'] },
  { system: SNOMED, code: '399068003',  display: 'Malignant neoplasm of prostate', kind: 'condition', synonyms: ['prostate cancer'] },
  { system: SNOMED, code: '363358000',  display: 'Malignant neoplasm of lung',     kind: 'condition', synonyms: ['lung cancer'] },
  { system: SNOMED, code: '363406005',  display: 'Malignant neoplasm of colon',    kind: 'condition', synonyms: ['colon cancer', 'colorectal cancer'] },

  // Heme / derm / allergy
  { system: SNOMED, code: '271737000',  display: 'Anemia',                         kind: 'condition' },
  { system: SNOMED, code: '87522002',   display: 'Iron deficiency anemia',         kind: 'condition', synonyms: ['ida'] },
  { system: SNOMED, code: '61582004',   display: 'Allergic rhinitis',              kind: 'condition', synonyms: ['hay fever', 'seasonal allergies'] },
  { system: SNOMED, code: '24079001',   display: 'Atopic dermatitis',              kind: 'condition', synonyms: ['eczema'] },
  { system: SNOMED, code: '9014002',    display: 'Psoriasis',                      kind: 'condition' },

  // Lifestyle / pregnancy
  { system: SNOMED, code: '370247008',  display: 'Pregnancy',                      kind: 'condition' },
  { system: SNOMED, code: '370388006',  display: 'Tobacco smoking behavior',       kind: 'condition', synonyms: ['smoker', 'smoking'] },
];

// ---------- Observations / labs / vitals (LOINC) ----------
const LOINC = 'http://loinc.org';
const observations: CodeEntry[] = [
  // Vitals
  { system: LOINC, code: '8480-6',   display: 'Systolic blood pressure',           kind: 'observation', synonyms: ['sbp', 'bp systolic'] },
  { system: LOINC, code: '8462-4',   display: 'Diastolic blood pressure',          kind: 'observation', synonyms: ['dbp', 'bp diastolic'] },
  { system: LOINC, code: '8867-4',   display: 'Heart rate',                        kind: 'observation', synonyms: ['pulse', 'hr'] },
  { system: LOINC, code: '9279-1',   display: 'Respiratory rate',                  kind: 'observation', synonyms: ['rr', 'respirations'] },
  { system: LOINC, code: '8310-5',   display: 'Body temperature',                  kind: 'observation', synonyms: ['temp', 'temperature', 'fever'] },
  { system: LOINC, code: '59408-5',  display: 'Oxygen saturation',                 kind: 'observation', synonyms: ['spo2', 'pulse ox', 'o2 sat'] },

  // Anthropometric
  { system: LOINC, code: '39156-5',  display: 'Body mass index',                   kind: 'observation', synonyms: ['bmi'] },
  { system: LOINC, code: '29463-7',  display: 'Body weight',                       kind: 'observation', synonyms: ['weight'] },
  { system: LOINC, code: '8302-2',   display: 'Body height',                       kind: 'observation', synonyms: ['height'] },

  // Diabetes / glucose
  { system: LOINC, code: '4548-4',   display: 'Hemoglobin A1c',                    kind: 'observation', synonyms: ['hba1c', 'a1c', 'glycated hemoglobin'] },
  { system: LOINC, code: '1558-6',   display: 'Fasting plasma glucose',            kind: 'observation', synonyms: ['fpg', 'fbs', 'fasting glucose'] },
  { system: LOINC, code: '2345-7',   display: 'Glucose',                           kind: 'observation' },
  { system: LOINC, code: '14749-6',  display: 'Glucose tolerance test',            kind: 'observation', synonyms: ['ogtt'] },

  // Renal / electrolytes
  { system: LOINC, code: '2160-0',   display: 'Creatinine',                        kind: 'observation', synonyms: ['serum creatinine', 'scr'] },
  { system: LOINC, code: '33914-3',  display: 'eGFR',                              kind: 'observation', synonyms: ['estimated gfr', 'glomerular filtration rate'] },
  { system: LOINC, code: '2823-3',   display: 'Potassium',                         kind: 'observation', synonyms: ['k+'] },
  { system: LOINC, code: '2951-2',   display: 'Sodium',                            kind: 'observation', synonyms: ['na+'] },
  { system: LOINC, code: '9318-7',   display: 'Albumin/Creatinine ratio (urine)',  kind: 'observation', synonyms: ['acr', 'microalbumin', 'urine microalbumin'] },

  // Lipids
  { system: LOINC, code: '2093-3',   display: 'Total cholesterol',                 kind: 'observation', synonyms: ['cholesterol'] },
  { system: LOINC, code: '13457-7',  display: 'LDL cholesterol',                   kind: 'observation', synonyms: ['ldl'] },
  { system: LOINC, code: '2085-9',   display: 'HDL cholesterol',                   kind: 'observation', synonyms: ['hdl'] },
  { system: LOINC, code: '2571-8',   display: 'Triglycerides',                     kind: 'observation' },

  // Thyroid
  { system: LOINC, code: '3016-3',   display: 'Thyroid stimulating hormone',       kind: 'observation', synonyms: ['tsh'] },
  { system: LOINC, code: '3024-7',   display: 'Free T4',                           kind: 'observation', synonyms: ['ft4', 'free thyroxine'] },

  // Hepatic
  { system: LOINC, code: '1920-8',   display: 'Aspartate aminotransferase',        kind: 'observation', synonyms: ['ast', 'sgot'] },
  { system: LOINC, code: '1742-6',   display: 'Alanine aminotransferase',          kind: 'observation', synonyms: ['alt', 'sgpt'] },
  { system: LOINC, code: '6768-6',   display: 'Alkaline phosphatase',              kind: 'observation', synonyms: ['alk phos', 'alp'] },
  { system: LOINC, code: '1975-2',   display: 'Total bilirubin',                   kind: 'observation', synonyms: ['bilirubin'] },
  { system: LOINC, code: '1751-7',   display: 'Albumin',                           kind: 'observation' },

  // CBC
  { system: LOINC, code: '6690-2',   display: 'Leukocytes in blood',               kind: 'observation', synonyms: ['wbc', 'white blood cell count'] },
  { system: LOINC, code: '718-7',    display: 'Hemoglobin',                        kind: 'observation', synonyms: ['hgb', 'hb'] },
  { system: LOINC, code: '4544-3',   display: 'Hematocrit',                        kind: 'observation', synonyms: ['hct'] },
  { system: LOINC, code: '777-3',    display: 'Platelets',                         kind: 'observation', synonyms: ['platelet count', 'plt'] },

  // Vitamins / iron studies
  { system: LOINC, code: '14635-7',  display: '25-hydroxyvitamin D',               kind: 'observation', synonyms: ['vitamin d', 'vit d', '25-oh d'] },
  { system: LOINC, code: '2132-9',   display: 'Vitamin B12',                       kind: 'observation', synonyms: ['b12', 'cobalamin'] },
  { system: LOINC, code: '2276-4',   display: 'Ferritin',                          kind: 'observation' },
  { system: LOINC, code: '2498-4',   display: 'Iron',                              kind: 'observation', synonyms: ['serum iron'] },

  // Cardiac / coag / inflammation
  { system: LOINC, code: '10839-9',  display: 'Troponin I',                        kind: 'observation', synonyms: ['troponin', 'tni'] },
  { system: LOINC, code: '30934-4',  display: 'Natriuretic peptide B',             kind: 'observation', synonyms: ['bnp', 'nt-probnp'] },
  { system: LOINC, code: '6301-6',   display: 'INR',                               kind: 'observation', synonyms: ['international normalized ratio'] },
  { system: LOINC, code: '5902-2',   display: 'Prothrombin time',                  kind: 'observation', synonyms: ['pt'] },
  { system: LOINC, code: '1988-5',   display: 'C-reactive protein',                kind: 'observation', synonyms: ['crp'] },

  // Oncology screening
  { system: LOINC, code: '2857-1',   display: 'Prostate specific antigen',         kind: 'observation', synonyms: ['psa'] },
];

// ---------- Medications (RxNorm — using RxCUI codes) ----------
const RXNORM = 'http://www.nlm.nih.gov/research/umls/rxnorm';
const medications: CodeEntry[] = [
  // Antidiabetics
  { system: RXNORM, code: '861007',   display: 'metformin 1000 MG oral tablet',   kind: 'medication', synonyms: ['metformin'] },
  { system: RXNORM, code: '860975',   display: 'metformin 500 MG oral tablet',    kind: 'medication' },
  { system: RXNORM, code: '1804447',  display: 'empagliflozin 25 MG oral tablet', kind: 'medication', synonyms: ['empagliflozin', 'sglt2 inhibitor', 'jardiance'] },
  { system: RXNORM, code: '1599428',  display: 'liraglutide injection',           kind: 'medication', synonyms: ['liraglutide', 'glp-1', 'victoza'] },
  { system: RXNORM, code: '1991302',  display: 'semaglutide injection',           kind: 'medication', synonyms: ['semaglutide', 'ozempic', 'wegovy', 'glp-1'] },
  { system: RXNORM, code: '727316',   display: 'sitagliptin 100 MG oral tablet',  kind: 'medication', synonyms: ['sitagliptin', 'dpp-4 inhibitor', 'januvia'] },
  { system: RXNORM, code: '310489',   display: 'glipizide 5 MG oral tablet',      kind: 'medication', synonyms: ['glipizide', 'sulfonylurea'] },
  { system: RXNORM, code: '285018',   display: 'insulin glargine 100 UNT/ML injection', kind: 'medication', synonyms: ['insulin glargine', 'lantus', 'basal insulin'] },

  // Antihypertensives — ACEi / ARB
  { system: RXNORM, code: '197361',   display: 'lisinopril 10 MG oral tablet',    kind: 'medication', synonyms: ['lisinopril', 'ace inhibitor', 'acei'] },
  { system: RXNORM, code: '197379',   display: 'lisinopril 20 MG oral tablet',    kind: 'medication' },
  { system: RXNORM, code: '197731',   display: 'enalapril 10 MG oral tablet',     kind: 'medication', synonyms: ['enalapril', 'ace inhibitor'] },
  { system: RXNORM, code: '316672',   display: 'losartan 50 MG oral tablet',      kind: 'medication', synonyms: ['losartan', 'arb'] },
  { system: RXNORM, code: '349199',   display: 'valsartan 80 MG oral tablet',     kind: 'medication', synonyms: ['valsartan', 'arb', 'diovan'] },

  // Antihypertensives — CCB / beta blocker / diuretic
  { system: RXNORM, code: '849574',   display: 'amlodipine 5 MG oral tablet',     kind: 'medication', synonyms: ['amlodipine', 'calcium channel blocker', 'ccb'] },
  { system: RXNORM, code: '197884',   display: 'hydrochlorothiazide 25 MG oral tablet', kind: 'medication', synonyms: ['hctz', 'hydrochlorothiazide', 'thiazide', 'diuretic'] },
  { system: RXNORM, code: '243670',   display: 'metoprolol succinate 50 MG oral tablet', kind: 'medication', synonyms: ['metoprolol', 'beta blocker'] },
  { system: RXNORM, code: '200031',   display: 'carvedilol 12.5 MG oral tablet',  kind: 'medication', synonyms: ['carvedilol', 'beta blocker'] },
  { system: RXNORM, code: '310429',   display: 'furosemide 40 MG oral tablet',    kind: 'medication', synonyms: ['furosemide', 'lasix', 'loop diuretic'] },
  { system: RXNORM, code: '313096',   display: 'spironolactone 25 MG oral tablet',kind: 'medication', synonyms: ['spironolactone', 'aldactone', 'potassium sparing diuretic'] },

  // Lipid-lowering
  { system: RXNORM, code: '198211',   display: 'atorvastatin 40 MG oral tablet',  kind: 'medication', synonyms: ['atorvastatin', 'lipitor', 'statin'] },
  { system: RXNORM, code: '617314',   display: 'rosuvastatin 20 MG oral tablet',  kind: 'medication', synonyms: ['rosuvastatin', 'crestor', 'statin'] },
  { system: RXNORM, code: '198212',   display: 'simvastatin 20 MG oral tablet',   kind: 'medication', synonyms: ['simvastatin', 'zocor', 'statin'] },
  { system: RXNORM, code: '197905',   display: 'pravastatin 20 MG oral tablet',   kind: 'medication', synonyms: ['pravastatin', 'pravachol', 'statin'] },

  // Antiplatelet / anticoagulant
  { system: RXNORM, code: '243845',   display: 'aspirin 81 MG oral tablet',       kind: 'medication', synonyms: ['aspirin', 'asa', 'baby aspirin'] },
  { system: RXNORM, code: '309362',   display: 'clopidogrel 75 MG oral tablet',   kind: 'medication', synonyms: ['clopidogrel', 'plavix'] },
  { system: RXNORM, code: '855288',   display: 'warfarin 5 MG oral tablet',       kind: 'medication', synonyms: ['warfarin', 'coumadin'] },
  { system: RXNORM, code: '1364435',  display: 'apixaban 5 MG oral tablet',       kind: 'medication', synonyms: ['apixaban', 'eliquis', 'doac'] },
  { system: RXNORM, code: '1114195',  display: 'rivaroxaban 20 MG oral tablet',   kind: 'medication', synonyms: ['rivaroxaban', 'xarelto', 'doac'] },

  // Psychiatric
  { system: RXNORM, code: '312940',   display: 'sertraline 50 MG oral tablet',    kind: 'medication', synonyms: ['sertraline', 'zoloft', 'ssri'] },
  { system: RXNORM, code: '310385',   display: 'fluoxetine 20 MG oral capsule',   kind: 'medication', synonyms: ['fluoxetine', 'prozac', 'ssri'] },
  { system: RXNORM, code: '352741',   display: 'escitalopram 10 MG oral tablet',  kind: 'medication', synonyms: ['escitalopram', 'lexapro', 'ssri'] },
  { system: RXNORM, code: '308047',   display: 'alprazolam 0.5 MG oral tablet',   kind: 'medication', synonyms: ['alprazolam', 'xanax', 'benzo'] },

  // Pain / NSAIDs / analgesics
  { system: RXNORM, code: '197806',   display: 'ibuprofen 400 MG oral tablet',    kind: 'medication', synonyms: ['ibuprofen', 'motrin', 'advil', 'nsaid'] },
  { system: RXNORM, code: '198440',   display: 'acetaminophen 500 MG oral tablet',kind: 'medication', synonyms: ['acetaminophen', 'tylenol', 'paracetamol'] },
  { system: RXNORM, code: '198013',   display: 'naproxen 500 MG oral tablet',     kind: 'medication', synonyms: ['naproxen', 'aleve', 'nsaid'] },
  { system: RXNORM, code: '310431',   display: 'gabapentin 300 MG oral capsule',  kind: 'medication', synonyms: ['gabapentin', 'neurontin'] },

  // Antibiotics
  { system: RXNORM, code: '308191',   display: 'amoxicillin 500 MG oral capsule', kind: 'medication', synonyms: ['amoxicillin', 'amoxil'] },
  { system: RXNORM, code: '308460',   display: 'azithromycin 250 MG oral tablet', kind: 'medication', synonyms: ['azithromycin', 'z-pak', 'zithromax'] },
  { system: RXNORM, code: '197517',   display: 'ciprofloxacin 500 MG oral tablet',kind: 'medication', synonyms: ['ciprofloxacin', 'cipro', 'fluoroquinolone'] },
  { system: RXNORM, code: '197698',   display: 'doxycycline 100 MG oral capsule', kind: 'medication', synonyms: ['doxycycline'] },
  { system: RXNORM, code: '309048',   display: 'cephalexin 500 MG oral capsule',  kind: 'medication', synonyms: ['cephalexin', 'keflex'] },

  // GI / PPIs
  { system: RXNORM, code: '198053',   display: 'omeprazole 20 MG oral capsule',   kind: 'medication', synonyms: ['omeprazole', 'prilosec', 'ppi'] },
  { system: RXNORM, code: '198052',   display: 'pantoprazole 40 MG oral tablet',  kind: 'medication', synonyms: ['pantoprazole', 'protonix', 'ppi'] },

  // Respiratory / inhalers
  { system: RXNORM, code: '329468',   display: 'albuterol HFA inhaler',           kind: 'medication', synonyms: ['albuterol', 'ventolin', 'proair', 'rescue inhaler', 'saba'] },
  { system: RXNORM, code: '895994',   display: 'fluticasone propionate inhaler',  kind: 'medication', synonyms: ['fluticasone', 'flovent', 'ics'] },
  { system: RXNORM, code: '199651',   display: 'montelukast 10 MG oral tablet',   kind: 'medication', synonyms: ['montelukast', 'singulair'] },
  { system: RXNORM, code: '583218',   display: 'tiotropium inhaler',              kind: 'medication', synonyms: ['tiotropium', 'spiriva', 'lama'] },

  // Endocrine / other
  { system: RXNORM, code: '966164',   display: 'levothyroxine 50 MCG oral tablet',kind: 'medication', synonyms: ['levothyroxine', 'synthroid'] },
  { system: RXNORM, code: '198142',   display: 'prednisone 5 MG oral tablet',     kind: 'medication', synonyms: ['prednisone', 'steroid'] },
  { system: RXNORM, code: '197322',   display: 'allopurinol 300 MG oral tablet',  kind: 'medication', synonyms: ['allopurinol', 'zyloprim'] },
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
  { system: SNOMED, code: '394582007', display: 'Dermatology',                    kind: 'specialty', synonyms: ['skin'] },
  { system: SNOMED, code: '394587001', display: 'Psychiatry',                     kind: 'specialty', synonyms: ['mental health'] },
  { system: SNOMED, code: '394610002', display: 'Neurology',                      kind: 'specialty', synonyms: ['brain', 'nerve'] },
  { system: SNOMED, code: '394801008', display: 'Orthopedics',                    kind: 'specialty', synonyms: ['ortho', 'bones', 'joints'] },
  { system: SNOMED, code: '418112009', display: 'Pulmonology',                    kind: 'specialty', synonyms: ['pulm', 'lungs', 'respiratory medicine'] },
  { system: SNOMED, code: '394593009', display: 'Medical oncology',               kind: 'specialty', synonyms: ['oncology', 'cancer'] },
  { system: SNOMED, code: '394584008', display: 'Gastroenterology',               kind: 'specialty', synonyms: ['gi', 'gastro'] },
  { system: SNOMED, code: '394612005', display: 'Urology',                        kind: 'specialty' },
  { system: SNOMED, code: '394803006', display: 'Clinical hematology',            kind: 'specialty', synonyms: ['hematology', 'blood'] },
  { system: SNOMED, code: '418960008', display: 'Otolaryngology',                 kind: 'specialty', synonyms: ['ent', 'ear nose throat'] },
  { system: SNOMED, code: '394537008', display: 'Pediatrics',                     kind: 'specialty', synonyms: ['peds', 'children'] },
  { system: SNOMED, code: '394807007', display: 'Infectious diseases',            kind: 'specialty', synonyms: ['id', 'infection'] },
  { system: SNOMED, code: '419772000', display: 'Allergy and immunology',         kind: 'specialty', synonyms: ['allergy', 'immunology'] },
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
