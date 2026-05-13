// FHIR Shorthand (FSH) generator + syntax highlighter.
//
// generateFSH walks the graph and emits one Instance block per node, with
// its scalar fields and outgoing references. Output is the canonical text
// rendered in the FSH panel (split + fsh views) and the FSH tab of the
// detail panel.
//
// fshSyntaxHighlight tokenizes each line into (text, class) parts BEFORE
// HTML-escaping, then assembles the result. See the README — chaining
// `.replace()` calls with HTML strings as replacements lets the regex
// match into emitted spans and corrupts the output. This implementation
// avoids that.

import type { Node, Edge } from './types';

export function generateFSH(nodes: Node[], edges: Edge[]): string {
  const lines: string[] = [];
  for (const n of nodes) {
    lines.push(`Instance: ${n.id}`);
    lines.push(`InstanceOf: ${n.type}`);
    lines.push('Usage: #example');
    for (const [k, v] of Object.entries(n.fields ?? {})) {
      lines.push(`* ${k} = "${v}"`);
    }
    for (const e of edges) {
      if (e.from !== n.id) continue;
      const target = nodes.find((t) => t.id === e.to);
      if (target) lines.push(`* ${e.label} = Reference(${target.type}/${target.id})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

type TokenClass = 'k' | 's' | 'r' | 'c';
interface Token { text: string; cls?: TokenClass; }

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function fshSyntaxHighlight(text: string, highlightId?: string | null): string {
  return text
    .split('\n')
    .map((line) => {
      const parts: Token[] = [];
      let rest = line;

      // Leading keyword: "Instance:", "InstanceOf:", "Usage:" or "* fieldName"
      let m: RegExpMatchArray | null;
      if ((m = rest.match(/^(Instance|InstanceOf|Usage):/))) {
        parts.push({ text: m[1], cls: 'k' });
        parts.push({ text: ':' });
        rest = rest.slice(m[0].length);
      } else if ((m = rest.match(/^(\* \w+)/))) {
        parts.push({ text: m[1], cls: 'k' });
        rest = rest.slice(m[0].length);
      }

      // Walk the remaining text, alternating between strings and Reference(...)
      while (rest.length) {
        const sIdx = rest.search(/"[^"]*"/);
        const rIdx = rest.search(/Reference\([^)]+\)/);
        let nextIdx = -1;
        let kind: TokenClass | null = null;
        let mm: RegExpMatchArray | null = null;

        if (sIdx !== -1 && (rIdx === -1 || sIdx < rIdx)) {
          nextIdx = sIdx;
          kind = 's';
          mm = rest.match(/"[^"]*"/);
        } else if (rIdx !== -1) {
          nextIdx = rIdx;
          kind = 'r';
          mm = rest.match(/Reference\([^)]+\)/);
        }

        if (nextIdx === -1 || !mm) {
          parts.push({ text: rest });
          break;
        }
        if (nextIdx > 0) parts.push({ text: rest.slice(0, nextIdx) });
        parts.push({ text: mm[0], cls: kind ?? undefined });
        rest = rest.slice(nextIdx + mm[0].length);
      }

      let html = parts
        .map((p) => (p.cls ? `<span class="${p.cls}">${escapeHtml(p.text)}</span>` : escapeHtml(p.text)))
        .join('');

      if (highlightId && line.includes(highlightId)) {
        html = `<span class="hl">${html}</span>`;
      }
      return html;
    })
    .join('\n');
}
