# Category Theory Foundations — Algebraic CDS

Conceptual snapshot of the categorical machinery underlying our schema, as of April 2026.

## 1. Base framework: ACSets

The clinical state is an **attributed C-set**: a functor
$$G : |S| \to \mathrm{Set}$$
on a finitely-presented category $|S|$ split into combinatorial objects $S_0$ (entities) and discrete attribute-type objects $S_1$. Morphisms are *homs* (between entities) or *attrs* (entity → attribute type).

The main theorem of Patterson, Lynch, Fairbanks (2022):
$$\mathrm{Acset}^S_K \;\cong\; \mathrm{Set}^C / D$$
ACSets form a slice category in a presheaf topos, so all (co)limits exist and are computed pointwise.

## 2. Clinical state as a zigzag of spans

$$\mathrm{Observation}\;\xleftarrow{\text{findObs}}\;\mathrm{Finding}\;\xrightarrow{\text{findAssm}}\;\mathrm{Assessment}\;\xleftarrow{\text{diagAssm}}\;\mathrm{Diagnosis}\;\xrightarrow{\text{diagProb}}\;\mathrm{Problem}$$

Each leg is a **relation**, reified as a span with a junction Ob at the apex:

- **Finding** — evidence-gathering relation (observation ↔ assessment).
- **Diagnosis** — conclusion-recording relation (assessment ↔ problem).

Homs are functions; to get a many-to-many relation we make it an Ob. Functions compose, relations span.

The Assessment sits as the pivot: Findings point in (inbound evidence), Diagnoses point in (outbound conclusions). This is the generic shape of an inference step.

### Problem vs. Diagnosis

- **Problem** — persistent entity on the patient's list; a noun. FHIR `Condition`.
- **Diagnosis** — the act of a specific Assessment asserting a Problem; a verb. FHIR `Encounter.diagnosis`.

A single Problem accumulates many Diagnosis rows over time: the audit trail.

### FHIR-style associated objects

`Code`, `Value`, `Status`, `Time` are `Ob`, not `AttrType`. Entities have identity and can be shared (many Observations cite the same Code row) and extended (Code gets its own attributes: `codeSystem`, `codeValue`, `codeDisplay`). Primitive scalars live as `Attr` on those shared objects.

## 3. Design principle: structural vs. semantic

Category theory enforces structural constraints — path equations between composed homs (e.g. $\partial_1;\mathrm{src} = \partial_2;\mathrm{src}$ in the semi-simplicial example). It does *not* enforce predicates on attribute values or numeric combination formulas across rows.

Consequently the schema contains only structural data. Probabilistic weights, confidences, and evidence-combination formulas are deferred to a later layer built on Markov categories (or $\mathrm{Vect}_{\mathbb{R}}$ / $\mathrm{LinRel}_{\mathbb{R}}$), per §6 of the acsets paper.

## 4. Derived construction: differential as a slice

The differential diagnosis is not a schema object. For an Assessment $a$, it is the comma category
$$(\mathrm{Diagnosis} \downarrow a) \;\subset\; \textstyle\int G$$
inside the category of elements, composed with `diagProb`. Equivalently, the fiber of `diagAssm` over $a$:
$$\mathrm{diagAssm}^{-1}(a) = \{d \in G(\mathrm{Diagnosis}) : \mathrm{diagAssm}(d) = a\}$$
Further sub-slicing by verification status (once `probVerifStatus` is added) separates "still under consideration," "ruled out," and "confirmed."

Slogan: *context, at schema or instance level, is always a slice.* The acsets theorem applies this pattern to the whole schema; we apply it locally to an assessment.

## 5. What this gives us

- Compositional queries via `incident` (preimage along a hom) + `subpart` (hop across).
- Morphisms between Assessments induce functors between their differentials.
- ACSet rewriting (DPO / SPO / SqPO / PBPO+) supplies the algebra in which CDS rules are expressed — preconditions as the left leg $L$, consequences as the right leg $R$, invariants preserved by construction.
