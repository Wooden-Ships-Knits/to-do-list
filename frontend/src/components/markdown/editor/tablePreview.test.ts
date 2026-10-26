import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTableDecorations, tableModel, tablePreview } from './tablePreview';

const TABLE = [
  '| Name | **Qty** | Link |',
  '| :--- | ---: | :-: |',
  '| a `x` | 2 | [docs](https://example.com) |',
  '| b \\| c | |',
].join('\n');
const DOC = `Intro\n\n${TABLE}\n\nAfter`;
const TABLE_FROM = DOC.indexOf('|');
const TABLE_TO = TABLE_FROM + TABLE.length;

function stateAt(doc: string, cursor = 0): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(cursor),
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

function tableNode(state: EditorState): SyntaxNode {
  let found: SyntaxNode | null = null;
  ensureSyntaxTree(state, state.doc.length, 5000)?.iterate({
    enter: (ref) => {
      if (ref.name === 'Table') found = ref.node;
    },
  });
  if (!found) throw new Error('no table');
  return found;
}

function replaced(state: EditorState, focused: boolean): [number, number][] {
  const out: [number, number][] = [];
  buildTableDecorations(state, focused).between(0, state.doc.length, (from, to) => {
    out.push([from, to]);
  });
  return out;
}

describe('table model', () => {
  it('reads header, alignment, inline formatting, escapes and empty cells', () => {
    const state = stateAt(DOC);
    const model = tableModel(state, tableNode(state));
    expect(model).toEqual({
      align: ['left', 'right', 'center'],
      header: [['Name'], [{ tag: 'strong', children: ['Qty'] }], ['Link']],
      rows: [
        [
          ['a ', { tag: 'code', children: ['x'] }],
          ['2'],
          [{ tag: 'a', href: 'https://example.com/', children: ['docs'] }],
        ],
        [['b | c'], [], []],
      ],
    });
  });

  it('pads short rows and works without outer pipes', () => {
    const state = stateAt('A | B\n--- | ---\nonly');
    const model = tableModel(state, tableNode(state));
    expect(model?.header).toEqual([['A'], ['B']]);
    expect(model?.rows).toEqual([[['only'], []]]);
    expect(model?.align).toEqual([null, null]);
  });

  it('drops unsafe link targets', () => {
    const state = stateAt('| x |\n| - |\n| [bad](javascript:alert(1)) |');
    const model = tableModel(state, tableNode(state));
    expect(model?.rows[0][0]).toEqual([{ tag: 'a', href: null, children: ['bad'] }]);
  });
});

describe('table decorations', () => {
  it('renders the whole table when the editor is not focused', () => {
    expect(replaced(stateAt(DOC, TABLE_FROM + 3), false)).toEqual([[TABLE_FROM, TABLE_TO]]);
  });

  it('renders the table while the cursor is on another line', () => {
    expect(replaced(stateAt(DOC, 2), true)).toEqual([[TABLE_FROM, TABLE_TO]]);
    expect(replaced(stateAt(DOC, DOC.length), true)).toEqual([[TABLE_FROM, TABLE_TO]]);
  });

  it('shows the raw Markdown while the cursor is on any line of the table', () => {
    expect(replaced(stateAt(DOC, TABLE_FROM), true)).toEqual([]);
    expect(replaced(stateAt(DOC, TABLE_TO), true)).toEqual([]);
    expect(replaced(stateAt(DOC, DOC.indexOf('b \\|')), true)).toEqual([]);
  });
});

describe('table preview in the editor', () => {
  let view: EditorView | null = null;
  afterEach(() => {
    view?.destroy();
    view = null;
  });

  it('draws an HTML table and switches to raw text on focus inside it', async () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: DOC,
        extensions: [markdown({ base: markdownLanguage }), tablePreview],
      }),
    });
    ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    view.dispatch({}); // let the state field see the finished parse
    const table = parent.querySelector('table.cm-md-table');
    expect(table).not.toBeNull();
    const headers = [...parent.querySelectorAll('th')].map((th) => th.textContent);
    expect(headers).toEqual(['Name', 'Qty', 'Link']);
    expect(parent.querySelector('th strong')?.textContent).toBe('Qty');
    expect((parent.querySelectorAll('th')[1] as HTMLElement).style.textAlign).toBe('right');
    expect(parent.querySelector('td a')?.getAttribute('href')).toBe('https://example.com/');
    expect(parent.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(parent.textContent).not.toContain('| :--- |');

    view.dispatch({ selection: { anchor: TABLE_FROM + 2 } });
    expect(parent.querySelector('table.cm-md-table')).not.toBeNull(); // not focused yet
    view.focus();
    await new Promise((resolve) => setTimeout(resolve, 50)); // focus is reported async
    expect(view.hasFocus).toBe(true);
    expect(parent.querySelector('table.cm-md-table')).toBeNull();
    expect(parent.textContent).toContain('| :--- | ---: | :-: |');

    view.dispatch({ selection: { anchor: DOC.length } }); // cursor leaves the table
    expect(parent.querySelector('table.cm-md-table')).not.toBeNull();
    parent.remove();
  });
});
