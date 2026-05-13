// TutorialModal - full-page overlay rendering one of two tutorial flavors.
// "math" gives the categorical / DPO-rewriting treatment for theory-minded
// readers. "informatics" gives the same ideas in clinical-CDS language for
// readers who aren't here for category theory. Both share the same
// architecture diagram and FHIR mapping table; the framing differs.
//
// Click the X, click the backdrop, or press Escape to close.

import { useEffect } from 'react';

export type TutorialFlavor = 'math' | 'informatics';

interface Props {
  flavor: TutorialFlavor;
  onClose: () => void;
}

export function TutorialModal({ flavor, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="tutorial-overlay" onClick={onClose}>
      <div className="tutorial-page" onClick={(e) => e.stopPropagation()}>
        <button className="tutorial-close" onClick={onClose} title="Close">
          ✕
        </button>
        {flavor === 'math' ? <MathContent /> : <InformaticsContent />}
      </div>
    </div>
  );
}

// ============================================================
// Math flavor: categorical / algebraic graph rewriting treatment.
// ============================================================
function MathContent() {
  return (
    <article className="tutorial-content">
      <header className="tutorial-header">
        <div className="tutorial-tag">Theory</div>
        <h1>Algebraic CDS, the categorical view</h1>
        <p className="tutorial-lede">
          A clinical decision support engine built on attributed graph rewriting,
          implemented over Catlab ACSets with FHIR R4 as the wire format.
        </p>
      </header>

      <section>
        <h2>1. The state object</h2>
        <p>
          The patient state and every rule pattern are instances of an
          attributed C-set (an <em>ACSet</em>) over a fixed schema
          {' '}<code>SchClinicalState</code>. The schema is a finite presentation
          of a free category with attribute types attached:
        </p>
        <pre className="tutorial-code">{`@present SchClinicalState(FreeSchema) begin
  Observation::Ob
  Condition::Ob
  ClinicalImpression::Ob

  Finding::Ob
  finImpression::Hom(Finding, ClinicalImpression)
  finObservation::Hom(Finding, Observation)

  Diagnosis::Ob
  diagImpression::Hom(Diagnosis, ClinicalImpression)
  diagCondition::Hom(Diagnosis, Condition)

  StringAttr::AttrType
  FloatAttr::AttrType
  TimeAttr::AttrType

  obsCodeSystem, obsCodeValue,
    obsCodeDisplay, obsValueUnit, obsStatus :: Attr(Observation, StringAttr)
  obsValueMagnitude :: Attr(Observation, FloatAttr)
  obsEffective      :: Attr(Observation, TimeAttr)
  ...
end`}</pre>
        <p>
          A model of this schema is a functor from the schema's free category
          into <strong>Set</strong> respecting the attribute carriers. Concretely,
          a state assigns each <code>Ob</code> a finite carrier set of "rows" and
          each <code>Hom</code> a function between those carriers; attribute
          slots take values in the chosen carriers (<code>String</code>,
          <code>Float64</code>, <code>DateTime</code>).
        </p>
        <p>
          The two junction objects <code>Finding</code> and <code>Diagnosis</code>
          act as edge sets: they witness <code>ClinicalImpression.finding[]</code>
          and <code>ClinicalImpression.problem[]</code> respectively. This is the
          standard relational encoding of a many-to-many relation as a span.
        </p>
      </section>

      <section>
        <h2>2. Rules as DPO spans</h2>
        <p>
          A rule is a <strong>double-pushout (DPO) span</strong> in the category
          of ACSets:
        </p>
        <pre className="tutorial-diagram">{`     l       r
  L ←──── K ────→ R`}</pre>
        <p>
          where <em>l</em> and <em>r</em> are monomorphisms. The interface
          <em>K</em> is the substructure preserved across the rewrite. Elements
          of <code>L \\ image(l)</code> are deleted; elements of
          {' '}<code>R \\ image(r)</code> are created. The standard DPO axioms
          (gluing condition + dangling condition) ensure the rewrite step is
          well defined when a match <em>m: L → G</em> is found.
        </p>
        <p>
          Firing a rule on a host state <em>G</em> proceeds by:
        </p>
        <ol>
          <li>Find a homomorphism <em>m: L → G</em> (we use{' '}
            <code>homomorphism(L, G; any=true)</code> from Catlab).
          </li>
          <li>Compute the pushout complement <em>D</em> of <em>l</em> and{' '}
            <em>m</em>, which exists iff the gluing/dangling conditions hold.
          </li>
          <li>Compute the pushout of <em>r</em> and the morphism{' '}
            <em>K → D</em>, yielding <em>G'</em>.
          </li>
        </ol>
        <p>
          The result <em>G'</em> is the post-fire state.
        </p>
      </section>

      <section>
        <h2>3. Application conditions</h2>
        <p>
          Pure DPO is too permissive for clinical rules; we layer on
          <strong>application conditions (ACs)</strong>. A negative AC (NAC) is a
          monomorphism <em>n: L → N</em>; the rule is blocked at match{' '}
          <em>m</em> iff there exists{' '}
          <em>h: N → G</em> with <em>h ∘ n = m</em>. Equivalently, <em>m</em>{' '}
          extends to a match of <em>N</em>. Positive ACs (PACs) negate this:
          {' '}<em>m</em> must extend.
        </p>
        <pre className="tutorial-code">{`# cds_rule.jl
function appcond_violated(n::ACSetTransformation,
                          m::ACSetTransformation; positive::Bool)
    positive ? !extension_exists(n, m) : extension_exists(n, m)
end`}</pre>
      </section>

      <section>
        <h2>4. Attribute predicates</h2>
        <p>
          Constraints over attribute values (HbA1c ≥ 6.5, SBP ≥ 140) cannot be
          expressed as ACSet morphism constraints because they range over the
          attribute carrier types, not the index category. We add a logical
          layer: a finite list of predicates
          <em> p: Match → Bool</em> evaluated after the structural match
          succeeds. Match firing succeeds iff every predicate returns true.
        </p>
        <pre className="tutorial-code">{`struct AttrPredicate <: Function
    code_system::String
    code_value::String
    code_display::String
    attr::Symbol
    op::Function
    threshold::Any
end`}</pre>
      </section>

      <section>
        <h2>5. Attribute variables</h2>
        <p>
          Catlab models <em>attribute variables</em> {' '}
          <code>AttrVar(n)</code> as elements of the AttrType carrier that
          unify against any value during homomorphism search. This is how an
          L pattern says "match any obs with code LOINC 4548-4 regardless of
          value" while still being a typed ACSet. Variables shared across legs
          (a TimeAttr <code>AttrVar(1)</code> in both <em>K</em> and <em>R</em>)
          encode equality constraints between attribute slots.
        </p>
        <p>
          On the wire, AttrVars are encoded as FHIR primitive-type extensions
          carrying a stable variable name; the parser allocates an{' '}
          <code>AttrVar</code> per unique name per AttrType.
        </p>
      </section>

      <section>
        <h2>6. The FHIR boundary</h2>
        <p>
          The serialization{' '}
          <code>acset_to_fhir : CState → Bundle</code> projects each ACSet row
          to one FHIR resource entry; <code>fhir_to_acset</code> is its inverse.
          The pair is byte-equal idempotent on the schema's image (covered
          end-to-end by <code>test_htn_nac.jl</code> and{' '}
          <code>test_new_resources.jl</code>).
        </p>
        <p>
          Rules use the same Bundle shape with two extra conventions:
        </p>
        <ul>
          <li>
            <strong>Leg tags</strong> via{' '}
            <code>Resource.meta.tag</code> with system{' '}
            <code>http://algebraic-cds.org/rule-leg</code> and codes
            {' '}<code>L</code>, <code>K</code>, <code>R</code>,{' '}
            <code>N1</code>, <code>N2</code>, ... A resource carrying
            multiple leg tags is preserved across those legs (its{' '}
            <code>fullUrl</code> identity does the morphism encoding).
          </li>
          <li>
            <strong>Predicate manifest</strong>: a single{' '}
            <code>Basic</code> entry holding FHIRPath expressions, each
            targeting a specific resource by <code>fullUrl</code>.
          </li>
        </ul>
        <p>
          See <code>docs/fhir_pipeline_design.md</code> for the full Bundle
          schema and round-trip diagrams.
        </p>
      </section>

      <section>
        <h2>7. The pipeline</h2>
        <pre className="tutorial-diagram">{`Patient FHIR Bundle ─→ fhir_to_acset ─→ State G
Rule FHIR Bundle    ─→ fhir_to_rule  ─→ CDSRule (l: K→L, r: K→R, NACs, preds)

                           fire(rule, G)
                                ↓
                       (status, G') in CState

State G' ─→ acset_to_fhir ─→ post-fire Bundle`}</pre>
        <p>
          The engine is a thin orchestration over Catlab and AlgebraicRewriting
          primitives. The interesting design choices are at the boundary: how
          rule patterns are encoded as Bundle entries with structural roles,
          and how attribute-level predicates compose with structural match.
        </p>
      </section>

      <section>
        <h2>References</h2>
        <ul>
          <li>
            Patterson et al., <em>Categorical Data and Knowledge with Catlab</em>.
            Provides the ACSet machinery this engine sits on.
          </li>
          <li>
            Ehrig et al., <em>Fundamentals of Algebraic Graph Transformation</em>.
            The standard reference for DPO rewriting and application conditions.
          </li>
          <li>
            HL7 FHIR R4 base specification. Resource shapes, terminology
            bindings, FHIRPath grammar.
          </li>
        </ul>
      </section>
    </article>
  );
}

// ============================================================
// Informatics flavor: same system, framed as a CDS engine.
// ============================================================
function InformaticsContent() {
  return (
    <article className="tutorial-content">
      <header className="tutorial-header">
        <div className="tutorial-tag">Practitioner guide</div>
        <h1>How Algebraic CDS works</h1>
        <p className="tutorial-lede">
          A clinical decision support system that fires structured rules
          against a patient's chart. Both rules and patient charts are FHIR
          Bundles, so anything that speaks FHIR can plug in.
        </p>
      </header>

      <section>
        <h2>What is a rule?</h2>
        <p>
          A rule is a small FHIR Bundle that describes a clinical pattern and
          what should happen when the pattern is found. Each rule has three
          parts:
        </p>
        <ul>
          <li>
            <strong>What to look for.</strong> A set of FHIR resources, like
            "an HbA1c Observation" or "an active Type 2 Diabetes Condition".
            This is called the <em>L pattern</em> (Left side).
          </li>
          <li>
            <strong>What to add.</strong> The resources the rule will create if
            it fires. This is the <em>R pattern</em> (Right side). For
            example, R might add a Type 2 Diabetes Condition and a
            ClinicalImpression that links it to the triggering observation.
          </li>
          <li>
            <strong>What forbids firing.</strong> Optional negative
            application conditions, called <em>NACs</em>. The most common one
            is "do not add this diagnosis if it already exists in the chart".
          </li>
        </ul>
        <p>
          Each entry in the rule Bundle is tagged with which parts it belongs
          to using <code>meta.tag</code> codes <code>L</code>,{' '}
          <code>K</code>, <code>R</code>, <code>N1</code>, etc. A resource
          tagged with multiple of these is preserved across them, that is,
          the same resource is matched and kept in the result.
        </p>
      </section>

      <section>
        <h2>Codes and vocab</h2>
        <p>
          Every clinical concept in a rule is identified by a code from a
          standard vocabulary — SNOMED for diseases, LOINC for labs and
          vital signs, RxNorm for medications. You don't need to memorize
          codes: the <strong>codeDisplay</strong> field on every coded
          resource is a search box. Type "metformin", "hypertension",
          "ophthalmology" — the picker fills in the right
          <code>codeSystem</code>, <code>codeValue</code>, and{' '}
          <code>codeDisplay</code> in one click. Free text still works for
          codes outside the library.
        </p>
      </section>

      <section>
        <h2>NAC semantics: AND vs OR</h2>
        <p>
          A NAC (Negative Application Condition) is a forbidden pattern. If
          it matches the chart, the rule won't fire. The colors of the NAC
          chips on the canvas tell you the structure:
        </p>
        <ul>
          <li>
            <strong>Within one NAC (same colour) — AND.</strong> All nodes
            tagged <code>N1</code> must match together for that NAC to block
            the rule. Use this when "I block if A AND B both exist."
          </li>
          <li>
            <strong>Across multiple NACs (different colours) — OR.</strong>
            Any single NAC matching is enough to block. Use{' '}
            <code>N1</code>, <code>N2</code>, <code>N3</code> for "I block
            if A OR B OR C exists." Each NAC has a distinct colour (amber,
            rose, violet, teal) so the structure reads at a glance.
          </li>
        </ul>
      </section>

      <section>
        <h2>Predicates</h2>
        <p>
          Structural matching isn't enough to decide whether a rule should
          fire. You also need numeric or coded comparisons:
        </p>
        <ul>
          <li>"Fire only when HbA1c is at least 6.5%" — Critical / Abnormal high template</li>
          <li>"Fire only when systolic BP is at least 140 mmHg" — Value threshold template</li>
          <li>"Block if there was an ophthalmology Encounter in the past year" — Within-last template</li>
        </ul>
        <p>
          The detail panel's <strong>+ Add predicate…</strong> dropdown
          offers a curated set of clinically meaningful templates — pick
          one and tweak the threshold. The generated FHIRPath sits behind
          a small disclosure (click "FHIRPath" if you want to verify what
          gets sent to the engine).
        </p>
      </section>

      <section>
        <h2>The patient chart</h2>
        <p>
          The patient state is also a FHIR Bundle, the same shape any FHIR
          server can produce. The system reads observations, conditions,
          clinical impressions, and so on. When a rule fires, the system adds
          the new resources and gives you back an updated Bundle.
        </p>
      </section>

      <section>
        <h2>What happens when a rule fires</h2>
        <p>
          Tick the rules you want to fire in the library dropdown, then
          click <strong>Run ▾</strong> in the topbar. The menu lets you:
        </p>
        <ul>
          <li><strong>Run all</strong> — fire every checked rule in sequence; each fire's output feeds the next.</li>
          <li><strong>Step next</strong> — fire just the next rule, then pause so you can inspect the chart between fires.</li>
          <li><strong>Pick one</strong> — fire any specific rule from the queue.</li>
        </ul>
        <p>For each rule the engine goes through five steps:</p>
        <ol>
          <li>Look for the L pattern in the patient state.</li>
          <li>If found, check that no NAC pattern matches.</li>
          <li>If clear, evaluate the FHIRPath predicates.</li>
          <li>If all predicates pass, apply the rewrite. This is the bit where R is materialized in the chart.</li>
          <li>Return the new patient state.</li>
        </ol>
        <p>
          The result modal tells you which step the rule got to. If a NAC
          blocked the fire, the detail line names the specific patient row
          that triggered it — e.g. "blocked because Condition
          codeValue=38341003, codeDisplay=Hypertensive disorder already
          exists in patient state." Same for predicate failures.
        </p>
      </section>

      <section>
        <h2>Author-time validation</h2>
        <p>
          Each rule in the library shows a small badge if there are
          structural issues — red for errors that will prevent firing,
          amber for warnings about likely authoring mistakes. Hover the
          badge to see the list. Examples the validator catches:
        </p>
        <ul>
          <li>L pattern with no literal codes — "this rule will match anything"</li>
          <li>NAC that's a strict copy of L — "NAC always satisfied; rule will never fire"</li>
          <li>Predicate target node not in L — "predicate will never evaluate"</li>
          <li>R-only node with templated <code>${'{var}'}</code> attributes — the engine refuses to fire (it needs concrete values for materialized resources)</li>
        </ul>
      </section>

      <section>
        <h2>Why this design</h2>
        <p>
          Most CDS engines hardcode rules as imperative scripts or proprietary
          DSLs. The structure of "this is the trigger, this is the result, this
          is the forbidden context" gets lost in code. Once it's lost, you cannot
          easily inspect it, share it, validate it, or prove anything about it.
        </p>
        <p>
          By encoding rules as FHIR Bundles with structural roles (the L/K/R
          tags) plus a small predicate language, we keep the clinical intent
          in a form that:
        </p>
        <ul>
          <li>Other FHIR systems can read.</li>
          <li>Auditors can inspect without a debugger.</li>
          <li>The engine can analyze, for example to detect when two rules
          conflict or when a rule's NAC will always (or never) hold.</li>
          <li>Round-trips perfectly: export, import elsewhere, re-import,
          identical.</li>
        </ul>
      </section>

      <section>
        <h2>Worked example: the DM2 diagnosis rule</h2>
        <p>
          Look at the "Diagnose Type 2 Diabetes" rule in the library. It has:
        </p>
        <ul>
          <li>One Observation in L, K, R, and N1, with code LOINC 4548-4 (HbA1c)</li>
          <li>One Condition in R and N1 only, with SNOMED 44054006 (T2DM)</li>
          <li>One ClinicalImpression in R only, linking the obs and the new condition</li>
          <li>One predicate: <code>HbA1c ≥ 6.5</code></li>
        </ul>
        <p>
          Read it as: "When the chart has an HbA1c reading and that reading
          is at least 6.5%, and there is not already a T2DM diagnosis, then
          add a T2DM diagnosis with a ClinicalImpression that records the
          decision and links to the triggering observation."
        </p>
        <p>
          Click Run with the rule enabled. The patient seed has an HbA1c at
          7.2% and no DM2 diagnosis, so the rule fires and you'll see the new
          Condition and ClinicalImpression appear on the patient canvas.
        </p>
      </section>

      <section>
        <h2>Tips for authoring rules</h2>
        <ul>
          <li>
            Start from a template (the Templates dropdown in the topbar)
            or from the closest sample rule in the library. Adjusting an
            existing rule is faster than starting from scratch. The
            Templates list now includes "Refer to specialty",
            "Re-screen if overdue", and "Drug-disease contraindication"
            alongside the basic add-diagnosis / add-medication shapes.
          </li>
          <li>
            Use the leg filter chips above the canvas to inspect just the
            L pattern, just the R pattern, or each NAC in isolation. The
            other legs dim out.
          </li>
          <li>
            Type into <strong>codeDisplay</strong> on any coded resource
            to search the code library. Picks fill in system + value +
            display together.
          </li>
          <li>
            <code>${'{varname}'}</code> placeholders in fields mean "any
            value". Use them in NAC-only nodes (the cond-htn-existing
            pattern) so the NAC matches any prior diagnosis regardless of
            display label. <em>Don't</em> put placeholders on R-only
            nodes — the engine needs literal values for what it
            materializes; the validator will warn you.
          </li>
          <li>
            Drag from any side of a node (top, bottom, left, right) to
            create a reference. The label dropdown shows valid FHIR
            reference fields for that resource pair. Reference fields
            like <code>reasonReference</code> and <code>basedOn</code>
            round-trip through the engine; <code>subject</code> and{' '}
            <code>encounter</code> are auto-wired to the patient on every
            fire so you don't have to draw them manually.
          </li>
          <li>
            For "diagnose then treat" workflows, tick both rules and use
            Step to advance one at a time. The dropdown shows the queue
            and which rule is up next.
          </li>
        </ul>
      </section>
    </article>
  );
}
