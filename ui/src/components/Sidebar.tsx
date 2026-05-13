// Sidebar — palette of FHIR resource types grouped by category.
//
// Each item is HTML-draggable; ondragstart sets the FHIR resource type
// in the dataTransfer payload (mime FHIR_TYPE_MIME). The canvas picks it
// up on drop and calls onAddNode with screen coords converted to world.
//
// Starts collapsed by default — most users don't need the palette open
// while exploring or running rules. A thin strip on the left edge with a
// chevron expands the full panel; clicking the X-style icon at the top
// of the expanded panel collapses it again.

import { useState } from 'react';
import { PALETTE_GROUPS, TYPE_INFO } from '../data/palette';
import { FHIR_TYPE_MIME, type PaletteGroup } from '../lib/types';

interface Props {
  search: string;
  onChangeSearch: (s: string) => void;
}

export function Sidebar({ search, onChangeSearch }: Props) {
  const [collapsed, setCollapsed] = useState(true);

  // Filter items by case-insensitive type-name match. Empty groups drop.
  const filtered: PaletteGroup[] = PALETTE_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => !search || it.type.toLowerCase().includes(search.toLowerCase())),
    }))
    .filter((g) => g.items.length > 0);

  if (collapsed) {
    return (
      <div className="sidebar collapsed">
        <button
          className="sidebar-toggle"
          onClick={() => setCollapsed(false)}
          title="Expand resource palette"
        >
          ›
        </button>
      </div>
    );
  }

  return (
    <div className="sidebar">
      <div className="sidebar-h">
        <h3>Resources</h3>
        <span className="grow" style={{ flex: 1 }} />
        <button
          className="btn icon ghost sm"
          onClick={() => setCollapsed(true)}
          title="Collapse"
        >
          ‹
        </button>
      </div>
      <div className="sidebar-search">
        <input
          className="input"
          placeholder="Search resource types…"
          value={search}
          onChange={(e) => onChangeSearch(e.target.value)}
        />
      </div>
      <div className="sidebar-list">
        {filtered.map((g) => (
          <div key={g.name} className="group">
            <div className="group-h">{g.name}</div>
            {g.items.map((it) => {
              const info = TYPE_INFO[it.type];
              return (
                <div
                  key={it.type}
                  className="item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(FHIR_TYPE_MIME, it.type);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  <div className={'nicon sm ' + info.cls}>{it.short}</div>
                  <span>{it.type}</span>
                  <span className="grip mono">⋮⋮</span>
                </div>
              );
            })}
          </div>
        ))}
        <div style={{ padding: 8, borderTop: '1px solid var(--border)', marginTop: 6 }}>
          <button className="btn sm" style={{ width: '100%' }} title="Stub — not wired in v1">
            <span style={{ fontSize: 13 }}>⤓</span> Pull from FHIR server…
          </button>
        </div>
      </div>
    </div>
  );
}
