// DetailPanel — right rail. Header + tabs (Overview/Fields/References/FSH)
// + footer. Inline edits dispatch immediately to the parent's onUpdateNode;
// id renames propagate through the edges in the parent reducer.

import { useEffect, useMemo, useState } from 'react';
import { TYPE_INFO } from '../data/palette';
import { fshSyntaxHighlight, generateFSH } from '../lib/fsh';
import { CORE_LEGS, maxNacIndex, sortLegs, toggleLeg, tone } from '../lib/legs';
import { ATTRS_BY_TYPE, attrSpec, DATE_PRESETS, generateFhirpath, opsForType } from '../lib/fhirpath';
import { displayOfWithIdFallback } from '../lib/display';
import { searchCodes, KINDS_FOR_TYPE, type CodeEntry } from '../data/codeLibrary';
import { templatesFor, type PredicateTemplate } from '../data/predicateTemplates';
import type { AuthoringMode, Edge, FieldMap, Node, Predicate } from '../lib/types';

type Tab = 'overview' | 'fields' | 'refs' | 'fsh';

interface Props {
  node: Node;
  allNodes: Node[];
  edges: Edge[];
  mode: AuthoringMode;
  nacsInUse: string[];                // NACs already attached to other nodes
  predicates: Predicate[];            // all predicates on this rule (filtered to target=node.id below)
  onUpdateNode: (id: string, patch: Partial<Node>) => void;
  onDeleteNode: (id: string) => void;
  onDuplicateNode: (id: string) => void;
  // Add a predicate to the rule, optionally pre-filled with a template's
  // attribute/operator/value/fhirpath. The user picks the template from
  // a curated list (see predicateTemplates.ts); free-form authoring still
  // works by passing no `init`.
  onAddPredicate: (target: string, init?: Partial<Predicate>) => void;
  onUpdatePredicate: (id: string, patch: Partial<Predicate>) => void;
  onDeletePredicate: (id: string) => void;
  onClose: () => void;
  onSelectNode: (id: string) => void;
}

export function DetailPanel({
  node, allNodes, edges, mode, nacsInUse, predicates,
  onUpdateNode, onDeleteNode, onDuplicateNode,
  onAddPredicate, onUpdatePredicate, onDeletePredicate,
  onClose, onSelectNode,
}: Props) {
  const [tab, setTab] = useState<Tab>('overview');

  // Buffer the resource-id input locally so each keystroke doesn't
  // immediately rename the node. The parent's onUpdateNode rename
  // logic propagates the new id everywhere (edges, predicates,
  // selection) — but the panel itself was opened with the OLD id, so
  // a per-keystroke commit briefly leaves panelOpen pointing at a
  // node that no longer exists, and the panel closes. Committing on
  // blur or Enter keeps the panel anchored.
  const [idBuffer, setIdBuffer] = useState(node.id);
  useEffect(() => { setIdBuffer(node.id); }, [node.id]);
  const commitId = () => {
    const next = idBuffer.trim();
    if (!next || next === node.id) { setIdBuffer(node.id); return; }
    onUpdateNode(node.id, { id: next });
  };

  const info = TYPE_INFO[node.type] || { cls: 'cat-admin', short: '?', type: node.type, group: '' };
  const outRefs = edges.filter((e) => e.from === node.id);
  const inRefs = edges.filter((e) => e.to === node.id);

  const setField = (k: string, v: string) => {
    const next: FieldMap = { ...node.fields, [k]: v };
    onUpdateNode(node.id, { fields: next });
  };

  // Apply a code-library entry to (codeSystem, codeValue, codeDisplay) atomically.
  // Used by the code-picker autocomplete on the codeDisplay row, so the
  // user types a name and gets the proper FHIR triple in one click.
  const applyCode = (entry: CodeEntry) => {
    const next: FieldMap = {
      ...node.fields,
      codeSystem:  entry.system,
      codeValue:   entry.code,
      codeDisplay: entry.display,
    };
    onUpdateNode(node.id, { fields: next });
    setCodePickerOpen(false);
  };

  // Open-state for the code-picker dropdown. Search is just the live
  // field value — no separate query state to drift out of sync.
  const [codePickerOpen, setCodePickerOpen] = useState(false);
  useEffect(() => { setCodePickerOpen(false); }, [node.id]);
  const codePickerActive = !!KINDS_FOR_TYPE[node.type];

  // Lightweight input-type inference by field name. Numeric fields take a
  // <input type=number>, date/time fields take datetime-local. Anything
  // else is plain text. Template-variable values (`${name}`) bypass the
  // typed input — switch to text so the user can keep editing.
  const inputTypeForField = (key: string, val: string): { type: string; step?: string } => {
    if (val.startsWith('${')) return { type: 'text' };
    if (/^(value|magnitude)$/i.test(key))     return { type: 'number', step: 'any' };
    if (/(date|effective|recorded|onset|when|period|birth|time)/i.test(key)) {
      return { type: 'datetime-local' };
    }
    return { type: 'text' };
  };

  // For fields with predefined values, return both the option list and a
  // `closed` flag. Closed-set fields (status, clinicalStatus, gender)
  // render as a real <select> — discoverable dropdown, no need to know
  // about datalist quirks. Open-set fields (codeSystem) render as an
  // <input list> combobox so the user can also type a custom URL.
  const fieldOptionsFor = (key: string): { options: string[]; closed: boolean } | undefined => {
    if (node.type === 'Observation' && key === 'status') {
      return { closed: true, options: ['registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled', 'entered-in-error', 'unknown'] };
    }
    if (node.type === 'Condition' && key === 'clinicalStatus') {
      return { closed: true, options: ['active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved'] };
    }
    if (node.type === 'ClinicalImpression' && key === 'status') {
      return { closed: true, options: ['preparation', 'in-progress', 'completed', 'entered-in-error'] };
    }
    if (key === 'gender' && node.type === 'Patient') {
      return { closed: true, options: ['male', 'female', 'other', 'unknown'] };
    }
    // Code system URLs — common FHIR terminologies as suggestions, but
    // free-text override allowed for custom systems.
    if (key === 'codeSystem') {
      return { closed: false, options: [
        'http://loinc.org',
        'http://snomed.info/sct',
        'http://hl7.org/fhir/sid/icd-10-cm',
        'http://hl7.org/fhir/sid/icd-10',
        'http://www.nlm.nih.gov/research/umls/rxnorm',
        'http://hl7.org/fhir/sid/cvx',
        'http://terminology.hl7.org/CodeSystem/condition-clinical',
        'http://terminology.hl7.org/CodeSystem/condition-category',
        'http://hl7.org/fhir/sid/ndc',
        'http://www.ama-assn.org/go/cpt',
      ] };
    }
    return undefined;
  };

  // One row per field — picks between <select> (closed enum), <input list>
  // combobox (open enum), and <input> (no enum) based on fieldOptionsFor.
  const renderFieldRow = (k: string, v: string) => {
    // codeDisplay gets a code-library autocomplete instead of plain text.
    // Typing "metformin" surfaces a dropdown of matching RxNorm codes;
    // selecting one fills (codeSystem, codeValue, codeDisplay) atomically.
    // Free text still works — picking nothing leaves the literal you typed.
    if (k === 'codeDisplay' && codePickerActive) {
      // Search against the live field value so codes surface as the
      // user types — typing "metformin" pulls up RxNorm, "diabetes"
      // pulls up SNOMED, etc. Picking a row fills (codeSystem,
      // codeValue, codeDisplay) atomically. The 🔍 icon and the
      // placeholder hint signal that this isn't a plain text input.
      const matches = searchCodes(v, node.type);
      return (
        <div className="field-row" key={k}>
          <div className="lab">{k}</div>
          <div className="code-picker-wrap">
            <span className="code-picker-icon" aria-hidden="true">🔍</span>
            <input
              className="input code-picker-input"
              value={v}
              placeholder="Search the code library…"
              onChange={(e) => { setField(k, e.target.value); setCodePickerOpen(true); }}
              onFocus={() => setCodePickerOpen(true)}
              onBlur={() => setTimeout(() => setCodePickerOpen(false), 150)}
            />
            {codePickerOpen && matches.length > 0 && (
              <div className="code-picker-menu">
                {matches.map((c) => (
                  <button
                    key={`${c.system}|${c.code}`}
                    type="button"
                    className="code-picker-row"
                    onMouseDown={(e) => { e.preventDefault(); applyCode(c); }}
                    title={`${c.system} ${c.code}`}
                  >
                    <span className="code-picker-display">{c.display}</span>
                    <span className="code-picker-meta mono">{c.code}</span>
                  </button>
                ))}
              </div>
            )}
            {codePickerOpen && v.trim() && matches.length === 0 && (
              <div className="code-picker-menu">
                <div className="code-picker-empty">
                  No matches in the code library — keeping "{v}" as a custom display.
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }
    const opts = fieldOptionsFor(k);
    if (opts?.closed) {
      // Closed-set <select>. Always include the current value as an option
      // (even if it isn't in the canonical list) so legacy/imported data
      // still displays correctly.
      const inSet = opts.options.includes(v);
      return (
        <div className="field-row" key={k}>
          <div className="lab">{k}</div>
          <select className="select" value={v} onChange={(e) => setField(k, e.target.value)}>
            {!inSet && <option value={v}>{v ? `${v} (custom)` : '(none)'}</option>}
            {opts.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      );
    }
    // Open-set or none — typed input + optional datalist suggestions.
    return (
      <div className="field-row" key={k}>
        <div className="lab">{k}</div>
        <input
          className="input"
          type={inputTypeForField(k, v).type}
          step={inputTypeForField(k, v).step}
          list={opts ? `dl-${node.id}-${k}` : undefined}
          value={v}
          onChange={(e) => setField(k, e.target.value)}
        />
        {opts && (
          <datalist id={`dl-${node.id}-${k}`}>
            {opts.options.map((o) => <option key={o} value={o} />)}
          </datalist>
        )}
      </div>
    );
  };

  // ---- Leg-tag editing ------------------------------------------------
  // Legs are an unordered set; toggling appends or removes. Adding a brand-
  // new NAC index is a separate action so the user can author N1 / N2 / …
  // without polluting the L/K/R chip row.
  const legs = node.legs ?? [];
  const setLeg = (leg: string) =>
    onUpdateNode(node.id, { legs: toggleLeg(node.legs, leg) });

  const addNac = () => {
    // Next NAC index = 1 + max across the whole graph (so the user gets a
    // fresh distinct NAC even if they delete one mid-stream).
    const next = maxNacIndex(allNodes.map((n) => n.legs ?? [])) + 1;
    onUpdateNode(node.id, { legs: toggleLeg(node.legs, `N${next}`) });
  };

  // NACs available as toggles on this node = anything already in use elsewhere
  // PLUS any NACs already tagged on this node. Sorted by index for stability.
  const availableNacs = sortLegs(
    Array.from(new Set([...nacsInUse, ...legs.filter((l) => l.startsWith('N'))])),
  );

  // Predicates targeting this node — shown inline so the user sees what
  // FHIRPath rules constrain this resource without leaving the panel.
  const myPredicates = predicates.filter((p) => p.target === node.id);

  // FSH for this node + its outgoing references only — quick-look slice.
  const fshSnippet = useMemo(() => generateFSH([node], outRefs), [node, outRefs]);

  return (
    <div className="detail">
      <div className="detail-h">
        <div className={'nicon ' + info.cls}>{info.short}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Display name on top — uses the shared `displayOf` fallback
              chain (codeDisplay → display → name → title → medication →
              description → id) so the panel header stays consistent
              with the node card AND with copy/paste round-trips between
              patient and rule documents. Resource type + id underneath
              as smaller context. */}
          <div
            style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden',
                     textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={displayOfWithIdFallback(node)}
          >
            {displayOfWithIdFallback(node)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted-foreground)',
                        display: 'flex', gap: 6, alignItems: 'center' }}>
            <span>{node.type}</span>
            <span style={{ color: 'var(--border-strong)' }}>·</span>
            <span className="mono">{node.id}</span>
          </div>
        </div>
        <button className="btn icon ghost sm" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="detail-tabs">
        <button className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>Overview</button>
        <button className={tab === 'fields'   ? 'on' : ''} onClick={() => setTab('fields')}  >Fields</button>
        <button className={tab === 'refs'     ? 'on' : ''} onClick={() => setTab('refs')}    >References</button>
        <button className={tab === 'fsh'      ? 'on' : ''} onClick={() => setTab('fsh')}     >FSH</button>
      </div>

      <div className="detail-body">
        {tab === 'overview' && (
          <>
            <div className="field-grp">
              <label>Identity</label>
              <div className="field-row">
                <div className="lab">Resource</div>
                <input
                  className="input mono"
                  value={idBuffer}
                  onChange={(e) => setIdBuffer(e.target.value)}
                  onBlur={commitId}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    else if (e.key === 'Escape') {
                      setIdBuffer(node.id);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </div>
              <div className="field-row">
                <div className="lab">Type</div>
                <select
                  className="select"
                  value={node.type}
                  onChange={(e) => onUpdateNode(node.id, { type: e.target.value })}
                >
                  {Object.keys(TYPE_INFO).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field-grp">
              <label>Status</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="badge valid dot">Valid</span>
                <span
                  className="badge dot"
                  style={{ color: 'var(--accent)', borderColor: 'var(--accent-line)', background: 'var(--accent-soft)' }}
                >
                  {outRefs.length} outgoing
                </span>
                <span className="badge dot">{inRefs.length} incoming</span>
              </div>
            </div>

            {mode === 'rule' && (
              <div className="field-grp">
                <label>Legs</label>
                <div className="leg-row">
                  {CORE_LEGS.map((l) => {
                    const on = legs.includes(l);
                    return (
                      <button
                        key={l}
                        className={`leg-chip ${tone(l)} ` + (on ? 'on' : 'off')}
                        onClick={() => setLeg(l)}
                        title={
                          l === 'L' ? 'Pattern (matches host state)'
                          : l === 'K' ? 'Interface (preserved by rewrite)'
                          : 'Rewrite target'
                        }
                      >
                        {l}
                      </button>
                    );
                  })}
                </div>
                {/* NAC tags are only meaningful on nodes that AREN'T in
                    L. L-tagged nodes get auto-extended into every NAC
                    by expandLegsForNACs at bundle-build time, so showing
                    NAC toggles on them would mislead the author into
                    thinking they have to manage NAC membership manually.
                    Hide the row entirely when L is set; show it (with
                    "+ NAC" affordance) when the node is NAC-only or
                    R-only material. */}
                {!legs.includes('L') && (
                  <div className="leg-row" style={{ marginTop: 6 }}>
                    {availableNacs.map((n) => {
                      const on = legs.includes(n);
                      return (
                        <button
                          key={n}
                          className={`leg-chip ${tone(n)} ` + (on ? 'on' : 'off')}
                          onClick={() => setLeg(n)}
                          title="Negative application condition"
                        >
                          {n}
                        </button>
                      );
                    })}
                    <button className="btn sm" onClick={addNac} title="Add this node to a fresh NAC">
                      + NAC
                    </button>
                  </div>
                )}
                <div className="leg-hint">
                  L = match pattern · K = preserved across rewrite · R = result
                  {!legs.includes('L') && <> · N<sub>i</sub> = forbidden context</>}
                  <div style={{ marginTop: 4, opacity: 0.85 }}>
                    Within one NAC: <b>AND</b> — every node must match for the NAC to block.
                    Across multiple NACs (N<sub>1</sub>, N<sub>2</sub>, …): <b>OR</b> — any single NAC matching is enough to block.
                  </div>
                </div>
              </div>
            )}

            {mode === 'rule' && (
              <div className="field-grp">
                <label>Predicates</label>
                {myPredicates.length === 0 && (
                  <div className="leg-hint" style={{ marginTop: 0 }}>
                    No FHIRPath predicates on this resource. Predicates are
                    evaluated after the structural match — pick an attribute,
                    operator, and value below; the FHIRPath expression is
                    generated for you.
                  </div>
                )}
                {myPredicates.map((p) => {
                  const isStructured = p.attribute !== undefined;
                  const attrs = ATTRS_BY_TYPE[node.type] ?? [];
                  const spec = isStructured ? attrSpec(node.type, p.attribute!) : undefined;
                  const ops = spec ? opsForType(spec.type) : [];

                  // Re-generate fhirpath whenever any structured field
                  // changes. When the user picks a new attribute the
                  // operator and value need to be brought into agreement
                  // — otherwise switching from "Value (numeric)" (default
                  // "0") to "Status" (enum) leaves the value as "0" which
                  // isn't in the status options, and the dropdown shows
                  // blank. We coerce both whenever attribute changes.
                  const setStructured = (
                    patch: Partial<Pick<Predicate, 'attribute' | 'operator' | 'value'>>,
                  ) => {
                    const next = { ...p, ...patch };
                    if (patch.attribute !== undefined) {
                      // Use patch.attribute (TS narrows it to string here)
                      // rather than next.attribute, which the spread widens
                      // back to `string | undefined`.
                      const newSpec = attrSpec(node.type, patch.attribute);
                      const newOps = newSpec ? opsForType(newSpec.type) : [];
                      // Operator: keep if still valid, else jump to first.
                      if (newSpec && !newOps.includes(next.operator ?? '')) {
                        next.operator = newOps[0];
                      }
                      // Value: jump to first enum option if attribute is
                      // enum-like; reset to "0" for numeric; clear for
                      // free-text strings.
                      if (newSpec?.options) {
                        if (!newSpec.options.includes(next.value ?? '')) {
                          next.value = newSpec.options[0];
                        }
                      } else if (newSpec?.type === 'numeric') {
                        if (!/^-?\d/.test(next.value ?? '')) {
                          next.value = '0';
                        }
                      } else if (newSpec?.type === 'date') {
                        // Leave as-is; user fills in via datetime-local.
                      } else {
                        next.value = next.value ?? '';
                      }
                    }
                    const fp = generateFhirpath(
                      node,
                      next.attribute ?? '',
                      next.operator ?? '==',
                      next.value ?? '',
                    );
                    onUpdatePredicate(p.id, {
                      attribute: next.attribute,
                      operator: next.operator,
                      value:    next.value,
                      fhirpath: fp,
                    });
                  };

                  return (
                    <div key={p.id} className="pred">
                      <div className="pred-head">
                        <input
                          className="input pred-label"
                          placeholder="label (e.g. HbA1c ≥ 6.5)"
                          value={p.label}
                          onChange={(e) => onUpdatePredicate(p.id, { label: e.target.value })}
                        />
                        <button
                          className="btn icon ghost sm"
                          onClick={() => onDeletePredicate(p.id)}
                          title="Delete predicate"
                        >
                          ✕
                        </button>
                      </div>

                      {isStructured ? (
                        <>
                          <div className="pred-controls">
                            <select
                              className="select pred-ctl"
                              value={p.attribute}
                              onChange={(e) => setStructured({ attribute: e.target.value })}
                            >
                              {attrs.length === 0 && <option value="">(no attributes)</option>}
                              {attrs.map((a) => (
                                <option key={a.path} value={a.path}>{a.label}</option>
                              ))}
                            </select>
                            <select
                              className="select pred-ctl-op"
                              value={p.operator}
                              onChange={(e) => setStructured({ operator: e.target.value })}
                            >
                              {ops.map((o) => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                            {p.operator !== 'exists' && (
                              spec?.options ? (
                                <select
                                  className="select pred-ctl"
                                  value={p.value}
                                  onChange={(e) => setStructured({ value: e.target.value })}
                                >
                                  {spec.options.map((o) => (
                                    <option key={o} value={o}>{o}</option>
                                  ))}
                                </select>
                              ) : spec?.type === 'date' ? (
                                // Date attributes: relative-range preset
                                // dropdown ("last 7 days", "last 3 months",
                                // etc). Absolute datetime is rare in
                                // clinical predicates — when authors need
                                // it they switch the predicate to raw
                                // FHIRPath via the toggle below. Keeping
                                // the row to a single control reduces the
                                // perceived clutter on date predicates.
                                <select
                                  className="select pred-ctl"
                                  value={DATE_PRESETS.some((d) => d.value === p.value) ? p.value : 'now-365d'}
                                  onChange={(e) => setStructured({ value: e.target.value })}
                                >
                                  {DATE_PRESETS.filter((d) => d.value !== 'custom').map((d) => (
                                    <option key={d.value} value={d.value}>{d.label}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  className="input pred-ctl"
                                  type={spec?.type === 'numeric' ? 'number' : 'text'}
                                  step={spec?.type === 'numeric' ? 'any' : undefined}
                                  placeholder={spec?.type === 'numeric' ? '0.0' : 'value'}
                                  value={p.value}
                                  onChange={(e) => setStructured({ value: e.target.value })}
                                />
                              )
                            )}
                          </div>
                          {/* Generated FHIRPath is collapsed by default —
                              the structured triple above already says
                              what the predicate does in plain language.
                              Click the disclosure to inspect / verify
                              what gets emitted to the engine. */}
                          <details className="pred-fhirpath-details">
                            <summary>FHIRPath</summary>
                            <pre className="pred-fhirpath-preview">
                              {p.fhirpath || '(generating…)'}
                            </pre>
                          </details>
                          <button
                            className="btn ghost sm"
                            style={{ marginTop: 4 }}
                            onClick={() => onUpdatePredicate(p.id, {
                              attribute: undefined, operator: undefined, value: undefined,
                            })}
                            title="Switch to raw FHIRPath editing"
                          >
                            Edit raw
                          </button>
                        </>
                      ) : (
                        <>
                          <textarea
                            className="input mono pred-fhirpath"
                            placeholder="FHIRPath expression"
                            value={p.fhirpath}
                            onChange={(e) => onUpdatePredicate(p.id, { fhirpath: e.target.value })}
                            rows={3}
                          />
                          <button
                            className="btn ghost sm"
                            style={{ marginTop: 4 }}
                            onClick={() => onUpdatePredicate(p.id, {
                              attribute: 'valueQuantity.value', operator: '>=', value: '0',
                            })}
                            title="Switch to structured editing"
                          >
                            Use builder
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
                {/* Predicate template picker — single dropdown so the
                    panel doesn't get swamped by chips. Selecting a
                    template adds a predicate pre-filled with that
                    template's attribute/operator/value/fhirpath; the
                    user then tweaks it in the structured-triple editor
                    above. "Custom…" is the blank fallback. */}
                <div style={{ marginTop: 8 }}>
                  <select
                    className="select"
                    value=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      if (id === '__custom__') {
                        onAddPredicate(node.id);
                      } else {
                        const tpl = templatesFor(node.type).find((t) => t.id === id);
                        if (tpl) onAddPredicate(node.id, tpl.build(node.id));
                      }
                      e.target.value = '';
                    }}
                  >
                    <option value="">+ Add predicate…</option>
                    {templatesFor(node.type).map((t: PredicateTemplate) => (
                      <option key={t.id} value={t.id} title={t.description}>{t.label}</option>
                    ))}
                    <option value="__custom__">Custom…</option>
                  </select>
                </div>
              </div>
            )}

            <div className="field-grp">
              <label>Quick fields</label>
              {/* Skip value / unit in the Quick view — those are managed
                  via predicates in rule mode, and they're available in
                  the full Fields tab when patient-mode editing needs them.
                  Keeping Quick focused on identity (code, status, time)
                  reduces the perceived clutter. */}
              {/* Skip value/unit ONLY when they're template-variable
                  placeholders (rule mode pattern slots). Concrete literal
                  values like "7.2" / "%" are useful at-a-glance in patient
                  mode and stay in the Quick view. */}
              {Object.entries(node.fields || {})
                .filter(([k, v]) => {
                  if (k === 'value' || k === 'unit') {
                    return !v.startsWith('${');
                  }
                  return true;
                })
                .slice(0, 5)
                .map(([k, v]) => renderFieldRow(k, v))}
            </div>
          </>
        )}

        {tab === 'fields' && (
          <div className="field-grp">
            <label>All fields</label>
            {Object.entries(node.fields || {}).map(([k, v]) => renderFieldRow(k, v))}
            <button
              className="btn sm"
              style={{ marginTop: 6 }}
              onClick={() => {
                const k = prompt('Field name?');
                if (!k) return;
                setField(k, '');
              }}
            >
              + Add field
            </button>
          </div>
        )}

        {tab === 'refs' && (
          <>
            <div className="field-grp">
              <label>Outgoing ({outRefs.length})</label>
              {outRefs.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>No outgoing references</div>
              )}
              {outRefs.map((e, i) => {
                const t = allNodes.find((n) => n.id === e.to);
                if (!t) return null;
                const ti = TYPE_INFO[t.type] || { cls: 'cat-admin', short: '?', type: t.type, group: '' };
                return (
                  <div key={i} className="ref" onClick={() => onSelectNode(t.id)}>
                    <span className="lab">{e.label}</span>
                    <span className="arrow">→</span>
                    <div className={'nicon sm ' + ti.cls}>{ti.short}</div>
                    <span style={{ flex: 1 }}>{t.type}</span>
                    <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted-foreground)' }}>{t.id}</span>
                  </div>
                );
              })}
            </div>
            <div className="field-grp">
              <label>Incoming ({inRefs.length})</label>
              {inRefs.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>No incoming references</div>
              )}
              {inRefs.map((e, i) => {
                const f = allNodes.find((n) => n.id === e.from);
                if (!f) return null;
                const fi = TYPE_INFO[f.type] || { cls: 'cat-admin', short: '?', type: f.type, group: '' };
                return (
                  <div key={i} className="ref" onClick={() => onSelectNode(f.id)}>
                    <div className={'nicon sm ' + fi.cls}>{fi.short}</div>
                    <span style={{ flex: 1 }}>{f.type}</span>
                    <span className="arrow">→</span>
                    <span className="lab">{e.label}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === 'fsh' && (
          <pre className="code" dangerouslySetInnerHTML={{ __html: fshSyntaxHighlight(fshSnippet) }} />
        )}
      </div>

      <div className="detail-foot">
        <button
          className="btn sm"
          onClick={() => onDuplicateNode(node.id)}
          data-tip="Clone this resource (Ctrl+D / Cmd+D)"
        >
          Duplicate
        </button>
        <button
          className="btn danger sm"
          onClick={() => {
            onDeleteNode(node.id);
            onClose();
          }}
        >
          Delete
        </button>
        <span className="grow" style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>auto-saved</span>
      </div>
    </div>
  );
}
