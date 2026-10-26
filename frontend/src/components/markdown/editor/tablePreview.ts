import { syntaxTree } from '@codemirror/language';
import { StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { safeUrl } from '../safeUrl';
import { activeLines, touches } from './livePreview';

/*
 * GFM tables in live preview: a table renders as a real table while the cursor is elsewhere,
 * and shows its raw "| a | b |" lines as soon as the cursor or selection enters one of them.
 * A table spans several lines, and only a state field may replace line breaks, so this lives
 * next to (not inside) the line-based live-preview plugin.
 */

export type Align = 'left' | 'center' | 'right' | null;
export type Inline =
  | string
  | { tag: 'strong' | 'em' | 'del' | 'code'; children: Inline[] }
  | { tag: 'a'; href: string | null; children: Inline[] };

export interface TableModel {
  align: Align[];
  header: Inline[][];
  rows: Inline[][][];
}

const TAGS: Record<string, 'strong' | 'em' | 'del' | 'code'> = {
  StrongEmphasis: 'strong',
  Emphasis: 'em',
  Strikethrough: 'del',
  InlineCode: 'code',
};
const MARK_NODES = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark', 'URL']);

/** Inline content of `node` between `from` and `to`, with Markdown syntax removed. */
function inlines(state: EditorState, node: SyntaxNode, from: number, to: number): Inline[] {
  const out: Inline[] = [];
  let pos = from;
  const text = (end: number): void => {
    if (end > pos) out.push(state.sliceDoc(pos, end));
  };
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue;
    text(child.from);
    const name = child.name;
    if (name in TAGS) {
      out.push({ tag: TAGS[name], children: inlines(state, child, child.from, child.to) });
    } else if (name === 'Link') {
      const marks = child.getChildren('LinkMark');
      const url = child.getChild('URL');
      const href = url ? safeUrl(state.sliceDoc(url.from, url.to)) : null;
      const inner =
        marks.length >= 2
          ? inlines(state, child, marks[0].to, marks[1].from)
          : [state.sliceDoc(child.from, child.to)];
      out.push({ tag: 'a', href, children: inner });
    } else if (name === 'Autolink' || name === 'URL') {
      const url = name === 'URL' ? child : child.getChild('URL');
      const raw = url ? state.sliceDoc(url.from, url.to) : '';
      out.push({ tag: 'a', href: safeUrl(raw), children: [raw] });
    } else if (name === 'Escape') {
      out.push(state.sliceDoc(child.from + 1, child.to));
    } else if (!MARK_NODES.has(name)) {
      out.push(state.sliceDoc(child.from, child.to));
    }
    pos = child.to;
  }
  text(to);
  // Join neighbouring text pieces ("b ", "|", " c" around an escape).
  return out.reduce<Inline[]>((joined, item) => {
    const last = joined[joined.length - 1];
    if (typeof item === 'string' && typeof last === 'string')
      joined[joined.length - 1] = last + item;
    else joined.push(item);
    return joined;
  }, []);
}

/** Cells of a header or body row. Empty cells have no node, so the row is split at its "|"
 * delimiters and each piece takes the cell node inside it (if any). */
function rowCells(state: EditorState, row: SyntaxNode): Inline[][] {
  const delimiters = row.getChildren('TableDelimiter');
  const bounds: [number, number][] = [];
  let start = row.from;
  for (const d of delimiters) {
    bounds.push([start, d.from]);
    start = d.to;
  }
  bounds.push([start, row.to]);
  const text = state.sliceDoc(row.from, row.to);
  if (text.trimStart().startsWith('|')) bounds.shift();
  if (text.trimEnd().endsWith('|') && delimiters.length > 0) bounds.pop();
  const cells = row.getChildren('TableCell');
  return bounds.map(([from, to]) => {
    const cell = cells.find((c) => c.from >= from && c.to <= to);
    return cell ? inlines(state, cell, cell.from, cell.to) : [];
  });
}

function alignments(delimiterRow: string): Align[] {
  return delimiterRow
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((part) => {
      const p = part.trim();
      const left = p.startsWith(':');
      const right = p.endsWith(':');
      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return null;
    });
}

export function tableModel(state: EditorState, table: SyntaxNode): TableModel | null {
  const header = table.getChild('TableHeader');
  if (!header) return null;
  const head = rowCells(state, header);
  const delimiter = table.getChildren('TableDelimiter').find((d) => d.from > header.to);
  const columns = head.length;
  const fit = (cells: Inline[][]): Inline[][] =>
    Array.from({ length: columns }, (_, i) => cells[i] ?? []);
  const align = delimiter ? alignments(state.sliceDoc(delimiter.from, delimiter.to)) : [];
  return {
    align: Array.from({ length: columns }, (_, i) => align[i] ?? null),
    header: head,
    rows: table.getChildren('TableRow').map((row) => fit(rowCells(state, row))),
  };
}

function appendInlines(parent: HTMLElement, items: Inline[]): void {
  for (const item of items) {
    if (typeof item === 'string') {
      parent.append(document.createTextNode(item));
    } else if (item.tag === 'a') {
      const link = document.createElement(item.href ? 'a' : 'span');
      link.className = 'cm-md-link';
      if (item.href && link instanceof HTMLAnchorElement) {
        link.href = item.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.tabIndex = -1;
        // Same as in the text: Mod+click opens, a plain click starts editing the table.
        link.addEventListener('click', (event) => {
          if (!(event.metaKey || event.ctrlKey)) event.preventDefault();
        });
      }
      appendInlines(link, item.children);
      parent.append(link);
    } else {
      const el = document.createElement(item.tag);
      appendInlines(el, item.children);
      parent.append(el);
    }
  }
}

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly model: TableModel,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.source === this.source;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-md-table-wrap';
    const table = document.createElement('table');
    table.className = 'cm-md-table';
    const cell = (tag: 'th' | 'td', content: Inline[], i: number): HTMLElement => {
      const el = document.createElement(tag);
      const align = this.model.align[i];
      if (align) el.style.textAlign = align;
      appendInlines(el, content);
      return el;
    };
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    this.model.header.forEach((content, i) => headRow.append(cell('th', content, i)));
    thead.append(headRow);
    table.append(thead);
    if (this.model.rows.length > 0) {
      const tbody = document.createElement('tbody');
      for (const row of this.model.rows) {
        const tr = document.createElement('tr');
        row.forEach((content, i) => tr.append(cell('td', content, i)));
        tbody.append(tr);
      }
      table.append(tbody);
    }
    wrap.append(table);
    return wrap;
  }

  /** Let the editor handle clicks: the cursor moves into the table, which then shows raw. */
  ignoreEvent(): boolean {
    return false;
  }
}

export function buildTableDecorations(state: EditorState, focused: boolean): DecorationSet {
  const active = activeLines(state, focused);
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== 'Table') return;
      const node = ref.node;
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      if (!touches(state, active, from, to)) {
        const model = tableModel(state, node);
        if (model) {
          out.push(
            Decoration.replace({
              widget: new TableWidget(state.sliceDoc(from, to), model),
              block: true,
            }).range(from, to),
          );
        }
      }
      return false;
    },
  });
  return Decoration.set(out, true);
}

const setFocused = StateEffect.define<boolean>();

const focused = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setFocused)) return effect.value;
    return value;
  },
});

const tables = StateField.define<DecorationSet>({
  create: (state) => buildTableDecorations(state, state.field(focused)),
  update(value, tr) {
    const focusChanged = tr.effects.some((e) => e.is(setFocused));
    if (
      tr.docChanged ||
      tr.selection ||
      focusChanged ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state)
    ) {
      return buildTableDecorations(tr.state, tr.state.field(focused));
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const tablePreview: Extension = [
  focused,
  EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
  tables,
];
