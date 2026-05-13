// Topbar — consolidated layout.
//
//   [logo + title] [unsaved] ......... [mode toggle] ......... [Templates] [Run] [File ▾] [View ▾] [avatar]
//
// File and View are dropdown menus to keep the bar legible. Mode toggle
// (Patient / Rule / Compare) is centered because it's the primary
// navigation. Templates and Run only show in Rule/Compare modes.

import { useEffect, useRef, useState } from 'react';
import { RULE_TEMPLATES } from '../data/ruleTemplates';
import type { AuthoringMode } from '../lib/types';

type View = 'graph' | 'split' | 'fsh';

interface Props {
  view: View;
  onChangeView: (v: View) => void;
  mode: AuthoringMode;
  onChangeMode: (m: AuthoringMode) => void;
  onImportBundle: (text: string, filename: string) => void;
  onExportBundle: () => void;
  onSave: () => void;
  // Optional reset hooks — exposed in the File menu when wired. Both
  // prompt for confirmation before nuking state.
  onResetPatient?: () => void;
  onResetLibrary?: () => void;
  onRun: () => void;
  // Sequential firing — fires the next checked rule one at a time, or
  // (via the dropdown) any specific rule from the enabled set.
  onStep?: (index?: number) => void;
  // 0-based pointer into the enabled-rules sequence — used to label
  // the Step button as "Step 2/4" so the author sees how far they are.
  stepIndex?: number;
  // Names of every checked rule, in dropdown order — surfaced inside
  // the Step button's dropdown menu so the author can see (and pick
  // from) the queue.
  stepQueue?: string[];
  onLoadTemplate: (id: string) => void;
  onOpenTutorial: (flavor: 'math' | 'informatics') => void;
  // True while a fire request is in flight; disables Run and shows a
  // spinner so the user sees the engine is working.
  firing?: boolean;
}

// Reusable click-outside hook for menus that close on outside-click.
function useOutsideClose(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [open, close, ref]);
}

export function Topbar({
  view, onChangeView, mode, onChangeMode,
  onImportBundle, onExportBundle, onSave, onResetPatient, onResetLibrary,
  onRun, onStep,
  stepIndex = 0, stepQueue = [],
  onLoadTemplate,
  onOpenTutorial,
  firing = false,
}: Props) {
  const stepTotal = stepQueue.length;
  // Step queue dropdown state — anchors the queue list off the Step button.
  const [stepOpen, setStepOpen] = useState(false);
  const stepRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(stepOpen, () => setStepOpen(false), stepRef);
  // Tutorial dropdown state.
  const [tutOpen, setTutOpen] = useState(false);
  const tutRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(tutOpen, () => setTutOpen(false), tutRef);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // ---- Templates menu ----
  const [tplOpen, setTplOpen] = useState(false);
  const [tplSearch, setTplSearch] = useState('');
  const tplRef = useRef<HTMLDivElement | null>(null);
  const tplInputRef = useRef<HTMLInputElement | null>(null);
  useOutsideClose(tplOpen, () => setTplOpen(false), tplRef);
  useEffect(() => {
    if (tplOpen) {
      setTplSearch('');
      setTimeout(() => tplInputRef.current?.focus(), 0);
    }
  }, [tplOpen]);
  const filteredTemplates = RULE_TEMPLATES.filter((t) => {
    if (!tplSearch) return true;
    const q = tplSearch.toLowerCase();
    return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
  });

  // ---- File menu (Import / Export / Save) ----
  const [fileOpen, setFileOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(fileOpen, () => setFileOpen(false), fileMenuRef);

  // ---- View menu (Graph / Split / FSH) ----
  const [viewOpen, setViewOpen] = useState(false);
  const viewRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(viewOpen, () => setViewOpen(false), viewRef);
  const viewLabel = view === 'graph' ? 'Graph' : view === 'split' ? 'Split' : 'FSH';

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    onImportBundle(text, f.name);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="topbar">
      {/* Brand cluster — title + unsaved indicator. Logo placeholder
          removed; title carries the brand on its own for now. */}
      <div className="title">FHIR Graph Builder</div>
      <span className="badge unsaved dot" style={{ marginLeft: 6 }}>Unsaved</span>

      {/* Tutorial dropdown — two flavors, theory-first or
          practitioner-first. Discoverable in the brand area so new users
          notice it before they get into the editor. */}
      <div ref={tutRef} style={{ position: 'relative', marginLeft: 12 }}>
        <button
          className="btn sm ghost"
          onClick={() => setTutOpen((o) => !o)}
          data-tip="Read about how this system works"
          data-tip-pos="below"
        >
          Tutorial
        </button>
        {tutOpen && (
          <div className="dropdown-menu" style={{ minWidth: 280, left: 0, right: 'auto' }}>
            <button
              className="dropdown-item"
              onClick={() => { onOpenTutorial('informatics'); setTutOpen(false); }}
            >
              <div className="dropdown-item-name">If you don't like math</div>
              <div className="dropdown-item-desc">
                Practitioner-friendly walkthrough. What rules are, how they fire,
                why the system is built this way.
              </div>
            </button>
            <button
              className="dropdown-item"
              onClick={() => { onOpenTutorial('math'); setTutOpen(false); }}
            >
              <div className="dropdown-item-name">If you like math</div>
              <div className="dropdown-item-desc">
                Categorical foundations: ACSets, DPO rewriting, application
                conditions, and how the FHIR boundary is encoded.
              </div>
            </button>
          </div>
        )}
      </div>

      <div className="grow" />

      {/* Centered primary navigation: which document am I editing? */}
      <div className="seg" title="Authoring mode">
        <button className={mode === 'patient' ? 'on' : ''} onClick={() => onChangeMode('patient')}>Patient</button>
        <button className={mode === 'rule'    ? 'on' : ''} onClick={() => onChangeMode('rule')}   >Rule</button>
        <button className={mode === 'compare' ? 'on' : ''} onClick={() => onChangeMode('compare')}>Compare</button>
      </div>

      <div className="grow" />

      {/* Right cluster: rule actions, file ops, view, avatar */}
      {(mode === 'rule' || mode === 'compare') && (
        <>
          <div ref={tplRef} style={{ position: 'relative' }}>
            <button className="btn sm" onClick={() => setTplOpen((o) => !o)} title="Load a pre-built rule template">
              Templates
            </button>
            {tplOpen && (
              <div className="dropdown-menu">
                <input
                  ref={tplInputRef}
                  className="input dropdown-search"
                  placeholder="Search templates…"
                  value={tplSearch}
                  onChange={(e) => setTplSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setTplOpen(false);
                    if (e.key === 'Enter' && filteredTemplates.length > 0) {
                      onLoadTemplate(filteredTemplates[0].id);
                      setTplOpen(false);
                    }
                  }}
                />
                {filteredTemplates.length === 0 && (
                  <div className="dropdown-empty">No templates match.</div>
                )}
                {filteredTemplates.map((t) => (
                  <button
                    key={t.id}
                    className="dropdown-item"
                    onClick={() => { onLoadTemplate(t.id); setTplOpen(false); }}
                  >
                    <div className="dropdown-item-name">{t.name}</div>
                    <div className="dropdown-item-desc">{t.description}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Unified Run + Step menu — one button, one dropdown. The
              menu's first item runs all checked rules; the second steps
              forward one; the rest let the user fire any specific rule
              from the queue. Replaces the previous two-button split. */}
          <div ref={stepRef} style={{ position: 'relative' }}>
            <button
              className="btn primary sm"
              onClick={() => stepTotal > 0 ? setStepOpen((o) => !o) : onRun()}
              disabled={firing}
              data-tip={firing
                ? 'Engine is working…'
                : stepTotal > 0
                  ? `Fire rules — Run all, Step next, or pick one (${stepTotal} checked)`
                  : 'Tick rules in the library to enable firing'}
              data-tip-pos="below"
            >
              {firing ? (
                <>
                  <span className="spinner" /> Firing…
                </>
              ) : (
                <>
                  <span style={{ fontSize: 13 }}>▶</span> Run {stepTotal > 0 && '▾'}
                </>
              )}
            </button>
            {stepOpen && stepTotal > 0 && (
              <div className="dropdown-menu" style={{ minWidth: 280 }}>
                <button
                  className="dropdown-item"
                  onClick={() => { setStepOpen(false); onRun(); }}
                >
                  <div className="dropdown-item-name">▶▶ Run all</div>
                  <div className="dropdown-item-desc">
                    Fire every checked rule in sequence — each fire's output feeds the next.
                  </div>
                </button>
                {onStep && (
                  <button
                    className="dropdown-item step-current"
                    onClick={() => { setStepOpen(false); onStep(); }}
                  >
                    <div className="dropdown-item-name">
                      ▶ Step next: {stepQueue[stepIndex % stepTotal]}
                    </div>
                    <div className="dropdown-item-desc">
                      Fire just this rule, then advance the pointer ({(stepIndex % stepTotal) + 1}/{stepTotal}).
                    </div>
                  </button>
                )}
                <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                <div style={{ padding: '4px 10px', fontSize: 11, color: 'var(--muted-foreground)' }}>
                  Or fire one specifically:
                </div>
                {onStep && stepQueue.map((name, i) => {
                  const cur = stepIndex % stepTotal;
                  const status = i === cur ? 'next' : i < cur ? 'fired' : 'queued';
                  return (
                    <button
                      key={`${name}-${i}`}
                      className="dropdown-item"
                      onClick={() => { setStepOpen(false); onStep(i); }}
                    >
                      <div className="dropdown-item-name">{name}</div>
                      <div className="dropdown-item-desc">{status}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* File menu — Import / Export / Save bundled together */}
      <div ref={fileMenuRef} style={{ position: 'relative' }}>
        <button className="btn sm" onClick={() => setFileOpen((o) => !o)} title="Import / Export / Save">
          File
        </button>
        {fileOpen && (
          <div className="dropdown-menu" style={{ minWidth: 180 }}>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={onFile}
            />
            <button
              className="dropdown-item"
              onClick={() => { fileRef.current?.click(); setFileOpen(false); }}
            >
              <div className="dropdown-item-name">Import bundle…</div>
              <div className="dropdown-item-desc">Load a FHIR Bundle JSON file</div>
            </button>
            <button
              className="dropdown-item"
              onClick={() => { onExportBundle(); setFileOpen(false); }}
            >
              <div className="dropdown-item-name">Export bundle</div>
              <div className="dropdown-item-desc">Download the current document as a Bundle</div>
            </button>
            <button
              className="dropdown-item"
              onClick={() => { onSave(); setFileOpen(false); }}
            >
              <div className="dropdown-item-name">Save</div>
              <div className="dropdown-item-desc">Persist the current workspace</div>
            </button>
            {onResetPatient && (
              <button
                className="dropdown-item"
                onClick={() => { onResetPatient(); setFileOpen(false); }}
              >
                <div className="dropdown-item-name">Reset patient chart</div>
                <div className="dropdown-item-desc">Restore the seeded scenario; rules unaffected</div>
              </button>
            )}
            {onResetLibrary && (
              <button
                className="dropdown-item"
                onClick={() => { onResetLibrary(); setFileOpen(false); }}
              >
                <div className="dropdown-item-name">Reset rule library</div>
                <div className="dropdown-item-desc">Restore the bundled sample rules; reloads the page</div>
              </button>
            )}
          </div>
        )}
      </div>

      {/* View menu — collapses Graph/Split/FSH into a compact dropdown */}
      <div ref={viewRef} style={{ position: 'relative' }}>
        <button className="btn sm" onClick={() => setViewOpen((o) => !o)} title="View mode">
          View: {viewLabel}
        </button>
        {viewOpen && (
          <div className="dropdown-menu" style={{ minWidth: 160 }}>
            {(['graph', 'split', 'fsh'] as const).map((v) => (
              <button
                key={v}
                className={'dropdown-item' + (view === v ? ' on' : '')}
                onClick={() => { onChangeView(v); setViewOpen(false); }}
              >
                <div className="dropdown-item-name">
                  {v === 'graph' ? 'Graph' : v === 'split' ? 'Graph + FSH' : 'FSH'}
                </div>
                <div className="dropdown-item-desc">
                  {v === 'graph' ? 'Canvas only' :
                   v === 'split' ? 'Canvas with FSH source on the right' :
                   'FHIR Shorthand source only'}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Avatar placeholder removed; reinstate when there's actual auth /
          per-user identity to display. */}
    </div>
  );
}
