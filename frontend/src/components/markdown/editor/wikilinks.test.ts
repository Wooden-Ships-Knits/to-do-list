import { CompletionContext } from '@codemirror/autocomplete';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import type { Decoration } from '@codemirror/view';
import type { NoteLinkKind } from '../../../api/types';
import { buildWikilinkDecorations, completionSourceForTests, wikilinkAt } from './wikilinks';
import type { WikilinkConfig } from './wikilinks';

const KINDS: Record<string, NoteLinkKind> = { 'payroll ideas': 'note', 'hr app': 'project' };
const config: WikilinkConfig = {
  kindOf: (t) => KINDS[t.toLowerCase()] ?? 'unresolved',
  open: () => undefined,
  suggest: async () => [],
};

function state(doc: string, cursor = 0): EditorState {
  const s = EditorState.create({
    doc,
    selection: EditorSelection.single(cursor),
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s;
}

interface Found {
  text: string;
  hidden: boolean;
  cls: string;
  target?: string;
}

function decorations(doc: string, focused: boolean, cursor = 0): Found[] {
  const s = state(doc, cursor);
  const out: Found[] = [];
  buildWikilinkDecorations(s, focused, config).between(0, doc.length, (from, to, d: Decoration) => {
    const spec = d.spec as { class?: string; attributes?: Record<string, string> };
    out.push({
      text: doc.slice(from, to),
      hidden: !spec.class,
      cls: spec.class ?? '',
      target: spec.attributes?.['data-wikilink'],
    });
  });
  return out;
}

describe('wikilink decorations', () => {
  const doc = 'See [[Payroll ideas]], [[HR App|the app]] and [[Nowhere]].\n`[[In code]]`';

  it('shows only the link text (or label) while the cursor is elsewhere', () => {
    const found = decorations(doc, false);
    expect(found.filter((f) => f.hidden).map((f) => f.text)).toEqual([
      '[[',
      ']]',
      '[[HR App|',
      ']]',
      '[[',
      ']]',
    ]);
    const links = found.filter((f) => !f.hidden);
    expect(links.map((f) => [f.text, f.target])).toEqual([
      ['Payroll ideas', 'Payroll ideas'],
      ['the app', 'HR App'],
      ['Nowhere', 'Nowhere'],
    ]);
    expect(links.map((f) => f.cls)).toEqual([
      'cm-md-wikilink cm-md-wikilink-note',
      'cm-md-wikilink cm-md-wikilink-project',
      'cm-md-wikilink cm-md-wikilink-unresolved',
    ]);
  });

  it('shows the raw text on the line being edited, without the click target', () => {
    const found = decorations(doc, true, 5);
    expect(found.some((f) => f.hidden)).toBe(false);
    expect(found.every((f) => f.target === undefined)).toBe(true);
    expect(found.map((f) => f.text)).toEqual(['Payroll ideas', 'HR App', 'Nowhere']);
  });

  it('ignores links inside code', () => {
    expect(decorations(doc, false).some((f) => f.text.includes('In code'))).toBe(false);
    expect(decorations('```\n[[Fenced]]\n```', false)).toEqual([]);
  });

  it('finds the link under a position (Mod+click on the line being edited)', () => {
    const s = state(doc);
    expect(wikilinkAt(s, doc.indexOf('Payroll') + 3)?.target).toBe('Payroll ideas');
    expect(wikilinkAt(s, 1)).toBeNull();
  });
});

describe('[[ suggestions', () => {
  it('offers notes, projects and subtasks, plus a new note for an unknown title', async () => {
    const suggest = vi.fn(async (q: string) =>
      [
        { kind: 'note' as const, label: 'Payroll ideas', insert: 'Payroll ideas', id: 'n' },
        { kind: 'task' as const, label: 'HR App > Fix', insert: 'HR App > Fix', id: 't' },
      ].filter((t) => t.label.toLowerCase().includes(q.toLowerCase())),
    );
    const source = completionSourceForTests({ current: { ...config, suggest } });
    const s = state('Link to [[pay', 13);
    const result = await source(new CompletionContext(s, 13, true));
    expect(suggest).toHaveBeenCalledWith('pay');
    expect(result?.from).toBe(10);
    expect(result?.options.map((o) => [o.label, o.detail])).toEqual([
      ['Payroll ideas', 'Note'],
      ['pay', 'New note'],
    ]);
    const none = await source(new CompletionContext(state('no link here', 5), 5, true));
    expect(none).toBeNull();
  });
});
