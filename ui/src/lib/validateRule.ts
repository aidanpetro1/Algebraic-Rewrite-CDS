// Author-time rule validation — catches structural mistakes that today
// only surface at fire time as cryptic engine errors. Each Issue can
// be a 'warning' (rule fires but probably not the way you intended) or
// 'error' (engine will refuse the rule outright). The DetailPanel + the
// rule library row surface the count and full list.
//
// Checks intentionally run on the in-memory authoring shape, not the
// post-buildBundle wire form — they catch problems before they make it
// to the engine. Anything that requires Catlab to evaluate (ambiguous
// homomorphism, monic violation) lives engine-side.
//
// Add new checks here whenever a class of authoring bug shows up
// repeatedly in fire errors — each rule of thumb pays for itself in
// avoided round-trips through the engine.

import type { SavedRule, Node } from './types';

export interface RuleIssue {
  severity: 'error' | 'warning';
  message: string;
  // Optional node the issue applies to — UI can highlight or scroll to it.
  nodeId?: string;
}

const PLACEHOLDER_RX = /^\$\{[^}]+\}$/;
const isPlaceholder = (v: string | undefined): boolean =>
  !!v && PLACEHOLDER_RX.test(v.trim());

// Coded-resource types whose codeSystem/codeValue together form the
// "matching key" the engine compares against. A rule whose L pattern
// has none of these is structural-only and matches any resource of
// that type, which is almost never what the author meant.
const CODED_TYPES = new Set([
  'Observation', 'Condition', 'MedicationRequest',
  'Appointment', 'Encounter',
]);

const hasLiteralCode = (n: Node): boolean => {
  const sys = n.fields.codeSystem ?? '';
  const cod = n.fields.codeValue ?? '';
  return !!sys && !!cod && !isPlaceholder(sys) && !isPlaceholder(cod);
};

// Set of node legs as a typed object for readable checks.
interface LegSet {
  hasL: boolean; hasK: boolean; hasR: boolean;
  nacs: Set<string>;            // 'N1', 'N2', …
}
const legSet = (n: Node): LegSet => {
  const legs = n.legs ?? [];
  return {
    hasL: legs.includes('L'),
    hasK: legs.includes('K'),
    hasR: legs.includes('R'),
    nacs: new Set(legs.filter((l) => l.startsWith('N'))),
  };
};

export function validateRule(rule: SavedRule): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const nodes = rule.graph.nodes;
  const edges = rule.graph.edges ?? [];
  const predicates = rule.graph.predicates ?? [];

  // ---- L pattern checks --------------------------------------------------
  const lNodes = nodes.filter((n) => legSet(n).hasL);
  if (lNodes.length === 0) {
    issues.push({
      severity: 'error',
      message: 'No L (match) nodes — the rule has no pattern to match against the patient state, so it can never fire.',
    });
  } else {
    const codedL = lNodes.filter((n) => CODED_TYPES.has(n.type));
    if (codedL.length > 0 && codedL.every((n) => !hasLiteralCode(n))) {
      issues.push({
        severity: 'warning',
        message: 'No literal codes in any L node. The rule will match any resource of these types — usually you want at least one node with concrete codeSystem + codeValue (e.g. SNOMED 38341003 for hypertension).',
      });
    }
  }

  // ---- R-only nodes with templated attributes ----------------------------
  // The Catlab DPO engine refuses rules where R has AttrVars not bound
  // by K — every templated `${var}` field on a node that's in R but NOT
  // in K is a guaranteed fire-time error.
  for (const n of nodes) {
    const ls = legSet(n);
    const rOnlyMaterial = ls.hasR && !ls.hasK;
    if (!rOnlyMaterial) continue;
    const templatedFields: string[] = [];
    for (const [k, v] of Object.entries(n.fields)) {
      if (isPlaceholder(v)) templatedFields.push(k);
    }
    if (templatedFields.length > 0) {
      issues.push({
        severity: 'error',
        nodeId: n.id,
        message: `R-only node "${n.id}" has templated attributes (${templatedFields.join(', ')}). The engine needs literal values for what it materializes — replace the \${…} placeholders with concrete strings.`,
      });
    }
  }

  // ---- NAC structural checks --------------------------------------------
  // Each NAC's "extra" content (rows in N \ image(L)) is what makes the
  // NAC interesting. If a NAC has zero extras (i.e., it's exactly L),
  // expandLegsForNACs drops it at export time so the rule still fires —
  // but the author probably meant to add something to it, so we warn.
  const nacIds = Array.from(new Set(nodes.flatMap((n) => Array.from(legSet(n).nacs))));
  const lIds = new Set(lNodes.map((n) => n.id));
  for (const nacId of nacIds) {
    const nNodes = nodes.filter((n) => legSet(n).nacs.has(nacId));
    const extras = nNodes.filter((n) => !lIds.has(n.id));
    if (extras.length === 0) {
      issues.push({
        severity: 'warning',
        message: `${nacId} has no nodes outside L — it's empty and will be dropped at export so the rule still fires. Add at least one ${nacId}-only node to express the forbidden context.`,
      });
    }
  }

  // ---- Predicate target sanity -------------------------------------------
  // A predicate evaluates against a row in L's image. If its target node
  // isn't in L, the predicate has no row to evaluate on at fire time.
  for (const p of predicates) {
    const tgt = nodes.find((n) => n.id === p.target);
    if (!tgt) {
      issues.push({
        severity: 'error',
        message: `Predicate "${p.label || p.fhirpath || p.id}" targets node "${p.target}" which doesn't exist.`,
      });
      continue;
    }
    if (!legSet(tgt).hasL) {
      issues.push({
        severity: 'warning',
        nodeId: tgt.id,
        message: `Predicate "${p.label || p.fhirpath || p.id}" targets "${tgt.id}" which isn't in L. Predicates only evaluate against matched L rows — this predicate will never run.`,
      });
    }
  }

  // ---- Edge endpoint sanity ----------------------------------------------
  for (const e of edges) {
    const from = nodes.find((n) => n.id === e.from);
    const to   = nodes.find((n) => n.id === e.to);
    if (!from || !to) {
      issues.push({
        severity: 'error',
        message: `Edge "${e.label}" references missing node ids ${!from ? `from=${e.from}` : ''} ${!to ? `to=${e.to}` : ''}`.trim(),
      });
    }
  }

  return issues;
}
