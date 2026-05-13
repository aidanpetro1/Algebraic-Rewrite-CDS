// RuleLibrary — compact header strip above the rule canvas with a
// dropdown for the saved rule list:
//
//   [Save] [+ New]  [Active: <name> ▾]  [▶ Fire selected (N)]
//
// The dropdown opens a panel listing all saved rules — each as a row with
// a checkbox (toggle inclusion in batch fire), name (click to load,
// double-click to rename), description, and a × delete button. Filter
// input at the top of the dropdown narrows the list. Click outside to
// close.

import { useEffect, useRef, useState } from 'react';
import type { SavedRule } from '../lib/types';
import { validateRule } from '../lib/validateRule';

interface Props {
  rules: SavedRule[];
  activeRuleId: string | null;
  // editingRuleId: when set, that rule's name input opens inline. Used to
  // jump directly into rename after saving a brand-new rule. Cleared via
  // onEditingDone after the user commits.
  editingRuleId?: string | null;
  onEditingDone?: () => void;
  onLoadRule: (id: string) => void;
  onDeleteRule: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onSaveCurrent: () => void;
  onUpdateName: (id: string, name: string) => void;
  onNewRule: () => void;
}

export function RuleLibrary({
  rules, activeRuleId,
  editingRuleId, onEditingDone,
  onLoadRule, onDeleteRule, onToggleEnabled,
  onSaveCurrent, onUpdateName,
  onNewRule,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [open]);

  // External signal: when the parent sets editingRuleId, open the
  // dropdown and put that row into rename mode.
  useEffect(() => {
    if (editingRuleId) {
      setOpen(true);
      setEditingId(editingRuleId);
    }
  }, [editingRuleId]);
  const stopEditing = () => {
    setEditingId(null);
    onEditingDone?.();
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? rules.filter((r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
    : rules;
  const activeRule = activeRuleId ? rules.find((r) => r.id === activeRuleId) : null;

  return (
    <div className="rulelib-header">
      {/* Library dropdown — primary control. Shows the active rule name
          (or "unsaved rule" placeholder) plus a tiny count pill. */}
      <div ref={dropdownRef} style={{ position: 'relative', minWidth: 0 }}>
        <button
          className="btn sm rulelib-active-btn"
          onClick={() => setOpen((o) => !o)}
          data-tip={activeRule
            ? `Editing: ${activeRule.name}${activeRule.description ? '\n\n' + activeRule.description : ''}\n\nClick to browse and toggle saved rules.`
            : 'Browse and toggle saved rules'}
        >
          <span className="rulelib-active-label">
            {activeRule ? activeRule.name : 'unsaved rule'}
          </span>
          <span className="rulelib-count-pill">{rules.length}</span>
          <span className="rulelib-chev">▾</span>
        </button>
        {open && (
          <div className="dropdown-menu rulelib-menu">
            <input
              autoFocus={!editingId}
              className="input dropdown-search"
              placeholder="Filter rules…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
            />
            {rules.length === 0 && (
              <div className="dropdown-empty">No saved rules yet.<br/>Click Save to snapshot the editor.</div>
            )}
            {rules.length > 0 && filtered.length === 0 && (
              <div className="dropdown-empty">No matches.</div>
            )}
            {filtered.map((r) => {
              const isActive = r.id === activeRuleId;
              const isEditing = editingId === r.id;
              // Author-time validation — surface a small badge for
              // rules with structural issues so the author sees them
              // before fire time. Hover the badge for the full list.
              const issues = validateRule(r);
              const errCount  = issues.filter((i) => i.severity === 'error').length;
              const warnCount = issues.filter((i) => i.severity === 'warning').length;
              const issueTitle = issues.map((i) => `[${i.severity}] ${i.message}`).join('\n');
              return (
                <div
                  key={r.id}
                  className={'rulelib-row' + (isActive ? ' active' : '')}
                >
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => onToggleEnabled(r.id, e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                    title="Include in batch fire"
                  />
                  <div className="rulelib-row-body">
                    {isEditing ? (
                      <input
                        className="input rulelib-row-input"
                        autoFocus
                        value={r.name}
                        onChange={(e) => onUpdateName(r.id, e.target.value)}
                        onBlur={stopEditing}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') stopEditing(); }}
                      />
                    ) : (
                      // Click anywhere on name OR description to load the
                      // rule. Double-click on the name still triggers
                      // inline rename (description is plain click-to-load).
                      <>
                        <div
                          className="rulelib-row-name"
                          onClick={() => { onLoadRule(r.id); setOpen(false); }}
                          onDoubleClick={(e) => { e.stopPropagation(); setEditingId(r.id); }}
                          title={`${r.name || '(untitled)'}\n\nClick to load • double-click to rename`}
                        >
                          {r.name || '(untitled)'}
                          {(errCount + warnCount) > 0 && (
                            <span
                              className={`rulelib-issue-badge ${errCount > 0 ? 'error' : 'warning'}`}
                              title={issueTitle}
                            >
                              {errCount > 0 ? `${errCount}!` : `${warnCount}⚠`}
                            </span>
                          )}
                        </div>
                        {r.description && (
                          <div
                            className="rulelib-row-desc"
                            onClick={() => { onLoadRule(r.id); setOpen(false); }}
                            title={`${r.description}\n\nClick to load`}
                          >
                            {r.description}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {!isEditing && (
                    <button
                      className="rulelib-row-edit"
                      onClick={(e) => { e.stopPropagation(); setEditingId(r.id); }}
                      title="Rename"
                    >
                      ✎
                    </button>
                  )}
                  <button
                    className="rulelib-row-del"
                    onClick={(e) => { e.stopPropagation(); onDeleteRule(r.id); }}
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <span className="rulelib-sep" />

      {/* Editor actions — secondary, smaller. Save snapshots the current
          rule; Clear empties the editor for a fresh start. */}
      <button className="btn sm" onClick={onSaveCurrent} data-tip="Save the current rule editor as a new entry, or update the active rule in place">
        Save
      </button>
      <button className="btn sm ghost" onClick={onNewRule} data-tip="Start a new rule — empties the editor (saved rules are unaffected)">
        + New
      </button>

      <span className="grow" style={{ flex: 1 }} />

      {/* Run lives in the topbar and fires every rule whose checkbox
          (next to its name in the dropdown) is ticked, in dropdown
          order, each fire's output feeding the next. The library header
          itself stays minimal: dropdown + Save + New. (Combine was
          removed for now; restore by re-wiring the prop on App.tsx and
          re-adding a button here.) */}
    </div>
  );
}
