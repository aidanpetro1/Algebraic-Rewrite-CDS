// RuleInfoBar — sits below the rulelib header in single Rule mode and
// shows the full active rule name + description with inline editing.
// The description text is the editable bit (double-click to enter edit
// mode); the name is shown as a label since renaming is already covered
// by double-clicking a rule in the library dropdown.
//
// Hidden when there's no active rule (an unsaved-rule editor session).
// Skipped in Compare mode since the compare pane labels already mark the
// rule canvas, and horizontal space is at a premium there.

import { useEffect, useRef, useState } from 'react';
import type { SavedRule } from '../lib/types';

interface Props {
  rule: SavedRule | null;
  onUpdateName: (id: string, name: string) => void;
  onUpdateDescription: (id: string, description: string) => void;
}

export function RuleInfoBar({ rule, onUpdateName, onUpdateDescription }: Props) {
  const [editingDesc, setEditingDesc] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingDesc) {
      setDescDraft(rule?.description ?? '');
      setTimeout(() => { descRef.current?.focus(); descRef.current?.select(); }, 0);
    }
  }, [editingDesc, rule?.description]);

  useEffect(() => {
    if (editingName) {
      setNameDraft(rule?.name ?? '');
      setTimeout(() => { nameRef.current?.focus(); nameRef.current?.select(); }, 0);
    }
  }, [editingName, rule?.name]);

  if (!rule) return null;

  const commitName = () => {
    if (rule && nameDraft.trim()) onUpdateName(rule.id, nameDraft.trim());
    setEditingName(false);
  };
  const commitDesc = () => {
    if (rule) onUpdateDescription(rule.id, descDraft.trim());
    setEditingDesc(false);
  };

  return (
    <div className="rule-info-bar">
      {editingName ? (
        <input
          ref={nameRef}
          className="input rule-info-name-input"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName();
            if (e.key === 'Escape') setEditingName(false);
          }}
        />
      ) : (
        <div
          className="rule-info-name"
          onClick={() => setEditingName(true)}
          data-tip={`${rule.name}\n\nClick to rename`}
        >
          {rule.name}
        </div>
      )}
      <div className="rule-info-sep" />
      {editingDesc ? (
        <textarea
          ref={descRef}
          className="input rule-info-edit"
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          onBlur={commitDesc}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditingDesc(false);
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitDesc();
          }}
          placeholder="Describe what this rule does…"
          rows={2}
        />
      ) : (
        <div
          className={'rule-info-desc ' + (rule.description ? '' : 'placeholder')}
          onClick={() => setEditingDesc(true)}
          data-tip="Click to edit description"
        >
          {rule.description || 'Click to add a description…'}
        </div>
      )}
    </div>
  );
}
