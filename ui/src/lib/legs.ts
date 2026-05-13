// Leg-tag helpers for rule authoring.
//
// A rule's nodes carry a set of leg tags marking which DPO leg(s) and which
// NACs they belong to. Wire format is `meta.tag` with system
// `http://algebraic-cds.org/rule-leg` and code `L | K | R | N1 | N2 | …`.
// Identical fullUrl across legs is the morphism encoding (per
// docs/fhir_pipeline_design.md) — that's enforced at the data layer (one
// node = one entry, multiple legs as a set), not at the wire layer.

export const RULE_LEG_SYSTEM = 'http://algebraic-cds.org/rule-leg';

// Core legs (in canonical display order). NACs are open-ended (N1, N2, …).
export const CORE_LEGS = ['L', 'K', 'R'] as const;
export type CoreLeg = typeof CORE_LEGS[number];

export type LegCode = CoreLeg | `N${number}`;

// Tone classes — match the chip color tokens defined in app.css.
// Pick differentiable hues so a node tagged in 3 legs reads at a glance.
export const LEG_TONE: Record<string, string> = {
  L: 'leg-l',  // emerald — pattern to match
  K: 'leg-k',  // slate   — preserved (interface)
  R: 'leg-r',  // indigo  — rewrite target
};

// NAC tones rotate per index so N1, N2, N3 read as distinct constraints
// at a glance — the AND/OR distinction (within-NAC = AND, across-NACs =
// OR) is easier to see when N1's chips are amber and N2's are rose.
export const NAC_TONES = ['leg-n1', 'leg-n2', 'leg-n3', 'leg-n4'];

export const tone = (leg: string): string => {
  if (LEG_TONE[leg]) return LEG_TONE[leg];
  if (leg.startsWith('N')) {
    const n = parseInt(leg.slice(1), 10);
    if (Number.isFinite(n) && n >= 1) {
      return NAC_TONES[(n - 1) % NAC_TONES.length];
    }
    return NAC_TONES[0];
  }
  return 'leg-default';
};

// Sort legs into canonical order: L, K, R, then N1, N2, … (numerically).
export function sortLegs(legs: string[]): string[] {
  const order = (l: string): number => {
    const i = (CORE_LEGS as readonly string[]).indexOf(l);
    if (i >= 0) return i;
    if (l.startsWith('N')) {
      const n = parseInt(l.slice(1), 10);
      return Number.isFinite(n) ? 100 + n : 999;
    }
    return 1000;
  };
  return [...legs].sort((a, b) => order(a) - order(b));
}

// Toggle a leg in/out of a (deduped) leg set.
export function toggleLeg(legs: string[] | undefined, leg: string): string[] {
  const set = new Set(legs ?? []);
  if (set.has(leg)) set.delete(leg);
  else set.add(leg);
  return sortLegs([...set]);
}

// Highest existing NAC index in a graph; used when user adds a fresh NAC.
export function maxNacIndex(allLegs: Iterable<string[]>): number {
  let max = 0;
  for (const legs of allLegs) {
    for (const l of legs) {
      if (l.startsWith('N')) {
        const n = parseInt(l.slice(1), 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
  }
  return max;
}

// Distinct NAC ids appearing anywhere in the graph.
export function nacsInUse(allLegs: Iterable<string[]>): string[] {
  const seen = new Set<string>();
  for (const legs of allLegs) {
    for (const l of legs) if (l.startsWith('N')) seen.add(l);
  }
  return sortLegs([...seen]);
}
