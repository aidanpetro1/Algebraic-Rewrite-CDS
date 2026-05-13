// Layout utility — nudges overlapping nodes apart so loaded graphs don't
// arrive visually crowded. Conservative: only acts on nodes whose
// bounding boxes actually overlap; nodes that are close but not
// overlapping keep their hand-laid positions.
//
// Used at every data-load point (sample rules seeding, rule library
// load, FHIR Bundle import, post-fire merge) so the canvas always shows
// nodes with at least the minimum gap configured below. Drag-edited
// positions are preserved across the relax — a node only moves when it
// would otherwise collide with another.

export interface Positioned {
  x: number;
  y: number;
}

// Approximate node card footprint. Generous on both axes so node cards
// have visible breathing room — actual nodes are ~180×80 with content,
// but predicate badges, leg chips, and field rows can extend them.
const NODE_W = 220;
const NODE_H = 140;
const MAX_ITERATIONS = 60;

// Returns a new array with positions adjusted; the input is not mutated.
// Each iteration pushes overlapping pairs apart along the line connecting
// their centers; converges quickly for the dozens-of-nodes range we care
// about. If iterations cap out, remaining overlap is small (< pixel).
export function relaxOverlap<T extends Positioned>(input: T[]): T[] {
  if (input.length < 2) return [...input];
  // Work on plain {x, y} copies to avoid touching legs / fields / etc.
  const out = input.map((n) => ({ ...n }));

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let anyMoved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = NODE_W - Math.abs(dx);
        const overlapY = NODE_H - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;

        // Push along the smaller axis — minimizes total displacement.
        let pushX = 0, pushY = 0;
        if (overlapX < overlapY) {
          const half = (overlapX + 4) / 2;  // +4 so pairs end up with a small gap
          pushX = (dx >= 0 ? -half : half);
        } else {
          const half = (overlapY + 4) / 2;
          pushY = (dy >= 0 ? -half : half);
        }
        a.x += pushX;  a.y += pushY;
        b.x -= pushX;  b.y -= pushY;
        anyMoved = true;
      }
    }
    if (!anyMoved) break;
  }
  return out;
}
