import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import type { Decoration } from '@codemirror/view';
import { activeLines, buildDecorations } from './livePreview';

interface Found {
  from: number;
  to: number;
  text: string;
  kind: 'hide' | 'widget' | 'mark' | 'line';
  cls: string;
  widget: string;
}

function decorate(doc: string, cursor: number | null): Found[] {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(cursor ?? 0),
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const set = buildDecorations(state, cursor !== null);
  const out: Found[] = [];
  set.between(0, doc.length, (from, to, deco: Decoration) => {
    const spec = deco.spec as { class?: string; widget?: { constructor: { name: string } } };
    const isLine = from === to && !spec.widget && !!spec.class;
    out.push({
      from,
      to,
      text: doc.slice(from, to),
      kind: spec.widget ? 'widget' : isLine ? 'line' : spec.class ? 'mark' : 'hide',
      cls: spec.class ?? '',
      widget: spec.widget?.constructor.name ?? '',
    });
  });
  return out;
}

const hidden = (found: Found[]): string[] =>
  found.filter((f) => f.kind === 'hide').map((f) => f.text);

describe('live preview decorations', () => {
  const doc = [
    '## Plan',
    '**bold** and `code`',
    '- [x] totals',
    '- item',
    '[docs](https://x.io)',
  ].join('\n');

  it('hides Markdown syntax everywhere when the editor is not focused', () => {
    const found = decorate(doc, null);
    expect(hidden(found)).toEqual(['## ', '**', '**', '`', '`', '- ', '[', '](https://x.io)']);
    expect(found.some((f) => f.kind === 'line' && f.cls.includes('cm-md-h2'))).toBe(true);
    expect(found.some((f) => f.cls === 'cm-md-strong' && f.text === '**bold**')).toBe(true);
    expect(found.some((f) => f.cls === 'cm-md-link' && f.text === 'docs')).toBe(true);
    expect(found.some((f) => f.widget === 'CheckboxWidget' && f.text === '[x]')).toBe(true);
    expect(found.some((f) => f.cls === 'cm-md-task-done' && f.text === 'totals')).toBe(true);
    expect(found.some((f) => f.widget === 'BulletWidget' && f.text === '-')).toBe(true);
  });

  it('shows the raw Markdown on the line being edited only', () => {
    const onBold = doc.indexOf('bold');
    const found = decorate(doc, onBold);
    const h = hidden(found);
    expect(h).not.toContain('**');
    expect(h).not.toContain('`');
    expect(h).toContain('## '); // other lines stay rendered
    // the styling itself stays on the edited line
    expect(found.some((f) => f.cls === 'cm-md-strong')).toBe(true);
  });

  it('keeps the checkbox while editing the task text, shows [x] when editing the marker', () => {
    const line = doc.indexOf('- [x]');
    expect(
      decorate(doc, line + 'totals'.length + 6).some((f) => f.widget === 'CheckboxWidget'),
    ).toBe(true);
    expect(decorate(doc, line + 3).some((f) => f.widget === 'CheckboxWidget')).toBe(false);
  });

  it('active lines follow the selection and are empty without focus', () => {
    const state = EditorState.create({
      doc: 'a\nb\nc',
      selection: EditorSelection.single(0, 3),
    });
    expect([...activeLines(state, true)]).toEqual([1, 2]);
    expect(activeLines(state, false).size).toBe(0);
  });

  it('renders quotes, code blocks and rules', () => {
    const found = decorate('> quoted\n\n```\ncode\n```\n\n---\n', null);
    expect(found.some((f) => f.kind === 'line' && f.cls === 'cm-md-quote')).toBe(true);
    expect(hidden(found)).toContain('> ');
    expect(found.filter((f) => f.kind === 'line' && f.cls === 'cm-md-codeblock')).toHaveLength(3);
    expect(found.some((f) => f.widget === 'RuleWidget')).toBe(true);
  });
});
