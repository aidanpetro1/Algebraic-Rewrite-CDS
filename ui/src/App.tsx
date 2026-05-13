// App — top-level shell. Owns TWO graph documents — one for patient state
// authoring and one for rule authoring — and switches between them based
// on `mode`. Each document has its own nodes, edges, and selection, so
// editing a rule never disturbs the patient state and vice versa.
//
// Rendering and handlers (addNode, updateNode, deleteNode, setSelectedId)
// operate on the active document via `setActiveGraph`. The leg-chrome only
// shows up in rule mode.

import { useEffect, useMemo, useState } from 'react';
import { GraphCanvas } from './components/GraphCanvas';
import { DetailPanel } from './components/DetailPanel';
import { LegFilter } from './components/LegFilter';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import {
  INITIAL_EDGES, INITIAL_NODES, TYPE_INFO,
  INITIAL_RULE_EDGES, INITIAL_RULE_NODES, INITIAL_RULE_PREDICATES,
} from './data/palette';
import { RULE_TEMPLATES } from './data/ruleTemplates';
import { SAMPLE_RULES } from './data/sampleRules';
import { RuleLibrary } from './components/RuleLibrary';
import { RuleInfoBar } from './components/RuleInfoBar';
import { TutorialModal } from './components/TutorialModal';
import { defaultFieldsFor } from './data/fhirDefaults';
import { fshSyntaxHighlight, generateFSH } from './lib/fsh';
import { nacsInUse } from './lib/legs';
import { relaxOverlap } from './lib/layout';
import { buildBundle, parseBundle } from './lib/ruleBundle';
import type { AuthoringMode, BatchFireResult, Edge, FieldMap, Node, Predicate, SavedRule } from './lib/types';

type ViewMode = 'graph' | 'split' | 'fsh';

// One authored document — patient or rule — share the same shape. They live
// in their own React state so switching modes preserves what was selected
// and what was on the canvas in the other mode. No cross-document state
// sharing; rules and patient bundles are different documents at the FHIR
// layer too (different Bundle.type or just different content).
//
// `predicates` lives on the document so undo/redo capture predicate edits
// alongside node/edge edits. Patient documents always have an empty
// predicates array (predicate authoring UI only renders in rule mode).
interface Graph {
  nodes: Node[];
  edges: Edge[];
  selectedId: string | null;
  predicates: Predicate[];
}

const EMPTY_GRAPH: Graph = { nodes: [], edges: [], selectedId: null, predicates: [] };

export function App() {
  // Mode toggles which document is on the canvas. Patient mode loads the
  // diabetes follow-up seed; Rule mode loads the DM2-add rule. Compare
  // mode renders both side-by-side so the user can see how firing the
  // rule transforms the patient state. In compare mode `compareFocusDoc`
  // tracks which canvas was last interacted with — that's the document
  // that DetailPanel + Ctrl+Z + addNode all operate on.
  // Persisted across page reloads via localStorage so a refresh lands on
  // whichever screen the user was last on.
  const UI_KEY = 'algebraic_cds_ui_v1';
  const initialUI = (() => {
    try {
      const raw = localStorage.getItem(UI_KEY);
      if (raw) return JSON.parse(raw) as { mode?: AuthoringMode; view?: 'graph' | 'split' | 'fsh'; compareFocusDoc?: 'patient' | 'rule' };
    } catch { /* empty */ }
    return {};
  })();
  const [mode, setMode] = useState<AuthoringMode>(initialUI.mode ?? 'patient');
  const [compareFocusDoc, setCompareFocusDoc] = useState<'patient' | 'rule'>(initialUI.compareFocusDoc ?? 'rule');

  // Patient chart persists across page reloads so post-fire state isn't
  // lost when the user refreshes mid-session. Seeded from INITIAL_NODES
  // on first load (or after onResetLibrary clears all algebraic_cds keys).
  // Bump suffix when the seed shape changes incompatibly so old saves
  // don't poison new sessions.
  // Bumping the v-number invalidates every existing visitor's cached patient
  // and forces them onto the current INITIAL_NODES seed. Use when the seed
  // changes in a way you want everyone to see (e.g., generic demo patient).
  const PATIENT_KEY = 'algebraic_cds_patient_v2';
  const [patientGraph, setPatientGraph] = useState<Graph>(() => {
    try {
      const raw = localStorage.getItem(PATIENT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Graph;
        if (parsed?.nodes && Array.isArray(parsed.nodes)) return parsed;
      }
    } catch { /* fall through to seed */ }
    return {
      nodes: INITIAL_NODES,
      edges: INITIAL_EDGES,
      selectedId: 'obs-a1c',
      predicates: [],
    };
  });
  // Persist on every change. Cheap; the patient graph is small.
  useEffect(() => {
    try { localStorage.setItem(PATIENT_KEY, JSON.stringify(patientGraph)); }
    catch { /* quota or private mode — ignore */ }
  }, [patientGraph]);
  // Rule mode seeds with the DM2-add rule (see data/palette.ts seed +
  // data/sampleRules.ts library) so the user sees a complete, runnable-
  // shape example on first switch — leg chips, a NAC, and a FHIRPath
  // predicate. They can clear it and start fresh, or import a different
  // rule Bundle.
  const [ruleGraph, setRuleGraph] = useState<Graph>({
    nodes: INITIAL_RULE_NODES,
    edges: INITIAL_RULE_EDGES,
    selectedId: 'obs-hba1c',
    predicates: INITIAL_RULE_PREDICATES,
  });

  // `currentDoc` is the document handlers act on — patient or rule. In
  // compare mode it's whichever canvas was last interacted with. Stacks
  // and pushHistory only ever receive 'patient' | 'rule' (not 'compare').
  type DocId = 'patient' | 'rule';
  const currentDoc: DocId =
    mode === 'compare' ? compareFocusDoc :
    mode === 'rule'    ? 'rule' : 'patient';
  const active = currentDoc === 'patient' ? patientGraph : ruleGraph;

  const [view, setView] = useState<ViewMode>(initialUI.view ?? 'graph');

  // Persist UI state on every change. Cheap (small JSON, written under
  // its own key) and lets a Cmd-R / F5 refresh land back on the same
  // screen instead of always resetting to Patient mode.
  useEffect(() => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ mode, view, compareFocusDoc }));
    } catch { /* ignore quota/private mode */ }
  }, [mode, view, compareFocusDoc]);
  const [paletteSearch, setPaletteSearch] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  // legFilter dims nodes outside the selected leg — useful while inspecting
  // just the L pattern, or just NAC #1, etc. Only meaningful in rule mode.
  const [legFilter, setLegFilter] = useState<string | null>(null);

  // Fire-result modal — surfaces the reason a rule did or didn't fire,
  // with enough detail to debug. Null when no result is showing.
  interface FireResult {
    fired: boolean;
    title: string;
    message: string;
    details?: string;
  }
  const [fireResult, setFireResult] = useState<FireResult | null>(null);

  // Auto-fit-to-content trigger. The GraphCanvas refits when this counter
  // changes — we bump it on mode/focus switches and after a fire so the
  // user always sees the current document framed in the viewport.
  const [fitToken, setFitToken] = useState(0);
  const bumpFit = () => setFitToken((t) => t + 1);
  useEffect(() => { bumpFit(); }, [mode, compareFocusDoc]);

  // Auto-load the first saved rule when entering Rule mode with nothing
  // loaded (or in Compare mode focused on the rule pane). Avoids the
  // confusing "unsaved rule" empty editor state — users almost always
  // want to inspect or edit an existing rule when they switch to Rule
  // mode. They can still hit + New for a fresh editor afterward.
  useEffect(() => {
    const enteringRule = mode === 'rule' || (mode === 'compare' && compareFocusDoc === 'rule');
    if (enteringRule && !activeRuleId && savedRules.length > 0) {
      onLoadRule(savedRules[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, compareFocusDoc]);

  // Reset the saved-rules library back to the bundled samples. Useful
  // escape hatch when the localStorage state has drifted (e.g., via a
  // hot-reload that wrote a stale state through a new key version) and
  // you want a clean slate without DevTools.
  const onResetLibrary = () => {
    if (!window.confirm('Reset the rule library to the built-in samples? This deletes any rules you added.')) return;
    Object.keys(localStorage)
      .filter((k) => k.startsWith('algebraic_cds'))
      .forEach((k) => localStorage.removeItem(k));
    location.reload();
  };
  // Reset just the patient chart back to the seeded scenario. Use this
  // after experimenting with rule fires to start fresh without losing
  // any custom rules you've authored. Doesn't reload the page — just
  // overwrites patientGraph with INITIAL_NODES.
  const onResetPatient = () => {
    if (!window.confirm('Reset the patient chart to the seeded scenario? Any post-fire resources will be removed.')) return;
    pushHistory('patient');
    setPatientGraph({
      nodes: INITIAL_NODES,
      edges: INITIAL_EDGES,
      selectedId: 'obs-a1c',
      predicates: [],
    });
    showToast('Patient chart reset');
  };

  // ---- Rule library -----------------------------------------------------
  // Persistent across sessions via localStorage. activeRuleId tracks which
  // saved rule (if any) is currently loaded into the rule editor — Save
  // current updates that rule in place; otherwise it creates a new entry.
  // KEY VERSION: bump suffix when seeded sample rules change
  // structurally — the old key's data is then ignored and the new
  // samples seed in. Users' custom-saved rules under the old key are
  // preserved (still in storage) but unreachable until manually
  // re-imported. Worth it to avoid shipping a broken seed.
  const LS_KEY = 'algebraic_cds_rules_v14';
  const [savedRules, setSavedRules] = useState<SavedRule[]>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedRule[];
        if (parsed.length > 0) return parsed;
      }
    } catch { /* fall through to seed */ }
    // First load (or empty storage) — seed with the bundled sample rules
    // so the library has something useful out of the box.
    return SAMPLE_RULES;
  });
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null);
  // ID of the rule that should open in inline-rename mode on next render.
  // Set when a new rule is saved; the RuleLibrary header focuses the chip's
  // name input. Cleared via the onEditingDone callback once committed.
  const [renameRuleId, setRenameRuleId] = useState<string | null>(null);
  // Persist on every change. Cheap; the rule list is small.
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(savedRules)); }
    catch { /* quota or private mode — ignore */ }
  }, [savedRules]);

  // Aggregated batch-fire result — list of per-rule outcomes shown in a
  // dedicated modal. Null when no batch is on screen.
  const [batchResult, setBatchResult] = useState<BatchFireResult[] | null>(null);

  // Firing indicator. True while any fire request is in flight (single
  // rule or batch). Used to disable the Run/Fire-selected buttons and
  // show a small spinner so the user gets visual feedback that the
  // engine is working.
  const [firing, setFiring] = useState(false);

  // Single source of truth for the Save action — invoked by the Save
  // button in the File menu AND by Ctrl/Cmd+S. In Rule (or Compare with
  // rule focus) mode, this saves the current rule editor as a new entry
  // OR updates the active saved rule, mirroring the RuleLibrary header's
  // Save button. In Patient mode there's no backend persistence so we
  // just toast.
  const handleSave = () => {
    if (currentDoc === 'rule') {
      onSaveCurrent();
    } else {
      showToast('Patient state auto-saves; no manual save needed');
    }
  };

  // Tutorial modal — null when closed, otherwise the chosen flavor.
  const [tutorialOpen, setTutorialOpen] = useState<'math' | 'informatics' | null>(null);

  // Detail-panel open state. Decoupled from `selectedId`: single-click
  // sets selectedId (highlight only), double-click sets panelOpen (which
  // is what actually renders the side panel). The doc field tells us
  // which document to look the node up in (matters in compare mode).
  const [panelOpen, setPanelOpen] = useState<{ doc: DocId; id: string } | null>(null);
  const panelNode = panelOpen
    ? (panelOpen.doc === 'patient' ? patientGraph.nodes : ruleGraph.nodes).find((n) => n.id === panelOpen.id) ?? null
    : null;
  // The active document for handlers that operate on the panel-shown
  // node (predicate add/edit, node update, etc.).
  const panelDoc = panelOpen?.doc ?? currentDoc;

  const onSaveCurrent = () => {
    // Save = overwrite the active rule. Creating new rules is the job of
    // `+ New` (which now creates a fresh library entry up front and
    // makes it active), so Ctrl/Cmd+S can never accidentally duplicate
    // an existing rule into a parallel copy.
    if (!activeRuleId) {
      showToast('No active rule to save — click + New to start one');
      return;
    }
    setSavedRules((rs) =>
      rs.map((r) => r.id === activeRuleId
        ? { ...r,
            graph: { nodes: ruleGraph.nodes, edges: ruleGraph.edges, predicates: ruleGraph.predicates },
            updatedAt: Date.now() }
        : r,
      ),
    );
    showToast('Saved');
  };
  const onLoadRule = (id: string) => {
    const r = savedRules.find((x) => x.id === id);
    if (!r) return;
    pushHistory('rule');
    // Relax any overlapping nodes on load — sample rules and round-tripped
    // bundles can land with crowded positions; this nudges them apart.
    setRuleGraph({
      nodes: relaxOverlap(r.graph.nodes),
      edges: r.graph.edges,
      selectedId: r.graph.nodes[0]?.id ?? null,
      predicates: r.graph.predicates,
    });
    setActiveRuleId(id);
    if (mode === 'patient') setMode('rule');
    bumpFit();
  };
  const onDeleteRule = (id: string) => {
    setSavedRules((rs) => rs.filter((r) => r.id !== id));
    if (activeRuleId === id) setActiveRuleId(null);
  };
  const onToggleEnabled = (id: string, enabled: boolean) => {
    setSavedRules((rs) => rs.map((r) => r.id === id ? { ...r, enabled } : r));
  };
  const onUpdateRuleName = (id: string, name: string) => {
    setSavedRules((rs) => rs.map((r) => r.id === id ? { ...r, name, updatedAt: Date.now() } : r));
  };
  const onUpdateRuleDescription = (id: string, description: string) => {
    setSavedRules((rs) => rs.map((r) => r.id === id ? { ...r, description, updatedAt: Date.now() } : r));
  };
  const onNewRule = () => {
    // Create the library entry up front so subsequent Saves have
    // something to overwrite. The empty graph is the actual editor
    // state; we save it as a placeholder rule and immediately put the
    // chip's name input into edit mode so the user can name it without
    // leaving the canvas.
    const ts = Date.now();
    const id = `rule-${ts.toString(36)}`;
    const fresh: SavedRule = {
      id,
      name: `Rule ${savedRules.length + 1}`,
      description: '',
      enabled: true,
      graph: { nodes: [], edges: [], predicates: [] },
      createdAt: ts, updatedAt: ts,
    };
    pushHistory('rule');
    setRuleGraph(EMPTY_GRAPH);
    setSavedRules((rs) => [...rs, fresh]);
    setActiveRuleId(id);
    setRenameRuleId(id);
    if (mode === 'patient') setMode('rule');
  };

  // ---- Combine rules ----------------------------------------------------
  // Merge multiple selected rules into a single new rule. Useful when
  // the user has separate "Diagnose HTN" and "Diagnose DM2" rules and
  // wants a single comorbid rule that fires only when both criteria
  // hold. The merge:
  //   - unions all L/K/R nodes, edges, and predicates
  //   - renumbers NACs (each source rule's N1, N2, … become globally
  //     unique Nk indices in the combined rule)
  //   - resolves node-id collisions by appending a suffix
  // The result is a brand-new SavedRule loaded into the editor and
  // opened in inline-rename mode so the user can name it.
  //
  // NOTE: The Combine button was hidden in the rule library for now
  // (Run takes over by firing every checked rule sequentially). This
  // function is kept dormant so re-exposing the button is a one-line
  // change. The leading underscore marks it as an intentionally-unused
  // export to silence TS's no-unused-vars warning.
  const _onCombineSelected = () => {
    const selected = savedRules.filter((r) => r.enabled);
    if (selected.length < 2) {
      showToast('Tick at least 2 rules to combine');
      return;
    }

    const mergedNodes: Node[] = [];
    const mergedEdges: Edge[] = [];
    const mergedPreds: Predicate[] = [];
    let nextNacIdx = 1;

    for (const rule of selected) {
      const idMap = new Map<string, string>();
      const nacMap = new Map<string, string>();

      // Collect this rule's NAC indices and renumber globally so two
      // rules with N1 each don't collide.
      const ruleNacs = new Set<string>();
      for (const n of rule.graph.nodes) {
        for (const leg of n.legs ?? []) {
          if (leg.startsWith('N')) ruleNacs.add(leg);
        }
      }
      Array.from(ruleNacs)
        .sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10))
        .forEach((oldNac) => { nacMap.set(oldNac, `N${nextNacIdx++}`); });

      // Translate nodes — remap legs (N1 → Nk) and resolve id collisions.
      for (const n of rule.graph.nodes) {
        let newId = n.id;
        let suffix = 2;
        while (mergedNodes.find((x) => x.id === newId)) {
          newId = `${n.id}-${suffix}`;
          suffix++;
        }
        idMap.set(n.id, newId);
        const newLegs = (n.legs ?? []).map((leg) =>
          leg.startsWith('N') ? (nacMap.get(leg) ?? leg) : leg,
        );
        // Offset position so combined nodes don't overlap source rule's
        // positions. Spreading horizontally per source rule.
        const xOffset = (selected.indexOf(rule)) * 600;
        mergedNodes.push({
          ...n,
          id: newId,
          x: n.x + xOffset,
          y: n.y,
          legs: newLegs.length > 0 ? newLegs : undefined,
          fields: { ...n.fields },
        });
      }

      // Translate edges through the id map.
      for (const e of rule.graph.edges) {
        mergedEdges.push({
          ...e,
          from: idMap.get(e.from) ?? e.from,
          to:   idMap.get(e.to)   ?? e.to,
        });
      }

      // Translate predicates — fresh predicate id, retargeted to merged node.
      for (const p of rule.graph.predicates) {
        mergedPreds.push({
          ...p,
          id: `pred-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          target: idMap.get(p.target) ?? p.target,
        });
      }
    }

    // Apply overlap-relax to nudge any colliding cards apart.
    const relaxedNodes = relaxOverlap(mergedNodes);

    const ts = Date.now();
    const id = `rule-${ts.toString(36)}`;
    const fresh: SavedRule = {
      id,
      name: `Combined: ${selected.map((r) => r.name).join(' + ')}`,
      description: `Combined rule: fires when all conditions of ${selected.length} rules hold simultaneously. Source rules: ${selected.map((r) => r.name).join(', ')}.`,
      enabled: false,
      graph: { nodes: relaxedNodes, edges: mergedEdges, predicates: mergedPreds },
      createdAt: ts, updatedAt: ts,
    };
    setSavedRules((rs) => [...rs, fresh]);
    setActiveRuleId(id);
    setRenameRuleId(id);
    pushHistory('rule');
    setRuleGraph({
      nodes: relaxedNodes,
      edges: mergedEdges,
      selectedId: relaxedNodes[0]?.id ?? null,
      predicates: mergedPreds,
    });
    if (mode === 'patient') setMode('rule');
    bumpFit();
    showToast(`Combined ${selected.length} rules`);
  };

  // (Batch fire was previously a separate handler. It's now folded into
  // onRun below so the topbar Run button fires every checked rule in
  // dropdown order — see that handler for the actual logic.)

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  // ---- Undo/redo --------------------------------------------------------
  // Per-document history of pre-edit snapshots. Pushed by setActiveGraph
  // on every content edit; popped by undo(); cleared on any new content
  // edit (so redo doesn't survive a fresh action). Capped at MAX_HISTORY
  // so a long editing session doesn't bloat memory — 50 is generous for
  // typical rule authoring.
  //
  // Selection-only changes (setSelectedId) bypass this so clicking around
  // doesn't pollute the undo stack.
  const MAX_HISTORY = 50;
  const [undoStacks, setUndoStacks] = useState<Record<DocId, Graph[]>>({ patient: [], rule: [] });
  const [redoStacks, setRedoStacks] = useState<Record<DocId, Graph[]>>({ patient: [], rule: [] });

  // Push a snapshot for the named document onto its undo stack and clear
  // its redo stack (any new edit invalidates redo). Used by setActiveGraph
  // for piecewise edits and by import for whole-document replacements.
  const pushHistory = (which: DocId) => {
    const prev = which === 'patient' ? patientGraph : ruleGraph;
    setUndoStacks((s) => ({ ...s, [which]: [...s[which], prev].slice(-MAX_HISTORY) }));
    setRedoStacks((s) => ({ ...s, [which]: [] }));
  };

  // History-tracking setter — call this for content edits.
  const setActiveGraph = (updater: (g: Graph) => Graph) => {
    pushHistory(currentDoc);
    if (currentDoc === 'patient') setPatientGraph(updater);
    else setRuleGraph(updater);
  };

  // Selection-only setter — does NOT touch history. Clicking around the
  // canvas shouldn't fill up the undo stack.
  const setSelectedId = (id: string | null) => {
    if (currentDoc === 'patient') setPatientGraph((g) => ({ ...g, selectedId: id }));
    else setRuleGraph((g) => ({ ...g, selectedId: id }));
  };

  const { nodes, edges, selectedId, predicates } = active;
  const setNodes = (updater: (prev: Node[]) => Node[]) =>
    setActiveGraph((g) => ({ ...g, nodes: updater(g.nodes) }));
  const setEdges = (updater: (prev: Edge[]) => Edge[]) =>
    setActiveGraph((g) => ({ ...g, edges: updater(g.edges) }));
  const setPredicates = (updater: (prev: Predicate[]) => Predicate[]) =>
    setActiveGraph((g) => ({ ...g, predicates: updater(g.predicates) }));

  // Undo/redo apply directly to the document state — they restore a
  // snapshot rather than producing a new one, so they bypass setActiveGraph
  // and don't push themselves onto history.
  const undo = () => {
    const stack = undoStacks[currentDoc];
    if (stack.length === 0) {
      showToast('Nothing to undo');
      return;
    }
    const snapshot = stack[stack.length - 1];
    const cur = currentDoc === 'patient' ? patientGraph : ruleGraph;
    setUndoStacks((s) => ({ ...s, [currentDoc]: s[currentDoc].slice(0, -1) }));
    setRedoStacks((s) => ({ ...s, [currentDoc]: [...s[currentDoc], cur].slice(-MAX_HISTORY) }));
    if (currentDoc === 'patient') setPatientGraph(snapshot);
    else setRuleGraph(snapshot);
    showToast('Undo');
  };
  const redo = () => {
    const stack = redoStacks[currentDoc];
    if (stack.length === 0) {
      showToast('Nothing to redo');
      return;
    }
    const snapshot = stack[stack.length - 1];
    const cur = currentDoc === 'patient' ? patientGraph : ruleGraph;
    setRedoStacks((s) => ({ ...s, [currentDoc]: s[currentDoc].slice(0, -1) }));
    setUndoStacks((s) => ({ ...s, [currentDoc]: [...s[currentDoc], cur].slice(-MAX_HISTORY) }));
    if (currentDoc === 'patient') setPatientGraph(snapshot);
    else setRuleGraph(snapshot);
    showToast('Redo');
  };

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);

  // Patch a node by id. If patch.id renames, propagate the rename through
  // edges, predicates' target field, and the current selection.
  const updateNode = (id: string, patch: Partial<Node>) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n;
        if (patch.id && patch.id !== id) {
          const newId = patch.id;
          setEdges((es) => es.map((e) => ({
            ...e,
            from: e.from === id ? newId : e.from,
            to:   e.to   === id ? newId : e.to,
          })));
          setPredicates((ps) => ps.map((p) => (p.target === id ? { ...p, target: newId } : p)));
          if (selectedId === id) setSelectedId(newId);
          // Re-anchor the open detail panel to the renamed node — without
          // this, panelOpen still points at the old id, panelNode comes
          // back null on the next render, and the panel collapses.
          setPanelOpen((p) => (p && p.id === id ? { ...p, id: newId } : p));
        }
        const merged: Node = {
          ...n,
          ...patch,
          fields: (patch.fields as FieldMap | undefined) ?? n.fields,
        };
        return merged;
      }),
    );
  };

  // Internal clipboard for resource copy/paste via Ctrl/Cmd+C and
  // Ctrl/Cmd+V. Stores both the node and any predicates that targeted it
  // so the paste re-creates the full picture. Cleared by `cut` paths if
  // we add them later; for now just overwritten by each Copy.
  const [clipboard, setClipboard] = useState<{ node: Node; predicates: Predicate[] } | null>(null);

  // Generate a fresh id of the same type-prefix shape (e.g. "obs-3") that
  // doesn't collide with anything currently in the active document.
  const freshIdFor = (type: string): string => {
    let suffix = nodes.filter((n) => n.type === type).length + 1;
    let id = `${type.toLowerCase().slice(0, 4)}-${suffix}`;
    while (nodes.find((n) => n.id === id)) {
      suffix++;
      id = `${type.toLowerCase().slice(0, 4)}-${suffix}`;
    }
    return id;
  };

  // Copy: snapshot the selected node + its predicates.
  const copyNode = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    const targeting = predicates.filter((p) => p.target === id);
    setClipboard({ node: n, predicates: targeting });
    showToast(`Copied ${n.type}`);
  };

  // Paste: drop a clone of the clipboard contents into the active
  // document with a fresh id, offset from the original position.
  const pasteNode = () => {
    if (!clipboard) {
      showToast('Nothing to paste');
      return;
    }
    const { node: original, predicates: clonePreds } = clipboard;
    const newId = freshIdFor(original.type);
    const newNode: Node = {
      ...original,
      id: newId,
      x: original.x + 60,
      y: original.y + 60,
      fields: { ...original.fields },
      legs: original.legs ? [...original.legs] : undefined,
    };
    setNodes((prev) => [...prev, newNode]);
    setPredicates((prev) => [
      ...prev,
      ...clonePreds.map((p) => ({
        ...p,
        id: `pred-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        target: newId,
      })),
    ]);
    setSelectedId(newId);
    showToast(`Pasted ${original.type}`);
  };

  // Duplicate a node — clones its fields, legs, and any predicates
  // targeting it. The copy gets a fresh id and is placed offset from
  // the original so it's visible without overlapping. Edges are NOT
  // copied (they'd reference the original target node, which usually
  // isn't what the user wants when they duplicate).
  const duplicateNode = (id: string) => {
    const original = nodes.find((n) => n.id === id);
    if (!original) return;
    // Generate a new unique id of the same type-prefix shape addNode uses.
    const existingCount = nodes.filter((n) => n.type === original.type).length;
    let newId = `${original.type.toLowerCase().slice(0, 4)}-${existingCount + 1}`;
    let suffix = existingCount + 1;
    while (nodes.find((n) => n.id === newId)) {
      suffix++;
      newId = `${original.type.toLowerCase().slice(0, 4)}-${suffix}`;
    }
    const newNode: Node = {
      ...original,
      id: newId,
      x: original.x + 60,
      y: original.y + 60,
      fields: { ...original.fields },
      legs: original.legs ? [...original.legs] : undefined,
    };
    setNodes((prev) => [...prev, newNode]);
    // Re-target predicates that pointed at the original to also fire on
    // the copy. New predicate ids so updates don't collide.
    setPredicates((prev) => {
      const cloned = prev
        .filter((p) => p.target === id)
        .map((p) => ({
          ...p,
          id: `pred-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
          target: newId,
        }));
      return [...prev, ...cloned];
    });
    setSelectedId(newId);
    showToast(`Duplicated ${original.type}`);
  };

  const deleteNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    // Predicates targeting the deleted node are orphans — drop them too.
    setPredicates((prev) => prev.filter((p) => p.target !== id));
    if (selectedId === id) setSelectedId(null);
    showToast('Resource deleted');
  };

  // ---- Predicate handlers ---------------------------------------------
  // Predicates are FHIRPath expressions attached to a specific node by id.
  // (The id maps to fullUrl at export time — see docs/fhir_pipeline_design.md
  // for the manifest entry shape.) New predicates start in structured-edit
  // mode with sensible defaults for the target's resource type — DetailPanel
  // re-generates fhirpath whenever a structured field changes.
  const addPredicate = (target: string, init?: Partial<Predicate>) => {
    const pid = `pred-${Date.now().toString(36)}`;
    const targetNode = nodes.find((n) => n.id === target);
    const rt = targetNode?.type ?? '';
    // Default the structured triple to the most useful first attribute for
    // the resource type — value comparison for Observations, status for
    // Conditions/Impressions. The user's edits override the default.
    // `init` (from a template pick) overrides everything below.
    const defaults: Record<string, { attribute: string; operator: string; value: string }> = {
      Observation:        { attribute: 'valueQuantity.value', operator: '>=',     value: '0' },
      Condition:          { attribute: 'clinicalStatus.coding.code', operator: '==', value: 'active' },
      ClinicalImpression: { attribute: 'status', operator: '==', value: 'completed' },
    };
    const d = defaults[rt] ?? { attribute: 'status', operator: '==', value: '' };
    const fresh: Predicate = {
      id: pid, target,
      label:    init?.label    ?? '',
      fhirpath: init?.fhirpath ?? '',
      attribute: init?.attribute ?? d.attribute,
      operator:  init?.operator  ?? d.operator,
      value:     init?.value     ?? d.value,
    };
    setPredicates((prev) => [...prev, fresh]);
  };
  const updatePredicate = (id: string, patch: Partial<Predicate>) => {
    setPredicates((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };
  const deletePredicate = (id: string) => {
    setPredicates((prev) => prev.filter((p) => p.id !== id));
  };

  // Add a new node at world coords (already converted from screen coords by
  // the canvas drop handler). Id strategy: lowercased 4-char type prefix +
  // existing-count + 1 — collision-resistant enough for the demo seed.
  // Fields are prepopulated from the type's default template (data/fhirDefaults).
  //
  // In rule mode, blank fields are upgraded to `${fieldName}` template
  // variables — the FHIR analog of AttrVar(n) — so the rule pattern
  // matches any value at that slot by default. The user can flip
  // individual fields back to literals to constrain the match. Code fields
  // (codeSystem, codeValue) stay literal because that's the typical
  // *trigger* the user wants to specify concretely.
  const addNode = (type: string, x: number, y: number) => {
    if (!TYPE_INFO[type]) return;
    const existing = nodes.filter((n) => n.type === type).length;
    const id = `${type.toLowerCase().slice(0, 4)}-${existing + 1}`;
    let fields: FieldMap = defaultFieldsFor(type, id);
    if (currentDoc === 'rule') {
      const TRIGGER_FIELDS = new Set(['codeSystem', 'codeValue']);
      fields = Object.fromEntries(
        Object.entries(fields).map(([k, v]) =>
          v === '' && !TRIGGER_FIELDS.has(k) ? [k, `\${${k}}`] : [k, v],
        ),
      );
    }
    const newNode: Node = { id, type, x, y, fields };
    setNodes((prev) => [...prev, newNode]);
    setSelectedId(id);
    showToast(`Added ${type}`);
  };

  // Esc deselects. Delete/Backspace removes the selected node. Ctrl/Cmd+Z
  // undoes the last edit on the active document; Ctrl/Cmd+Y or Shift+Ctrl/Cmd+Z
  // redoes. Delete and Undo/Redo only fire when no input/textarea/select is
  // focused — otherwise the browser's input-level undo and the user's
  // typing take precedence.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.key === 'Escape') { setSelectedId(null); setPanelOpen(null); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !inField) {
        e.preventDefault();
        deleteNode(selectedId);
        return;
      }
      // Undo/redo. preventDefault both so the browser doesn't also kick in.
      const mod = e.ctrlKey || e.metaKey;
      // Ctrl/Cmd+S — mirror the Save button. preventDefault unconditionally
      // so the browser doesn't open its "Save Page As..." dialog. We
      // intentionally don't gate this on inField — typing-then-save is the
      // common flow for app saves.
      if (mod && e.key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }
      if (mod && !inField) {
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if ((e.key === 'y') || (e.key === 'Z' && e.shiftKey) || (e.key === 'z' && e.shiftKey)) {
          e.preventDefault(); redo(); return;
        }
        // Ctrl/Cmd+D — duplicate the focused node. Falls back to the
        // panel-open node when the canvas selection has been cleared
        // (e.g., after clicking on the side panel). Browser's "bookmark
        // this page" gets preventDefault'd in favor of our action.
        if (e.key === 'd' && !inField) {
          const dupTarget = selectedId ?? panelOpen?.id ?? null;
          if (dupTarget) {
            e.preventDefault();
            duplicateNode(dupTarget);
            return;
          }
        }
        // Ctrl/Cmd+C / +V — copy/paste the selected node via internal
        // clipboard. Only intercept outside of inputs so users can still
        // copy/paste text in fields normally. With nothing selected for
        // Ctrl+C, we don't preventDefault so the system clipboard
        // behavior (e.g., copy on a text selection) still works.
        if (e.key === 'c' && selectedId && !inField) {
          e.preventDefault();
          copyNode(selectedId);
          return;
        }
        if (e.key === 'v' && clipboard && !inField) {
          e.preventDefault();
          pasteNode();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // currentDoc in deps so the listener re-binds when the focused
    // document changes (mode switch OR compare-mode focus flip).
    // clipboard included so Ctrl+V picks up the latest copy; panelOpen
    // included so Ctrl+D's selection-or-panel-fallback closure stays
    // current when only the panel state changes.
  }, [selectedId, currentDoc, undoStacks, redoStacks, clipboard, panelOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // FSH for the whole graph — recomputed each render. Cheap; the graph is
  // small. Lift to useMemo if profiling ever flags this.
  const fullFSH = generateFSH(nodes, edges);

  // NACs currently referenced anywhere in the graph — drives the leg-filter
  // strip and the DetailPanel's NAC chip row. New NACs appear here as soon
  // as the user toggles them on a node.
  const nacIds = useMemo(() => nacsInUse(nodes.map((n) => n.legs ?? [])), [nodes]);

  // Predicate count per node id — drives the "λ N" pill on rule-mode node
  // cards so the user sees at a glance which resources carry FHIRPath rules.
  const predicateCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of predicates) out[p.target] = (out[p.target] ?? 0) + 1;
    return out;
  }, [predicates]);

  // ---- Import / Export hooks ------------------------------------------
  // Import accepts a FHIR Bundle (type=collection). parseBundle auto-detects
  // rule vs patient by presence of meta.tag legs / a Basic manifest entry,
  // and we route the parsed graph into the matching document — so importing
  // a rule Bundle while in patient mode lands it in Rule mode and switches.
  // Layout coords round-trip via a custom Resource.extension.
  const onImportBundle = (text: string, filename: string) => {
    try {
      const data = JSON.parse(text);
      if (data?.resourceType === 'Bundle' && Array.isArray(data?.entry)) {
        const parsed = parseBundle(data);
        const newGraph: Graph = {
          // Imported bundles often arrive with grid-fallback layouts that
          // can overlap on small graphs; relax once on load.
          nodes: relaxOverlap(parsed.nodes),
          edges: parsed.edges,
          selectedId: null,
          predicates: parsed.predicates,
        };
        if (parsed.isRule) {
          setRuleGraph(newGraph);
          setMode('rule');
          showToast(`Imported rule (${parsed.nodes.length} resources, ${parsed.predicates.length} predicates)`);
        } else {
          setPatientGraph(newGraph);
          setMode('patient');
          showToast(`Imported patient bundle (${parsed.nodes.length} resources)`);
        }
        return;
      }
      showToast(`Couldn't recognize ${filename}`);
    } catch {
      showToast(`Failed to parse ${filename}`);
    }
  };

  // Export emits a real FHIR Bundle. In rule mode, entries carry meta.tag
  // legs and a Basic manifest holds the predicates list (per
  // docs/fhir_pipeline_design.md). In patient mode, no leg tags and no
  // manifest — just a plain collection. Both flavors stash layout coords
  // in a custom extension so the round-trip preserves the canvas layout.
  const onExportBundle = () => {
    const bundle = buildBundle(nodes, edges, predicates);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = mode === 'rule' ? 'rule-bundle.json' : 'patient-bundle.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${mode} bundle`);
  };

  // Fire the active rule against the current patient state via the Julia
  // engine. Endpoint comes from Vite env (`VITE_CDS_URL`), defaulting to
  // localhost:8081 (where cds_server.jl listens). On `:fired`, replace
  // patientGraph with the post-fire state — undoable via Ctrl+Z. On any
  // non-fire status the patient state is unchanged; we just toast the
  // reason. The rule and patient bundles are built from the in-memory
  // graphs so there's no disk round-trip.
  const CDS_URL =
    (import.meta as { env?: { VITE_CDS_URL?: string } }).env?.VITE_CDS_URL ?? 'http://localhost:8081';

  // Run = fire every checked rule in the library, in dropdown order, each
  // fire's output feeding the next as the host state. Per-rule outcomes
  // are collected into batchResult for the modal; final merged state is
  // applied as a single undoable step.
  //
  // 0 enabled rules → friendly prompt, no fire.
  // 1+ enabled    → batch result modal (works for a single rule too —
  //                 the batch modal degrades cleanly to one row).
  const onRun = async () => {
    const enabled = savedRules.filter((r) => r.enabled);
    if (enabled.length === 0) {
      setFireResult({
        fired: false,
        title: 'No rules ticked',
        message: 'Tick at least one rule in the library dropdown (the checkbox next to each rule) to include it in Run.',
      });
      return;
    }
    setFiring(true);
    let runningPatient = patientGraph;
    const results: BatchFireResult[] = [];
    try {
      for (const rule of enabled) {
        const ruleBundle = buildBundle(rule.graph.nodes, rule.graph.edges, rule.graph.predicates);
        const hostBundle = buildBundle(runningPatient.nodes, runningPatient.edges, runningPatient.predicates);
        try {
          const res = await fetch(`${CDS_URL}/fire`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rule: ruleBundle, host: hostBundle }),
          });
          if (!res.ok) {
            const text = await res.text();
            results.push({ ruleId: rule.id, ruleName: rule.name, status: 'error', message: text.slice(0, 200) });
            continue;
          }
          const data = await res.json() as { status: string; detail?: string; state: Record<string, unknown> };
          const status = data.status.startsWith(':') ? data.status.slice(1) : data.status;
          if (status === 'fired') {
            const { merged, newCount } = mergePostFire(runningPatient, data.state);
            runningPatient = merged;
            results.push({ ruleId: rule.id, ruleName: rule.name, status: 'fired', newResourceCount: newCount });
          } else {
            results.push({
              ruleId: rule.id, ruleName: rule.name,
              status: status as BatchFireResult['status'],
              // Pass through engine's detail so the batch modal can show
              // which specific NAC/predicate blocked each non-firing rule.
              message: data.detail,
            });
          }
        } catch (err) {
          // Per-rule fetch/parse failure — record and continue rather
          // than aborting the whole run. Surfaces the real error in the
          // console for debugging (TDZ, JSON shape, etc.).
          console.error(`Fire failed for "${rule.name}":`, err);
          const msg = err instanceof TypeError
            ? `Could not reach engine at ${CDS_URL} — is cds_server.jl running?`
            : err instanceof Error ? err.message : String(err);
          results.push({ ruleId: rule.id, ruleName: rule.name, status: 'error', message: msg });
        }
      }

      // Apply the final patient state as a single undoable batch only if
      // anything actually changed (i.e. at least one rule fired).
      if (results.some((r) => r.status === 'fired')) {
        pushHistory('patient');
        setPatientGraph(runningPatient);
        if (mode !== 'compare') setMode('patient');
        bumpFit();
      }
      setBatchResult(results);
    } finally {
      setFiring(false);
    }
  };

  // Sequential / step-through firing — fires the NEXT enabled rule, not
  // all of them. Useful for inspecting the patient state between fires
  // or stepping through a rule chain to see how each contributes.
  // `stepIndex` tracks which enabled rule fires next; we advance it
  // after each call and reset to 0 when we run off the end.
  const [stepIndex, setStepIndex] = useState(0);
  // Reset the step pointer whenever the enabled set changes — adding
  // or removing a tick mid-sequence shouldn't leave the pointer
  // pointing into the middle of a different rule list.
  useEffect(() => {
    setStepIndex(0);
  }, [savedRules.map((r) => `${r.id}:${r.enabled ? 1 : 0}`).join(',')]);

  const onStep = async (explicit?: number) => {
    const enabled = savedRules.filter((r) => r.enabled);
    if (enabled.length === 0) {
      setFireResult({
        fired: false,
        title: 'No rules ticked',
        message: 'Tick at least one rule in the library dropdown to step through.',
      });
      return;
    }
    const fallback = stepIndex >= enabled.length ? 0 : stepIndex;
    const idx = typeof explicit === 'number' && explicit >= 0 && explicit < enabled.length
      ? explicit
      : fallback;
    const rule = enabled[idx];
    setFiring(true);
    try {
      const ruleBundle = buildBundle(rule.graph.nodes, rule.graph.edges, rule.graph.predicates);
      const hostBundle = buildBundle(patientGraph.nodes, patientGraph.edges, patientGraph.predicates);
      const res = await fetch(`${CDS_URL}/fire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule: ruleBundle, host: hostBundle }),
      });
      if (!res.ok) {
        const text = await res.text();
        showToast(`Engine error: ${text.slice(0, 80)}`);
        return;
      }
      const data = await res.json() as { status: string; detail?: string; state: Record<string, unknown> };
      const status = data.status.startsWith(':') ? data.status.slice(1) : data.status;
      const detail = data.detail ?? '';
      const stepLabel = `Step ${idx + 1}/${enabled.length}: ${rule.name}`;

      if (status === 'fired') {
        const { merged, newCount, newResources } = mergePostFire(patientGraph, data.state);
        pushHistory('patient');
        setPatientGraph(merged);
        if (mode !== 'compare') setMode('patient');
        bumpFit();
        const resourceLines = newResources.map((n) => {
          const display = n.fields.codeDisplay || n.fields.display || n.fields.name || n.fields.title || n.fields.medication || n.id;
          return `+ ${n.type}: ${display}`;
        }).join('\n');
        setFireResult({
          fired: true,
          title: stepLabel,
          message: newCount === 0 ? 'Rule fired but added no new resources.' : `Added ${newCount} new resource${newCount === 1 ? '' : 's'}.`,
          details: resourceLines || undefined,
        });
      } else {
        const reasons: Record<string, string> = {
          no_match:     'L pattern did not match the host.',
          nac_violated: 'A negative application condition is satisfied — rule blocked.',
          pred_failed:  'A FHIRPath predicate evaluated to false.',
          pac_unmet:    'A positive application condition is unmet.',
        };
        setFireResult({
          fired: false,
          title: stepLabel,
          message: reasons[status] ?? `Status: ${status}`,
          details: detail || undefined,
        });
      }
      setStepIndex((idx + 1) % enabled.length);
    } catch (err) {
      console.error('Step failed:', err);
      const msg = err instanceof TypeError
        ? `Could not reach engine at ${CDS_URL} — is cds_server.jl running?`
        : `Engine call failed: ${err instanceof Error ? err.message : String(err)}`;
      showToast(msg);
    } finally {
      setFiring(false);
    }
  };

  return (
    <div className="app">
      <Topbar
        view={view}
        onChangeView={setView}
        mode={mode}
        onChangeMode={(m) => {
          setMode(m);
          // Switching away from rule mode clears the leg filter so the
          // patient-state view isn't unexpectedly dimmed.
          if (m === 'patient') setLegFilter(null);
        }}
        onImportBundle={onImportBundle}
        onExportBundle={onExportBundle}
        onSave={() => showToast('Save not wired yet')}
        onResetPatient={onResetPatient}
        onResetLibrary={onResetLibrary}
        onRun={onRun}
        onStep={onStep}
        stepIndex={stepIndex}
        stepQueue={savedRules.filter((r) => r.enabled).map((r) => r.name)}
        firing={firing}
        onOpenTutorial={(flavor) => setTutorialOpen(flavor)}
        onLoadTemplate={(id) => {
          const t = RULE_TEMPLATES.find((x) => x.id === id);
          if (!t) return;
          // Replace the rule graph (undoable). If we're not in rule/compare,
          // switch to rule so the user sees what was loaded.
          pushHistory('rule');
          setRuleGraph({
            nodes: t.nodes,
            edges: t.edges,
            selectedId: t.defaultSelectedId,
            predicates: t.predicates,
          });
          if (mode === 'patient') setMode('rule');
          showToast(`Loaded template: ${t.name}`);
        }}
      />

      <div className="body">
        <Sidebar search={paletteSearch} onChangeSearch={setPaletteSearch} />

        <div className="canvas-wrap" style={{ display: 'flex', position: 'relative' }}>
          {/* Compare mode — render the rule and patient canvases side-by-side.
              Each canvas owns its own document (data + selection + edits);
              the click that focuses a canvas also updates compareFocusDoc
              so the DetailPanel + Ctrl+Z + addNode handlers route correctly. */}
          {mode === 'compare' && (view === 'graph' || view === 'split') && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minWidth: 0 }}>
              {(['rule', 'patient'] as const).map((doc, idx) => {
                const graph = doc === 'rule' ? ruleGraph : patientGraph;
                const setGraph = doc === 'rule' ? setRuleGraph : setPatientGraph;
                const isFocused = compareFocusDoc === doc;
                const onSelectInDoc = (id: string | null) => {
                  setCompareFocusDoc(doc);
                  setGraph((g) => ({ ...g, selectedId: id }));
                };
                const onNodesChangeInDoc = (updater: (prev: Node[]) => Node[]) => {
                  pushHistory(doc);
                  setGraph((g) => ({ ...g, nodes: updater(g.nodes) }));
                };
                const onEdgesChangeInDoc = (updater: (prev: Edge[]) => Edge[]) => {
                  pushHistory(doc);
                  setGraph((g) => ({ ...g, edges: updater(g.edges) }));
                };
                const onAddNodeInDoc = (t: string, x: number, y: number) => {
                  if (!TYPE_INFO[t]) return;
                  const existing = graph.nodes.filter((n) => n.type === t).length;
                  const id = `${t.toLowerCase().slice(0, 4)}-${existing + 1}`;
                  let f = defaultFieldsFor(t, id);
                  if (doc === 'rule') {
                    const TRIGGERS = new Set(['codeSystem', 'codeValue']);
                    f = Object.fromEntries(Object.entries(f).map(([k, v]) =>
                      v === '' && !TRIGGERS.has(k) ? [k, `\${${k}}`] : [k, v]));
                  }
                  pushHistory(doc);
                  setCompareFocusDoc(doc);
                  setGraph((g) => ({
                    ...g,
                    nodes: [...g.nodes, { id, type: t, x, y, fields: f }],
                    selectedId: id,
                  }));
                  showToast(`Added ${t}`);
                };
                return (
                  <div
                    key={doc}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column',
                      minWidth: 0,
                      borderRight: idx === 0 ? '1px solid var(--border)' : 'none',
                      outline: isFocused ? '2px solid var(--accent-soft)' : 'none',
                      outlineOffset: -2,
                    }}
                  >
                    <div className="compare-label">
                      {doc === 'rule' ? 'Rule' : 'Patient'}
                      {isFocused && <span style={{ color: 'var(--accent)', marginLeft: 6 }} title="Focused pane">●</span>}
                    </div>
                    {doc === 'rule' && (
                      <RuleLibrary
                        rules={savedRules}
                        activeRuleId={activeRuleId}
                        editingRuleId={renameRuleId}
                        onEditingDone={() => setRenameRuleId(null)}
                        onLoadRule={onLoadRule}
                        onDeleteRule={onDeleteRule}
                        onToggleEnabled={onToggleEnabled}
                        onSaveCurrent={onSaveCurrent}
                        onUpdateName={onUpdateRuleName}
                        onNewRule={onNewRule}
                      />
                    )}
                    {doc === 'rule' && (
                      <LegFilter nacs={nacIds} active={legFilter} onChange={setLegFilter} />
                    )}
                    <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                      <GraphCanvas
                        nodes={graph.nodes}
                        edges={graph.edges}
                        selectedId={graph.selectedId}
                        onSelect={(id) => {
                          onSelectInDoc(id);
                          // Single-click on empty canvas just deselects;
                          // panel close is double-click only.
                          if (id !== null && panelOpen) setPanelOpen({ doc, id });
                        }}
                        onCanvasDoubleClick={() => setPanelOpen(null)}
                        onNodesChange={onNodesChangeInDoc}
                        onEdgesChange={onEdgesChangeInDoc}
                        onAddNode={onAddNodeInDoc}
                        onOpenNode={(id) => {
                          setCompareFocusDoc(doc);
                          setPanelOpen({ doc, id });
                        }}
                        showLegs={doc === 'rule'}
                        legFilter={doc === 'rule' ? legFilter : null}
                        predicateCounts={doc === 'rule' ? predicateCounts : undefined}
                        predicates={doc === 'rule' ? graph.predicates : undefined}
                        onShowToast={showToast}
                        fitToken={fitToken}
                      />
                    </div>
                  </div>
                );
              })}
              <div className={'toast ' + (toast ? 'show' : '')}>{toast ?? ''}</div>
            </div>
          )}

          {/* Single-document mode (patient or rule) — unchanged from before. */}
          {mode !== 'compare' && (view === 'graph' || view === 'split') && (
            <div style={{ flex: 1, position: 'relative', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {mode === 'rule' && (
                <RuleLibrary
                  rules={savedRules}
                  activeRuleId={activeRuleId}
                  editingRuleId={renameRuleId}
                  onEditingDone={() => setRenameRuleId(null)}
                  onLoadRule={onLoadRule}
                  onDeleteRule={onDeleteRule}
                  onToggleEnabled={onToggleEnabled}
                  onSaveCurrent={onSaveCurrent}
                  onUpdateName={onUpdateRuleName}
                  onNewRule={onNewRule}
                />
              )}
              {mode === 'rule' && (
                <RuleInfoBar
                  rule={activeRuleId ? savedRules.find((r) => r.id === activeRuleId) ?? null : null}
                  onUpdateName={onUpdateRuleName}
                  onUpdateDescription={onUpdateRuleDescription}
                />
              )}
              {mode === 'rule' && (
                <LegFilter
                  nacs={nacIds}
                  active={legFilter}
                  onChange={setLegFilter}
                />
              )}
              <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                <GraphCanvas
                  nodes={nodes}
                  edges={edges}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    setSelectedId(id);
                    // Single-click on empty canvas just deselects — it
                    // does NOT close the side panel. Closing happens only
                    // on Escape, the panel's × button, or a double-click
                    // on bare canvas (wired via onCanvasDoubleClick).
                    if (id !== null && panelOpen) setPanelOpen({ doc: currentDoc, id });
                  }}
                  onCanvasDoubleClick={() => setPanelOpen(null)}
                  onNodesChange={setNodes}
                  onEdgesChange={setEdges}
                  onAddNode={addNode}
                  onOpenNode={(id) => setPanelOpen({ doc: currentDoc, id })}
                  showLegs={mode === 'rule'}
                  legFilter={legFilter}
                  predicateCounts={mode === 'rule' ? predicateCounts : undefined}
                  predicates={mode === 'rule' ? predicates : undefined}
                  onShowToast={showToast}
                  fitToken={fitToken}
                />
                <div className={'toast ' + (toast ? 'show' : '')}>{toast ?? ''}</div>
              </div>
            </div>
          )}
          {(view === 'fsh' || view === 'split') && (
            <div
              style={{
                flex: view === 'fsh' ? 1 : 0.6,
                background: 'var(--background)',
                borderLeft: view === 'split' ? '1px solid var(--border)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
              }}
            >
              <div
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>FHIR Shorthand</span>
                <span
                  className="badge dot"
                  style={{ color: 'var(--success)', borderColor: '#bbf7d0', background: '#f0fdf4' }}
                >
                  synced
                </span>
                <span className="grow" style={{ flex: 1 }} />
                <button
                  className="btn sm"
                  onClick={() => {
                    navigator.clipboard.writeText(fullFSH).then(() => showToast('Copied to clipboard'));
                  }}
                >
                  Copy
                </button>
              </div>
              <pre
                className="code"
                style={{ margin: 0, border: 'none', borderRadius: 0, flex: 1, background: '#fafafa' }}
                dangerouslySetInnerHTML={{ __html: fshSyntaxHighlight(fullFSH, selectedId) }}
              />
            </div>
          )}
        </div>

        {panelNode && (
          <DetailPanel
            node={panelNode}
            allNodes={panelDoc === 'patient' ? patientGraph.nodes : ruleGraph.nodes}
            edges={panelDoc === 'patient' ? patientGraph.edges : ruleGraph.edges}
            // DetailPanel gates the leg/predicate editors behind
            // mode === 'rule'. In compare view we want those editors to
            // light up whenever the panel is showing a rule-doc node,
            // regardless of the global mode — so we derive an effective
            // mode from panelDoc instead of passing the global one.
            mode={panelDoc === 'rule' ? 'rule' : 'patient'}
            nacsInUse={nacIds}
            predicates={panelDoc === 'patient' ? patientGraph.predicates : ruleGraph.predicates}
            onUpdateNode={updateNode}
            onDeleteNode={deleteNode}
            onDuplicateNode={duplicateNode}
            onAddPredicate={addPredicate}
            onUpdatePredicate={updatePredicate}
            onDeletePredicate={deletePredicate}
            onClose={() => setPanelOpen(null)}
            onSelectNode={(id) => setPanelOpen({ doc: panelDoc, id })}
          />
        )}
      </div>

      {/* Batch fire results — list of per-rule outcomes from a "Fire
          selected" run. Each row shows status icon + rule name + reason.
          Click outside / OK to dismiss. */}
      {batchResult && (
        <div className="fire-result-overlay" onClick={() => setBatchResult(null)}>
          <div className="batch-result-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="fire-result-title">Batch fire result</h3>
            <p className="fire-result-message">
              {batchResult.filter((r) => r.status === 'fired').length} fired
              · {batchResult.filter((r) => r.status !== 'fired' && r.status !== 'error').length} skipped
              · {batchResult.filter((r) => r.status === 'error').length} errored
            </p>
            <div className="batch-result-list">
              {batchResult.map((r) => (
                <div key={r.ruleId} className={'batch-result-row ' + r.status}>
                  <span className={'batch-result-icon ' + r.status}>
                    {r.status === 'fired'  ? '✓' :
                     r.status === 'error'  ? '!' : '·'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="batch-result-name">{r.ruleName}</div>
                    <div className="batch-result-reason">
                      {r.status === 'fired'        ? `Fired (+${r.newResourceCount ?? 0} resources)` :
                       r.status === 'no_match'     ? 'No match' :
                       r.status === 'nac_violated' ? `Blocked by NAC${r.message ? ` (${r.message})` : ''}` :
                       r.status === 'pred_failed'  ? `Predicate failed${r.message ? `: ${r.message}` : ''}` :
                       r.status === 'pac_unmet'    ? `PAC unmet${r.message ? ` (${r.message})` : ''}` :
                       r.status === 'error'        ? `Error: ${r.message ?? ''}` :
                       r.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn primary" onClick={() => setBatchResult(null)}>OK</button>
          </div>
        </div>
      )}

      {/* Tutorial modal — full-page overlay, two flavors. */}
      {tutorialOpen && (
        <TutorialModal flavor={tutorialOpen} onClose={() => setTutorialOpen(null)} />
      )}

      {/* Fire-result modal — surfaces the engine's verdict with enough
          context to debug a non-fire. Click outside or the OK button to
          dismiss. Auto-dismisses after 4s on a successful fire. */}
      {fireResult && (
        <div className="fire-result-overlay" onClick={() => setFireResult(null)}>
          <div className="fire-result-modal" onClick={(e) => e.stopPropagation()}>
            <div className={'fire-result-icon ' + (fireResult.fired ? 'fired' : 'blocked')}>
              {fireResult.fired ? '✓' : '✕'}
            </div>
            <h3 className="fire-result-title">{fireResult.title}</h3>
            <p className="fire-result-message">{fireResult.message}</p>
            {fireResult.details && (
              <div className="fire-result-details">{fireResult.details}</div>
            )}
            <button className="btn primary" onClick={() => setFireResult(null)}>
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// All Bundle ↔ graph translation lives in lib/ruleBundle.ts.
// parseBundle(...) handles import; buildBundle(...) handles export.
//
// mergePostFire takes the pre-fire patient graph and the engine's
// post-fire Bundle, and produces the next patient graph:
//   1. Re-maps engine-generated UUIDs back to original node ids by
//      matching codeSystem + codeValue (so obs-1 stays obs-1 instead
//      of becoming a UUID).
//   2. Preserves x/y on matched nodes; lays out brand-new resources in
//      a tidy column to the right of the existing graph.
//   3. Keeps non-engine resources (Patient/Encounter/etc.) verbatim and
//      preserves edges that touch them.
// Used by both single-rule fire (onRun) and batch fire (onFireSelected).
function mergePostFire(
  prePatient: Graph,
  postBundle: Record<string, unknown>,
): { merged: Graph; newCount: number; newResources: Node[] } {
  const parsed = parseBundle(postBundle);
  // Engine-tracked types — every resource Ob in the Julia CState
  // schema. Nodes of these types round-trip through the engine on fire;
  // everything else (Patient, Encounter, etc.) is passthrough and
  // preserved verbatim. Keep in sync with clinical_state_multi.jl.
  const ENGINE_TYPES = new Set([
    'Observation', 'Condition', 'ClinicalImpression',
    'MedicationRequest', 'Appointment', 'Encounter',
  ]);
  // codeKey identifies "the same FHIR resource" across the round trip.
  // For each engine-tracked type, we include a disambiguating field
  // (time / value) so resources that share a code but represent
  // different events stay distinct in the merge:
  //   * Observation:        effective + value  (multi-reading)
  //   * Condition:          recordedDate       (multi-event diagnosis)
  //   * ClinicalImpression: date               (each fire's assessment)
  // Without this, the post-fire merge collapses two same-coded resources
  // into one and the newResources count drops to zero, even though the
  // engine actually added a row.
  const codeKey = (n: typeof parsed.nodes[number]) => {
    const base = `${n.type}|${n.fields.codeSystem ?? ''}|${n.fields.codeValue ?? ''}`;
    if (n.type === 'Observation') {
      return `${base}|${n.fields.effective ?? ''}|${n.fields.value ?? ''}`;
    }
    if (n.type === 'Condition') {
      return `${base}|${n.fields.recordedDate ?? ''}`;
    }
    if (n.type === 'ClinicalImpression') {
      return `${base}|${n.fields.date ?? ''}`;
    }
    // MedicationRequest is now coded (RxNorm) — same disambiguator as
    // Observation/Condition: codeSystem + codeValue + status. Two
    // active metformin orders should still collapse to the same key.
    if (n.type === 'MedicationRequest') {
      return `${n.type}|${n.fields.codeSystem ?? ''}|${n.fields.codeValue ?? ''}|${n.fields.status ?? ''}`;
    }
    if (n.type === 'Appointment') {
      // Code + start disambiguates an existing appt from a fresh
      // referral with the same serviceType.
      return `${n.type}|${n.fields.codeSystem ?? ''}|${n.fields.codeValue ?? ''}|${n.fields.start ?? ''}|${n.fields.status ?? ''}`;
    }
    if (n.type === 'Encounter') {
      return `${n.type}|${n.fields.codeSystem ?? ''}|${n.fields.codeValue ?? ''}|${n.fields.start ?? ''}`;
    }
    return base;
  };

  const idMap = new Map<string, string>();
  const preEngineByKey = new Map<string, string>();
  for (const n of prePatient.nodes) {
    if (ENGINE_TYPES.has(n.type)) preEngineByKey.set(codeKey(n), n.id);
  }
  for (const n of parsed.nodes) {
    const orig = preEngineByKey.get(codeKey(n));
    if (orig) idMap.set(n.id, orig);
  }

  const origPos = new Map<string, { x: number; y: number }>();
  for (const n of prePatient.nodes) origPos.set(n.id, { x: n.x, y: n.y });

  const maxX = prePatient.nodes.length > 0
    ? Math.max(...prePatient.nodes.map((n) => n.x)) : 400;
  const baseY = prePatient.nodes.length > 0
    ? Math.min(...prePatient.nodes.map((n) => n.y)) : 200;
  let newColIndex = 0;
  const NEW_COL_X = 360;
  const NEW_COL_DY = 220;
  // Compute passthrough nodes (Patient/Encounter/etc. — types the engine
  // doesn't track) up front. They keep their pre-fire positions and ids,
  // and seed the uniqueness set so the engine-tracked remap can't
  // collide with them.
  const passthroughNodes = prePatient.nodes.filter((n) => !ENGINE_TYPES.has(n.type));
  // Defensive uniqueness pass — guarantees no two nodes in the merged
  // graph share an id. Two parsed resources with the same codeKey would
  // both want to remap onto the same pre-existing node id; the first
  // wins, the rest get treated as new (with suffix-renamed ids if their
  // engine-generated UUIDs happen to collide with anything already in
  // the graph). Without this, React renders duplicate keys and the
  // patient state silently corrupts.
  const usedIds = new Set<string>(passthroughNodes.map((n) => n.id));
  const newResources: Node[] = [];
  let suffixCounter = 2;
  const uniqueId = (preferred: string): string => {
    if (!usedIds.has(preferred)) { usedIds.add(preferred); return preferred; }
    let id = `${preferred}-${suffixCounter++}`;
    while (usedIds.has(id)) id = `${preferred}-${suffixCounter++}`;
    usedIds.add(id);
    return id;
  };
  // Engine-uuid → actual-final-id mapping. Distinct from `idMap`
  // because suffix-renamed collision cases have a different final id
  // than what idMap suggests. Edges must use this for retargeting.
  const finalIdMap = new Map<string, string>();
  const remappedNodes = parsed.nodes.map((n) => {
    const orig = idMap.get(n.id);
    if (orig && !usedIds.has(orig)) {
      const id = uniqueId(orig);
      finalIdMap.set(n.id, id);
      const op = origPos.get(orig);
      return { ...n, id, x: op?.x ?? n.x, y: op?.y ?? n.y };
    }
    // New (or collision): place in the right-side column with a unique id.
    const id = uniqueId(n.id);
    finalIdMap.set(n.id, id);
    const x = maxX + NEW_COL_X;
    const y = baseY + newColIndex * NEW_COL_DY;
    newColIndex++;
    const fresh = { ...n, id, x, y };
    newResources.push(fresh);
    return fresh;
  });
  const remappedEdges = parsed.edges.map((e) => ({
    ...e,
    from: finalIdMap.get(e.from) ?? e.from,
    to:   finalIdMap.get(e.to)   ?? e.to,
  }));

  const finalIds = new Set([
    ...passthroughNodes.map((n) => n.id),
    ...remappedNodes.map((n) => n.id),
  ]);
  // Keep every prePatient edge whose endpoints both survive into the
  // merged graph — including engine-tracked-to-engine-tracked edges
  // like obs → enc-1 (encounter). The engine doesn't track every FHIR
  // reference (subject, encounter, etc. live as UI-only edges), so
  // those need to be carried forward by the merge. Edges the engine
  // does track will appear in `remappedEdges`; we dedupe below so a
  // (from, to, label) triple isn't double-emitted.
  const preEdges = prePatient.edges.filter((e) =>
    finalIds.has(e.from) && finalIds.has(e.to),
  );

  // Implicit subject — every newly-created clinical resource is wired
  // to the patient via a `subject` edge automatically. The rule author
  // never has to draw "Observation → Patient" manually because *every*
  // clinical resource in a real chart has a subject; it's pure
  // boilerplate. We pick the first Patient passthrough node as the
  // referent, do nothing if the chart has no Patient (rare — would
  // typically only happen in test fixtures).
  const patientNode = passthroughNodes.find((n) => n.type === 'Patient');
  const implicitEdges: Edge[] = [];
  if (patientNode) {
    const allEdgesAfter = [...preEdges, ...remappedEdges];
    for (const fresh of newResources) {
      // Only clinical resources need a subject. Skip ClinicalImpression
      // because its semantic root is the impression itself; FHIR allows
      // subject but the demo doesn't use it.
      if (!['Observation', 'Condition', 'MedicationRequest', 'Appointment', 'Encounter'].includes(fresh.type)) continue;
      const alreadyHasSubject = allEdgesAfter.some(
        (e) => e.from === fresh.id && e.label === 'subject',
      );
      if (alreadyHasSubject) continue;
      implicitEdges.push({ from: fresh.id, to: patientNode.id, label: 'subject' });
    }
  }

  // Dedupe edges by (from, to, label) so the engine-tracked references
  // (which appear in both preEdges and remappedEdges after a successful
  // round-trip) don't get duplicated in the merged graph.
  const seenEdgeKey = new Set<string>();
  const dedupedEdges: Edge[] = [];
  for (const e of [...preEdges, ...remappedEdges, ...implicitEdges]) {
    const k = `${e.from}→${e.to}|${e.label}`;
    if (seenEdgeKey.has(k)) continue;
    seenEdgeKey.add(k);
    dedupedEdges.push(e);
  }

  return {
    merged: {
      // Relax any overlap between passthrough nodes and the new column
      // of post-fire resources. The new column's column-spacing should
      // already keep things tidy, but if the patient state has nodes
      // close to that column, this nudges them apart.
      nodes: relaxOverlap([...passthroughNodes, ...remappedNodes]),
      edges: dedupedEdges,
      selectedId: null,
      predicates: prePatient.predicates,
    },
    newCount: newResources.length,
    newResources,
  };
}
