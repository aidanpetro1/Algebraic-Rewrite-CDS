// GraphCanvas — force-directed graph with pan/zoom, node drag, palette drop.
//
// Renders a viewport of nodes + edges. The world layer (transformed div +
// SVG sibling) carries pan/zoom; nodes inside the world are positioned by
// their (x, y) center via translate(-50%, -50%).
//
// Physics live in refs (posRef/velRef) — mutating them does NOT re-render.
// A separate forceTick state is bumped each RAF tick to drive paints. This
// keeps the per-tick cost low even with dozens of nodes.

import { useCallback, useEffect, useRef, useState } from 'react';
import { TYPE_INFO } from '../data/palette';
import { sortLegs, tone } from '../lib/legs';
import { defaultEdgeLabel, reverseEdgeLabel, validEdgeLabels } from '../lib/edgeLabels';
import { displayOf as displayOfFields, isPlaceholder } from '../lib/display';
import { FHIR_TYPE_MIME, type Edge, type Node, type View } from '../lib/types';

// Build the preview shown on each node card. For known FHIR resource
// types we pick the clinically-meaningful fields. In rule-authoring mode
// the second line of an Observation/Condition shows the attached
// predicate label (e.g. "≥ 6.5") instead of the literal value field —
// the value field is usually a template variable like ${a1c} that adds
// noise; the predicate is what actually constrains the match.
interface PreviewLine {
  text: string;
  prominent?: boolean;   // bigger / darker line, used for display name
}

function nodePreviewFields(
  type: string,
  fields: Record<string, string>,
  nodeId: string,
  ruleMode: boolean,
  predicates: Array<{ target: string; label: string; attribute?: string; operator?: string; value?: string; fhirpath?: string }>,
  // Optional graph context. Used to derive a human-readable label for
  // resources (like ClinicalImpression) that have no display field of
  // their own — their identity is the morphism, so the label comes from
  // *what they link to*, not from a stored string.
  graphCtx?: { edges: Edge[]; nodesById: Map<string, Node> },
): PreviewLine[] {
  // Skip empty + template-placeholder values. Placeholders are
  // engine-internal AttrVar names ("${bp}", "${existingDisplay}", …);
  // surfacing them in the rectangle just clutters the rule editor.
  const trimmed = (s: string | undefined) =>
    s && s.trim() && !isPlaceholder(s) ? s.trim() : '';
  // Shared display chain — same as DetailPanel header, so the card text
  // and the panel header always agree even after a copy/paste between
  // patient and rule documents.
  const displayOf = (): string => displayOfFields(fields);
  // Render a predicate from its structured fields rather than the
  // human-typed label. "valueQuantity.value >= 140" reads as
  // "value ≥ 140" — short attribute name, Unicode operator. Falls
  // back to label or fhirpath only when the structure is incomplete.
  const shortAttr = (path: string): string => {
    if (!path) return '';
    // "valueQuantity.value" → "value", "clinicalStatus.coding.code" →
    // "status" (drop the .coding.code suffix), "effectiveDateTime" → "date".
    const last = path.split('.').filter(Boolean).pop() ?? path;
    if (last === 'code' && /clinicalStatus/.test(path)) return 'status';
    if (last === 'value' && /valueQuantity/.test(path)) return 'value';
    if (last === 'effectiveDateTime') return 'date';
    return last;
  };
  const opSymbol = (op: string): string =>
    op === '>=' ? '≥' : op === '<=' ? '≤' : op === '==' ? '=' : op === '!=' ? '≠' : op;
  const renderPredicate = (
    p: { label: string; attribute?: string; operator?: string; value?: string; fhirpath?: string }
  ): string => {
    const attr = trimmed(p.attribute);
    const op   = trimmed(p.operator);
    const val  = trimmed(p.value);
    if (attr && op && val) {
      const a = shortAttr(attr);
      // Drop the attribute entirely when it's the canonical "value" —
      // the rectangle already shows the obs/cond label so the predicate
      // reads naturally as just "≥ 140".
      return a === 'value' ? `${opSymbol(op)} ${val}` : `${a} ${opSymbol(op)} ${val}`;
    }
    return trimmed(p.label) || trimmed(p.fhirpath) || '';
  };
  const predicateLines = (): string[] =>
    predicates.filter((p) => p.target === nodeId)
              .map(renderPredicate)
              .filter(Boolean);

  if (type === 'Observation') {
    const display = displayOf();
    const out: PreviewLine[] = [];
    if (display) out.push({ text: display, prominent: true });
    if (ruleMode) {
      // In rule mode, surface predicate labels in place of the literal
      // value (which is usually a template-var placeholder).
      for (const pl of predicateLines()) out.push({ text: pl });
    } else {
      const value = trimmed(fields.value);
      const unit  = trimmed(fields.unit);
      const valueLine = value ? (unit ? `${value} ${unit}` : value) : '';
      if (valueLine) out.push({ text: valueLine });
    }
    return out;
  }
  if (type === 'Condition') {
    // Condition cards always show clinicalStatus, in both rule and patient
    // modes — it's clinically useful and rarely a placeholder. In rule
    // mode any attached predicate labels stack underneath.
    const display = displayOf();
    const status  = trimmed(fields.clinicalStatus);
    const out: PreviewLine[] = [];
    if (display) out.push({ text: display, prominent: true });
    if (status)  out.push({ text: status });
    if (ruleMode) {
      for (const pl of predicateLines()) out.push({ text: pl });
    }
    return out;
  }
  if (type === 'ClinicalImpression') {
    // CI has no display field of its own — its identity is the set of
    // problems it diagnoses (Diagnosis junction). Derive the prominent
    // label from those linked Condition displays. This is rendering
    // only; codeKey already uses the same morphism for merge identity,
    // so canvas label and identity stay in lockstep.
    const out: PreviewLine[] = [];
    if (graphCtx) {
      const probDisplays = graphCtx.edges
        .filter((e) => e.from === nodeId && e.label === 'problem')
        .map((e) => trimmed(graphCtx.nodesById.get(e.to)?.fields.codeDisplay))
        .filter(Boolean);
      if (probDisplays.length > 0) {
        out.push({ text: `Assessment: ${probDisplays.join(' + ')}`, prominent: true });
      }
    }
    const status = trimmed(fields.status);
    const date   = trimmed(fields.date);
    if (status) out.push({ text: status });
    if (date)   out.push({ text: date });
    return out;
  }
  if (type === 'Patient') {
    const name   = trimmed(fields.name);
    const gender = trimmed(fields.gender);
    const out: PreviewLine[] = [];
    if (name)   out.push({ text: name, prominent: true });
    if (gender) out.push({ text: gender });
    return out;
  }
  if (type === 'MedicationRequest') {
    // displayOf walks codeDisplay first, falling back to medication
    // (legacy flat field) — works whether the node uses the new
    // coded shape or an older bundle's flat string.
    const med = displayOf() || trimmed(fields.medication);
    const dos = trimmed(fields.dosage);
    const out: PreviewLine[] = [];
    if (med) out.push({ text: med, prominent: true });
    if (dos) out.push({ text: dos });
    return out;
  }
  if (type === 'Appointment') {
    // Prefer the display field as the prominent line; fall back to
    // status if there's no display so the card isn't blank.
    const display = displayOf();
    const status  = trimmed(fields.status);
    const start   = trimmed(fields.start);
    const out: PreviewLine[] = [];
    if (display)     out.push({ text: display, prominent: true });
    else if (status) out.push({ text: status, prominent: true });
    if (display && status) out.push({ text: status });
    if (start)             out.push({ text: start });
    return out;
  }
  if (type === 'Encounter') {
    // Encounter prominent line: codeDisplay (via displayOf), else
    // class as a last resort. Status + start give the secondary line.
    const display = displayOf();
    const klass   = trimmed(fields.class);
    const status  = trimmed(fields.status);
    const start   = trimmed(fields.start);
    const out: PreviewLine[] = [];
    if (display)    out.push({ text: display, prominent: true });
    else if (klass) out.push({ text: klass,   prominent: true });
    if (status) out.push({ text: status });
    if (start)  out.push({ text: start });
    return out;
  }
  if (type === 'Practitioner') {
    const name  = trimmed(fields.name);
    const qual  = trimmed(fields.qualification);
    const out: PreviewLine[] = [];
    if (name) out.push({ text: name, prominent: true });
    if (qual) out.push({ text: qual });
    return out;
  }
  if (type === 'Organization' || type === 'Location') {
    const name = trimmed(fields.name);
    const t    = trimmed(fields.type);
    const out: PreviewLine[] = [];
    if (name) out.push({ text: name, prominent: true });
    if (t)    out.push({ text: t });
    return out;
  }
  // Unknown types — labeled fallback
  return Object.entries(fields)
    .filter(([k]) => k !== 'codeSystem' && k !== 'codeValue' && k !== 'id')
    .slice(0, 2)
    .map(([k, v]) => ({ text: `${k}: ${v}` }));
}

// defaultEdgeLabel + validEdgeLabels live in lib/edgeLabels.ts now —
// the lookup is a small per-source-type table of valid FHIR reference
// fields. Used both at drag-create time (default) and in the edit
// dropdown (options).

// Force-directed simulation constants. Currently set to ZERO forces — the
// graph editor is purely manual placement: seeded positions on load, drop
// coords on palette add, mouse-driven during drag. Switching modes just
// shows the other document's stored positions, no settle animation.
//
// To re-enable auto-layout (e.g. for an "arrange" button), bump:
//   REPEL ~14000, SPRING_K ~0.01 — gives the original force-directed feel
// and lower the sleep thresholds. The simulation infrastructure below
// still runs (and halts immediately with zero forces); flipping these
// constants is a one-line revert.
const REPEL = 0;
const SPRING_K = 0;
const SPRING_LEN = 240;
const DAMP = 0.99;
const CENTER_K = 0;
const CX = 600;
const CY = 400;
const DT = 0.016;
const SPRING_DT_BOOST = 30;
const SLEEP_SPEED = 1.0;
const SLEEP_TOTAL = 12.0;

interface Pos { x: number; y: number; }

interface Props {
  nodes: Node[];
  edges: Edge[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNodesChange: (updater: (prev: Node[]) => Node[]) => void;
  onEdgesChange?: (updater: (prev: Edge[]) => Edge[]) => void;
  onAddNode: (type: string, x: number, y: number) => void;
  // Fired when the user double-clicks a node — opens the side detail
  // panel for that node. Single click only highlights (sets selectedId).
  onOpenNode?: (id: string) => void;
  // Fired on a double-click on bare canvas (not on a node). Used by the
  // parent to dismiss the side panel — single clicks just deselect.
  onCanvasDoubleClick?: () => void;
  // Lets the canvas show toasts (e.g., "edge drawn in wrong direction").
  // Optional; falls back to silent if not provided.
  onShowToast?: (msg: string) => void;

  // Rule-mode chrome. showLegs renders leg chips on each node header.
  // legFilter (when non-null) dims nodes whose `legs` don't include it —
  // gives the user a "show me just the L pattern" affordance.
  // predicateCounts: id → number of predicates targeting that node, used
  // to render a small "λ N" pill on the node card.
  showLegs?: boolean;
  legFilter?: string | null;
  predicateCounts?: Record<string, number>;
  // Per-node predicates surfaced on the card preview in rule mode.
  predicates?: Array<{ target: string; label: string; fhirpath?: string }>;

  // fitToken — incremented by the parent on events that should trigger
  // an "auto-fit-to-content" zoom (e.g., mode switch, fire result).
  fitToken?: number;
}

export function GraphCanvas({
  nodes, edges, selectedId, onSelect, onNodesChange, onEdgesChange, onAddNode,
  onOpenNode, onCanvasDoubleClick, onShowToast,
  showLegs = false, legFilter = null, predicateCounts = {},
  predicates = [],
  fitToken = 0,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [dropHint, setDropHint] = useState<{ x: number; y: number } | null>(null);
  // Edge creation: when the user drags from a node's edge-handle, we
  // track the source node + cursor position so we can render a "rubber
  // band" line from the source to the cursor. Null when not connecting.
  const [connecting, setConnecting] = useState<{ fromId: string; x: number; y: number } | null>(null);
  // The node currently under the cursor during edge-drag — highlighted
  // so the user gets visual confirmation of the drop target.
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);

  // Physics state — refs so per-tick mutation doesn't trigger React renders.
  const posRef = useRef<Record<string, Pos>>({});
  const velRef = useRef<Record<string, Pos>>({});
  const draggingRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const [, forceTick] = useState(0);
  const bump = useCallback(() => forceTick((t) => t + 1), []);

  // Seed positions for new nodes; drop entries for removed ones.
  useEffect(() => {
    for (const n of nodes) {
      if (!posRef.current[n.id]) {
        posRef.current[n.id] = { x: n.x, y: n.y };
        velRef.current[n.id] = { x: 0, y: 0 };
      }
    }
    for (const id of Object.keys(posRef.current)) {
      if (!nodes.find((n) => n.id === id)) {
        delete posRef.current[id];
        delete velRef.current[id];
      }
    }
  }, [nodes]);

  // Simulation loop. Re-arms whenever nodes/edges change so we always have
  // a fresh closure over the current arrays.
  useEffect(() => {
    const tick = () => {
      // While a drag is in progress, freeze physics entirely — only the
      // dragged node moves (its position is set by the mousemove handler).
      // Without this, fast cursor motion past neighbors shoots them out
      // of place via the repulsion field, which feels like the cursor is
      // "dragging the whole graph along" rather than just one node.
      if (draggingRef.current) {
        bump();
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const pos = posRef.current;
      const vel = velRef.current;
      const ids = nodes.map((n) => n.id);

      // Coulomb-like repulsion between all node pairs, scaled by 1/d².
      for (let i = 0; i < ids.length; i++) {
        const a = ids[i];
        if (a === draggingRef.current) continue;
        let fx = 0;
        let fy = 0;
        for (let j = 0; j < ids.length; j++) {
          if (i === j) continue;
          const b = ids[j];
          const dx = pos[a].x - pos[b].x;
          const dy = pos[a].y - pos[b].y;
          const d2 = dx * dx + dy * dy + 0.01;
          const d = Math.sqrt(d2);
          const f = REPEL / d2;
          fx += (dx / d) * f;
          fy += (dy / d) * f;
        }
        // Gentle pull toward the framing center.
        fx += (CX - pos[a].x) * CENTER_K;
        fy += (CY - pos[a].y) * CENTER_K;
        vel[a].x = (vel[a].x + fx * DT) * DAMP;
        vel[a].y = (vel[a].y + fy * DT) * DAMP;
      }

      // Hooke springs along each edge — pull endpoints to SPRING_LEN apart.
      for (const e of edges) {
        const a = pos[e.from];
        const b = pos[e.to];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const f = (d - SPRING_LEN) * SPRING_K;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        if (e.from !== draggingRef.current) {
          vel[e.from].x += fx * DT * SPRING_DT_BOOST;
          vel[e.from].y += fy * DT * SPRING_DT_BOOST;
        }
        if (e.to !== draggingRef.current) {
          vel[e.to].x -= fx * DT * SPRING_DT_BOOST;
          vel[e.to].y -= fy * DT * SPRING_DT_BOOST;
        }
      }

      // Integrate velocity into position; sleep nodes whose speed is tiny.
      let totalMoved = 0;
      for (const id of ids) {
        if (id === draggingRef.current) continue;
        const v = vel[id];
        const speed = Math.abs(v.x) + Math.abs(v.y);
        if (speed > SLEEP_SPEED) {
          pos[id].x += v.x;
          pos[id].y += v.y;
          totalMoved += speed;
        } else {
          v.x = 0;
          v.y = 0;
        }
      }

      if (totalMoved > SLEEP_TOTAL || draggingRef.current) {
        bump();
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [nodes, edges, bump]);

  // Wake the sim whenever a wake-worthy event happens (drag start, drop, …).
  const wakeSim = useCallback(() => {
    if (rafRef.current === null) bump();
  }, [bump]);

  // Auto-fit-to-content. Compute a bounding box over all node positions
  // (or the leg-filtered subset, when a chip is active), then set the
  // view so the box fits the canvas with some padding. Re-runs on mount,
  // whenever fitToken increments (mode switch, post-fire), and whenever
  // legFilter changes (so picking "L" zooms to the L-pattern).
  useEffect(() => {
    if (!wrapRef.current) return;
    if (nodes.length === 0) return;
    const rect = wrapRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // When a leg filter is active, only fit to nodes that include the
    // filtered leg. If somehow zero nodes match the filter (shouldn't
    // happen — chips only appear for in-use legs), fall back to all.
    const visible = legFilter
      ? nodes.filter((n) => (n.legs ?? []).includes(legFilter))
      : nodes;
    const target = visible.length > 0 ? visible : nodes;

    const xs = target.map((n) => n.x);
    const ys = target.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const PAD = 120;
    const w = (maxX - minX) + 2 * PAD;
    const h = (maxY - minY) + 2 * PAD;
    const k = Math.max(0.3, Math.min(1.4, Math.min(rect.width / w, rect.height / h)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setView({
      k,
      x: rect.width / 2 - cx * k,
      y: rect.height / 2 - cy * k,
    });
  }, [fitToken, legFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Pan (mouse-down on background) ----------------------------------
  const onCanvasDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.node')) return;
    if (e.button !== 0) return;
    setPanning(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const v0 = view;
    const move = (ev: MouseEvent) => {
      setView({ ...v0, x: v0.x + (ev.clientX - startX), y: v0.y + (ev.clientY - startY) });
    };
    const up = () => {
      setPanning(false);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    // Click on bare background also deselects.
    const t = e.target as HTMLElement;
    if (t === wrapRef.current || t.classList.contains('canvas')) {
      onSelect(null);
    }
  };

  // ---- Zoom (wheel, anchored to cursor) --------------------------------
  // React 17+ binds onWheel as a passive listener, so e.preventDefault()
  // in a React handler is silently ignored — the browser ends up zooming
  // the *page* on Ctrl+wheel / trackpad pinch, which is what was leaking
  // through. We attach a native non-passive listener instead so
  // preventDefault actually works, and read the latest `view` via a ref so
  // the closure doesn't get stale when the user keeps zooming.
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = viewRef.current;

      // Normalize deltaY across input types and platforms:
      //   deltaMode 0 = pixels (Mac trackpad, recent Windows)
      //   deltaMode 1 = lines  (Firefox + classic mouse wheels)
      //   deltaMode 2 = pages  (rare)
      // Mouse wheels typically report large discrete deltas (~100 px),
      // trackpad pinches report tiny continuous deltas (~1-5 px). Both
      // collapse to a smooth exponential factor below.
      const lineHeight = 16;
      const pageHeight = 800;
      const dy =
        e.deltaMode === 1 ? e.deltaY * lineHeight :
        e.deltaMode === 2 ? e.deltaY * pageHeight :
        e.deltaY;

      // ctrlKey === pinch gesture (or Ctrl+wheel — the user is asking for
      // a zoom). Higher sensitivity since pinch deltas are small.
      const sensitivity = e.ctrlKey ? 0.015 : 0.0025;
      const factor = Math.exp(-dy * sensitivity);

      const newK = Math.max(0.3, Math.min(2.5, v.k * factor));
      // Keep the world point under the cursor stationary across the zoom.
      const wx = (mx - v.x) / v.k;
      const wy = (my - v.y) / v.k;
      setView({ k: newK, x: mx - wx * newK, y: my - wy * newK });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---- Node drag --------------------------------------------------------
  // Mousedown selects (if not already selected) and starts a possible drag.
  // Mouseup decides between "click" (no movement → toggle selection) and
  // "drag" (movement happened → keep selected, persist new position).
  // The toggle path lets the user close the side panel by clicking the
  // already-selected node again.
  const CLICK_THRESHOLD_PX = 4;
  const startNodeDrag = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const wasSelected = selectedId === id;
    if (!wasSelected) onSelect(id);
    setDraggingId(id);
    draggingRef.current = id;
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = { ...posRef.current[id] };
    let didDrag = false;
    wakeSim();
    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / view.k;
      const dy = (ev.clientY - startY) / view.k;
      // Don't count tiny mouse jitter as a drag — only past the threshold.
      if (!didDrag && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > CLICK_THRESHOLD_PX) {
        didDrag = true;
      }
      posRef.current[id] = { x: startPos.x + dx, y: startPos.y + dy };
      velRef.current[id] = { x: 0, y: 0 };
      bump();
      if (rafRef.current === null) wakeSim();
    };
    const up = () => {
      setDraggingId(null);
      draggingRef.current = null;
      if (didDrag) {
        // True drag — persist the new position.
        onNodesChange((prev) =>
          prev.map((n) => (n.id === id ? { ...n, x: posRef.current[id].x, y: posRef.current[id].y } : n)),
        );
      } else if (wasSelected) {
        // Click on already-selected node — toggle off.
        onSelect(null);
      }
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // ---- Edge creation drag -----------------------------------------------
  // Started by mousedown on a node's `.node-edge-handle`. While the drag is
  // live, we track the cursor position in world coords (for rubber-band
  // rendering) and the node currently under the cursor (for drop target
  // highlighting). On mouseup, if the cursor is over a different node, we
  // create an edge with a sensible default label.
  const startEdgeDrag = (e: React.MouseEvent, fromId: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (!onEdgesChange) return;   // edge editing not enabled in this canvas
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const toWorld = (clientX: number, clientY: number) => ({
      x: (clientX - rect.left - view.x) / view.k,
      y: (clientY - rect.top  - view.y) / view.k,
    });
    const start = toWorld(e.clientX, e.clientY);
    setConnecting({ fromId, x: start.x, y: start.y });
    setHoverTargetId(null);

    const move = (ev: MouseEvent) => {
      const w = toWorld(ev.clientX, ev.clientY);
      setConnecting({ fromId, x: w.x, y: w.y });
      // Hit-test for nodes near the cursor — first node within ~70 pixels
      // (nodes are ~140×60) wins. Skips the source itself.
      const HIT_RADIUS = 80;
      let hit: string | null = null;
      let bestD = HIT_RADIUS;
      for (const n of nodes) {
        if (n.id === fromId) continue;
        const p = posRef.current[n.id];
        if (!p) continue;
        const dx = p.x - w.x;
        const dy = p.y - w.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestD) { bestD = d; hit = n.id; }
      }
      setHoverTargetId(hit);
    };
    const up = () => {
      // Capture current target id from state via the ref dance — we use a
      // closure-captured value which may lag, so re-read by hit-testing
      // the cursor at mouseup time.
      let target: string | null = null;
      const lastConnecting = (window as unknown as { __lastConn?: typeof connecting }).__lastConn;
      void lastConnecting;
      // Use the latest hoverTargetId from React state directly.
      // Because state updates are async, we re-derive from the connecting
      // position (which IS up-to-date in `connecting`).
      // Simpler: re-hit-test using the just-updated connecting position.
      // But connecting is closure-captured stale. So just rely on hover.
      target = hoverTargetIdRef.current;

      if (target && target !== fromId) {
        const fromNode = nodes.find((n) => n.id === fromId);
        const toNode   = nodes.find((n) => n.id === target);
        // Forward-direction sanity check. If (from → to) has no valid
        // FHIR reference field but (to → from) does, the user almost
        // certainly drew the edge backwards. Refuse to create it and
        // hint at the canonical direction. If neither direction is
        // recognized, fall through to a generic "reference" edge — keeps
        // an escape hatch for unusual / custom resource pairs.
        const forwardValid = validEdgeLabels(fromNode?.type, toNode?.type);
        if (!forwardValid || forwardValid.length === 0) {
          const reverseValid = reverseEdgeLabel(fromNode?.type, toNode?.type);
          if (reverseValid) {
            onShowToast?.(
              `${fromNode?.type} → ${toNode?.type} isn't a valid FHIR reference. ` +
              `Try the other direction: ${toNode?.type} → ${fromNode?.type} (${reverseValid}).`,
            );
            // Block the edge.
            setConnecting(null);
            setHoverTargetId(null);
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            return;
          }
        }
        const label = defaultEdgeLabel(fromNode?.type, toNode?.type);
        onEdgesChange?.((prev) => [...prev, { from: fromId, to: target!, label }]);
      }
      setConnecting(null);
      setHoverTargetId(null);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Stable ref so the mouseup handler reads the latest hoverTargetId.
  const hoverTargetIdRef = useRef<string | null>(null);
  hoverTargetIdRef.current = hoverTargetId;

  // ---- Palette drop -----------------------------------------------------
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(FHIR_TYPE_MIME)) return;
    e.preventDefault();
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setDropHint({ x: e.clientX - rect.left - 70, y: e.clientY - rect.top - 22 });
  };
  const onDragLeave = () => setDropHint(null);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData(FHIR_TYPE_MIME);
    if (!type || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    // Convert screen coords to world coords by undoing pan + zoom.
    const wx = (e.clientX - rect.left - view.x) / view.k;
    const wy = (e.clientY - rect.top - view.y) / view.k;
    onAddNode(type, wx, wy);
    setDropHint(null);
    wakeSim();
  };

  // ---- Edge rendering ---------------------------------------------------
  // Edge paths are drawn in SVG (sharp lines, transform-with-world). Labels
  // are HTML elements rendered in the world layer below — they need to be
  // clickable / editable / deletable, which is much easier with HTML than
  // SVG text + foreignObject. legFilter dimming applies if either endpoint
  // is filtered out.
  const dimmedIds = legFilter
    ? new Set(nodes.filter((n) => !(n.legs ?? []).includes(legFilter)).map((n) => n.id))
    : null;

  // Trim the END of the segment to the visible edge of the target node so
  // the arrowhead marker doesn't land *inside* the target card (where it
  // gets hidden under the card background). Approximate the target as an
  // axis-aligned 220×140 box around its center — the actual cards vary
  // slightly but this lines up cleanly enough that the arrow always sits
  // just outside the border. We deliberately do NOT trim the start: it
  // simplifies the geometry, and a line starting at the source center
  // looks fine because the source card's background hides the segment
  // inside it. Trimming both ends would risk the segment crossing itself
  // when nodes get close together.
  const NODE_HALF_W = 110;          // matches NODE_W=220 in layout.ts
  const NODE_HALF_H = 50;           // slightly less than half-height so
                                    // arrows clear the rounded corners.
  const ARROW_PAD   = 6;            // distance from card border to arrow tip
  const trimEnd = (
    src: { x: number; y: number },
    dst: { x: number; y: number },
  ): { x: number; y: number } => {
    const dx = src.x - dst.x;
    const dy = src.y - dst.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (adx === 0 && ady === 0) return dst;
    // Parametric crossings of the box around dst, in units of the
    // (src - dst) vector. Smaller t = closer to dst.
    const tx = adx > 0 ? (NODE_HALF_W + ARROW_PAD) / adx : Infinity;
    const ty = ady > 0 ? (NODE_HALF_H + ARROW_PAD) / ady : Infinity;
    // Cap t at 1 — never extend past the source center.
    const t = Math.min(tx, ty, 1);
    return { x: dst.x + dx * t, y: dst.y + dy * t };
  };

  const renderEdges = () =>
    edges.map((e, i) => {
      const a = posRef.current[e.from];
      const b = posRef.current[e.to];
      if (!a || !b) return null;
      const hl = !!selectedId && (e.from === selectedId || e.to === selectedId);
      const dim = !!dimmedIds && (dimmedIds.has(e.from) || dimmedIds.has(e.to));
      // Path starts at source center, ends at the target's border (with
      // a small ARROW_PAD gap). The arrowhead — placed at the end — is
      // now visible outside the target card.
      const end = trimEnd(a, b);
      const d = `M ${a.x} ${a.y} L ${end.x} ${end.y}`;
      return (
        <g key={i} className={dim ? 'edge-dim' : ''}>
          <path d={d} className={hl ? 'hl' : ''} markerEnd={hl ? 'url(#arrow-hl)' : 'url(#arrow)'} />
        </g>
      );
    });

  // ---- Edge label editing -----------------------------------------------
  // Click a label to edit it inline; × deletes the edge. Editing state is
  // a single index (we don't currently support editing multiple at once).
  const [editingEdgeIdx, setEditingEdgeIdx] = useState<number | null>(null);

  return (
    <div
      ref={wrapRef}
      className={'canvas ' + (panning ? 'panning' : '')}
      onMouseDown={onCanvasDown}
      onDoubleClick={(e) => {
        // Bare-canvas double-click dismisses the side panel. We check
        // the target so a double-click that bubbles up from a node
        // doesn't fire — that's just an accidental double-press while
        // selecting and shouldn't close the panel.
        const t = e.target as HTMLElement;
        if (t === wrapRef.current || t.classList.contains('canvas')) {
          onCanvasDoubleClick?.();
        }
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <svg
        className="edge-svg"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: '0 0' }}
      >
        <defs>
          {/* refX=10 puts the tip at the path's end point (viewBox is 0-10).
              Larger markerWidth/Height than before so the arrowhead reads
              as an arrow, not a chevron, at default zoom. orient=auto so
              the arrow rotates to match the segment direction. */}
          <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#9aa0a6" />
          </marker>
          <marker id="arrow-hl" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="11" markerHeight="11" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#4f46e5" />
          </marker>
        </defs>
        {renderEdges()}
        {/* Rubber-band line during edge creation — dashed indigo from the
            source node center to the cursor (in world coords). */}
        {connecting && (() => {
          const a = posRef.current[connecting.fromId];
          if (!a) return null;
          return (
            <path
              d={`M ${a.x} ${a.y} L ${connecting.x} ${connecting.y}`}
              className="edge-rubberband"
              markerEnd="url(#arrow-hl)"
            />
          );
        })()}
      </svg>
      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        {/* Edge labels — HTML elements at each edge midpoint. Always
            visible (in muted style) so the user can see and edit any
            connection without first selecting an endpoint. Clicking the
            label opens an inline editor; × deletes the edge. */}
        {edges.map((e, i) => {
          const a = posRef.current[e.from];
          const b = posRef.current[e.to];
          if (!a || !b) return null;
          const dim = !!dimmedIds && (dimmedIds.has(e.from) || dimmedIds.has(e.to));
          const hl = !!selectedId && (e.from === selectedId || e.to === selectedId);
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const isEditing = editingEdgeIdx === i;
          // Validate label against the FHIR reference table — when the
          // pair is known but the label isn't one of its valid options,
          // mark the edge as `invalid` for a soft warning style. Pairs
          // we don't enumerate fall through (no warning).
          const fromTypeForValid = nodes.find((nx) => nx.id === e.from)?.type;
          const toTypeForValid   = nodes.find((nx) => nx.id === e.to)?.type;
          const validLabels = validEdgeLabels(fromTypeForValid, toTypeForValid);
          const isInvalid = validLabels !== undefined && !validLabels.includes(e.label);
          return (
            <div
              key={`label-${i}`}
              className={
                'edge-label' +
                (hl ? ' hl' : '') +
                (dim ? ' dim' : '') +
                (isInvalid ? ' invalid' : '') +
                (isEditing ? ' editing' : '')
              }
              style={{ left: mx, top: my }}
              onMouseDown={(ev) => ev.stopPropagation()}
              data-tip={isInvalid && !isEditing
                ? `"${e.label}" isn't a valid FHIR reference field for ${fromTypeForValid} → ${toTypeForValid}. Click to edit.`
                : undefined}
            >
              {isEditing ? (() => {
                // Look up valid reference field names for this
                // (sourceType, targetType) pair. If we have a list, render
                // a <select> so the user only sees options that actually
                // map to FHIR reference fields. If we don't, fall back to
                // a free-text input.
                const fromType = nodes.find((nx) => nx.id === e.from)?.type;
                const toType   = nodes.find((nx) => nx.id === e.to)?.type;
                const valid    = validEdgeLabels(fromType, toType);
                if (valid && valid.length > 0) {
                  // Always include the current label as an option even if
                  // it's not in the canonical list — handles imported or
                  // hand-edited bundles with custom labels.
                  const inSet = valid.includes(e.label);
                  return (
                    <select
                      className="edge-label-select"
                      autoFocus
                      value={e.label}
                      onChange={(ev) => {
                        onEdgesChange?.((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)),
                        );
                        setEditingEdgeIdx(null);
                      }}
                      onBlur={() => setEditingEdgeIdx(null)}
                    >
                      {!inSet && e.label && <option value={e.label}>{e.label} (custom)</option>}
                      {valid.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  );
                }
                return (
                  <input
                    className="edge-label-input"
                    autoFocus
                    value={e.label}
                    size={Math.max(6, e.label.length)}
                    onChange={(ev) => onEdgesChange?.((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)),
                    )}
                    onBlur={() => setEditingEdgeIdx(null)}
                    onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === 'Escape') setEditingEdgeIdx(null); }}
                  />
                );
              })() : (
                <>
                  <span
                    className="edge-label-text"
                    onClick={() => onEdgesChange && setEditingEdgeIdx(i)}
                    title={onEdgesChange ? 'Click to edit label' : ''}
                  >
                    {e.label}
                  </span>
                  {onEdgesChange && (
                    <button
                      className="edge-label-del"
                      onClick={() => onEdgesChange((prev) => prev.filter((_, j) => j !== i))}
                      title="Delete edge"
                    >
                      ×
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
        {(() => {
          // Build id → node lookup once per render. Used by
          // nodePreviewFields to follow morphisms when deriving labels
          // for resources that don't have their own display field
          // (currently: ClinicalImpression → linked Conditions).
          const nodesById = new Map<string, Node>(nodes.map((n) => [n.id, n]));
          return nodes.map((n) => {
          const p = posRef.current[n.id] || { x: n.x, y: n.y };
          const info = TYPE_INFO[n.type] || { cls: 'cat-admin', short: '?' };
          const previewFields = nodePreviewFields(
            n.type, n.fields || {}, n.id, !!showLegs, predicates,
            { edges, nodesById },
          );
          // Leg-filter dimming: a node is "outside" the active filter if it
          // has no legs at all, or none matching the selected leg. In rule
          // mode with no filter, untagged nodes still render at full
          // opacity — they're part of the workspace, just not yet bound to
          // a leg.
          const legs = n.legs ?? [];
          const dimmed = legFilter !== null && !legs.includes(legFilter);
          const isEdgeTarget = hoverTargetId === n.id && connecting !== null;
          return (
            <div
              key={n.id}
              className={
                'node' +
                (selectedId === n.id ? ' selected' : '') +
                (draggingId === n.id ? ' dragging' : '') +
                (dimmed ? ' dimmed' : '') +
                (isEdgeTarget ? ' edge-target' : '')
              }
              style={{ left: p.x, top: p.y }}
              onMouseDown={(e) => startNodeDrag(e, n.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onOpenNode?.(n.id);
              }}
            >
              {/* Edge-create handles — one per side, visible on hover.
                  All four trigger the same edge-drag interaction; the
                  side just determines which border the rubber-band
                  starts from so the user can pick whichever direction
                  matches the target node's position. Only renders when
                  edge editing is wired. */}
              {onEdgesChange && (
                <>
                  <div
                    className="node-edge-handle side-right"
                    onMouseDown={(e) => startEdgeDrag(e, n.id)}
                    title="Drag to another resource to create a reference"
                  >
                    <span>→</span>
                  </div>
                  <div
                    className="node-edge-handle side-left"
                    onMouseDown={(e) => startEdgeDrag(e, n.id)}
                    title="Drag to another resource to create a reference"
                  >
                    <span>←</span>
                  </div>
                  <div
                    className="node-edge-handle side-top"
                    onMouseDown={(e) => startEdgeDrag(e, n.id)}
                    title="Drag to another resource to create a reference"
                  >
                    <span>↑</span>
                  </div>
                  <div
                    className="node-edge-handle side-bottom"
                    onMouseDown={(e) => startEdgeDrag(e, n.id)}
                    title="Drag to another resource to create a reference"
                  >
                    <span>↓</span>
                  </div>
                </>
              )}
              {/* Header row: type icon paired with the prominent display
                  line (codeDisplay, name, etc). If there's no display
                  field for this resource, the icon sits alone — type and
                  id are intentionally NOT shown for visual cleanliness;
                  they're still visible in the side detail panel. */}
              <div className="node-row">
                <div
                  className={'nicon ' + info.cls}
                  title={`${n.type} · ${n.id}`}
                  data-tip={`${n.type} · ${n.id}`}
                >
                  {info.short}
                </div>
                {previewFields.find((p) => p.prominent) && (
                  <div className="nfield-display ellipsis" style={{ flex: 1, minWidth: 0 }}>
                    {previewFields.find((p) => p.prominent)!.text}
                  </div>
                )}
              </div>
              {showLegs && (legs.length > 0 || (predicateCounts[n.id] ?? 0) > 0) && (
                <div className="node-legs">
                  {/* If a node is in L, every NAC implicitly extends to
                      include it (expandLegsForNACs in the bundle
                      builder). Showing N1/N2 chips alongside L is
                      redundant noise — suppress them visually so the
                      canvas reads as L/K/R-focused for matching nodes,
                      and N-only for NAC-extra nodes. */}
                  {(() => {
                    const inL = legs.includes('L');
                    const visibleLegs = inL
                      ? legs.filter((l) => !l.startsWith('N'))
                      : legs;
                    return sortLegs(visibleLegs).map((l) => (
                      <span key={l} className={'leg-chip xs ' + tone(l)}>{l}</span>
                    ));
                  })()}
                  {(predicateCounts[n.id] ?? 0) > 0 && (
                    <span className="pred-badge" title="Predicates attached">
                      λ {predicateCounts[n.id]}
                    </span>
                  )}
                </div>
              )}
              {/* Non-prominent lines (value, status, dosage, etc.) under
                  the header row. Skipped when empty so the card can be a
                  tight icon-only pill for resources with no display. */}
              {previewFields.filter((p) => !p.prominent).length > 0 && (
                <div className="nfields">
                  {previewFields.filter((p) => !p.prominent).map((line, i) => (
                    <div key={i} className="ellipsis nfield-value">
                      {line.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        });
        })()}
      </div>

      {dropHint && (
        <div className="drop-hint show" style={{ left: dropHint.x, top: dropHint.y, width: 140, height: 44 }} />
      )}

      <div className="zoom-ctrl">
        <button onClick={() => setView((v) => ({ ...v, k: Math.max(0.3, v.k * 0.9) }))} title="Zoom out">
          −
        </button>
        <span className="zlabel">{Math.round(view.k * 100)}%</span>
        <button onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.1) }))} title="Zoom in">
          +
        </button>
        <span className="sep" />
        <button onClick={() => setView({ x: 0, y: 0, k: 1 })} title="Reset view">
          ⊙
        </button>
      </div>

      <div className="statusbar">
        <span>
          <b>{nodes.length}</b> resources
        </span>
        <span className="sep" />
        <span>
          <b>{edges.length}</b> references
        </span>
        <span className="sep" />
        <span>Drag from palette to add</span>
      </div>
    </div>
  );
}
