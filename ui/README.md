# Algebraic CDS — UI

Vite + React + TypeScript app for authoring FHIR resource graphs and CDS
rules, and firing them against patient state via the Julia engine.

Two modes:

- **Patient mode** — edit a patient as a FHIR resource graph.
- **Rule mode** — author a CDS rule as `L ← K → R` with optional NACs and
  attribute predicates, then visualize it firing against the patient.

## Run

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>.

The engine URL comes from the `VITE_CDS_URL` env var, defaulting to
`http://localhost:8081`. Start the engine in another terminal with
`julia --project=.. ../cds_server.jl` (from the parent repo).

## Build for production

```bash
npm run build      # outputs to ui/dist
npm run preview    # serves the build locally
```

For hosted production builds, see [`../DEPLOY.md`](../DEPLOY.md) — the
GitHub Actions workflow injects `VITE_CDS_URL` from a repo secret.

## File layout

```
ui/src/
├── main.tsx                Boots <App />
├── app.css                 Design tokens + all component CSS
├── App.tsx                 Top-level shell, two-document state, mergePostFire
├── components/
│   ├── Topbar.tsx          File menu, Run/Step dropdown, Templates, Tutorial
│   ├── Sidebar.tsx         Palette, drag-source resource types
│   ├── GraphCanvas.tsx     SVG canvas, drag-to-create edges, node preview
│   ├── DetailPanel.tsx     Right rail: code picker, predicate templates, leg toggles
│   ├── RuleLibrary.tsx     Saved rules + validation badges
│   ├── RuleInfoBar.tsx     Active-rule header
│   ├── LegFilter.tsx       Per-leg visibility filter
│   └── TutorialModal.tsx   Math + clinician-flavored walkthroughs
├── data/
│   ├── palette.ts          INITIAL_NODES + INITIAL_EDGES, TYPE_INFO
│   ├── sampleRules.ts      HTN, DM2, comorbid, metformin, ophth referral
│   ├── ruleTemplates.ts    9 rule pattern skeletons
│   ├── predicateTemplates.ts  8 clinical predicate templates
│   ├── codeLibrary.ts      ~60 SNOMED/LOINC/RxNorm entries + searchCodes
│   └── fhirDefaults.ts     Default field shape per resource type
└── lib/
    ├── ruleBundle.ts       FHIR Bundle build/parse for rule mode
    ├── validateRule.ts     Author-time structural checks
    ├── fhirpath.ts         Attribute taxonomy + FHIRPath generation
    ├── legs.ts             CORE_LEGS, NAC color tones
    ├── display.ts          displayOf chain + placeholder handling
    ├── layout.ts           Overlap relaxation
    ├── fsh.ts              FHIR Shorthand generator + highlighter
    ├── edgeLabels.ts       Reference-edge label rendering
    └── types.ts            Node, Edge, View, MIME constant
```

## Persistence

Three localStorage keys carry session state across reloads:

- `algebraic_cds_rules_v14` — rule library
- `algebraic_cds_patient_v1` — patient document
- `algebraic_cds_ui_v1`     — UI prefs

## Firing rules

Click **Run** to fire once or **Step** to fire incrementally. The UI posts
`{ rule, host }` to the engine's `/fire` endpoint and receives
`{ status, detail, state }`. `state` becomes the new patient document;
`detail` carries counterfactual information when a NAC blocks the match.
