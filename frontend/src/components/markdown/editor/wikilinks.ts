import { autocompletion } from '@codemirror/autocomplete';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { StateEffect } from '@codemirror/state';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { LinkTarget, NoteLinkKind } from '../../../api/types';
import { matchWikilinks, openLinkQuery, targetKey } from '../../../lib/wikilinks';
import type { WikilinkMatch } from '../../../lib/wikilinks';
import { activeLines, touches } from './livePreview';

/*
 * Obsidian-style [[links]] for the notes editor. While the cursor is elsewhere a link shows
 * only its text (or label) as a link, and a click opens it; on the line being edited the raw
 * "[[Target|label]]" is shown. Typing "[[" suggests notes, projects and subtasks.
 */

export interface WikilinkConfig {
  /** What a target points to (from the server's resolution of the saved note). */
  kindOf: (target: string) => NoteLinkKind;
  open: (target: string) => void;
  /** Suggestions for the text typed after "[[". */
  suggest: (query: string) => Promise<LinkTarget[]>;
}

/** The config lives in a ref (it changes with the note); this effect redraws the links. */
export const wikilinksChanged = StateEffect.define<null>();

const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'HTMLBlock']);

function inCode(state: EditorState, pos: number): boolean {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    node;
    node = node.parent
  ) {
    if (CODE.has(node.name)) return true;
  }
  return false;
}

/** Links in the given ranges, skipping the ones inside code. */
function linksIn(state: EditorState, from: number, to: number): WikilinkMatch[] {
  const out: WikilinkMatch[] = [];
  for (let pos = from; pos <= to;) {
    const line = state.doc.lineAt(pos);
    for (const m of matchWikilinks(line.text, line.from)) {
      if (!inCode(state, m.from)) out.push(m);
    }
    pos = line.to + 1;
  }
  return out;
}

export function wikilinkAt(state: EditorState, pos: number): WikilinkMatch | null {
  const line = state.doc.lineAt(pos);
  return linksIn(state, line.from, line.to).find((m) => m.from <= pos && pos <= m.to) ?? null;
}

const hide = Decoration.replace({});

export function buildWikilinkDecorations(
  state: EditorState,
  focused: boolean,
  config: WikilinkConfig,
  ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }],
): DecorationSet {
  const active = activeLines(state, focused);
  const out: Range<Decoration>[] = [];
  for (const { from, to } of ranges) {
    for (const m of linksIn(state, from, to)) {
      const kind = config.kindOf(m.target);
      const cls = `cm-md-wikilink cm-md-wikilink-${kind}`;
      if (touches(state, active, m.from, m.to)) {
        // editing this line: the raw text, with the target coloured as a hint
        out.push(Decoration.mark({ class: cls }).range(m.targetFrom, m.targetTo));
        continue;
      }
      const textFrom = m.labelFrom ?? m.targetFrom;
      const textTo = m.to - 2;
      out.push(hide.range(m.from, textFrom));
      if (textTo > textFrom) {
        out.push(
          Decoration.mark({
            class: cls,
            attributes: {
              'data-wikilink': m.target,
              'data-kind': kind,
              title: kind === 'unresolved' ? `Create note "${m.target}"` : `Open ${m.target}`,
            },
          }).range(textFrom, textTo),
        );
      }
      out.push(hide.range(textTo, m.to));
    }
  }
  return Decoration.set(out, true);
}

function completionSource(config: { current: WikilinkConfig }) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const line = context.state.doc.lineAt(context.pos);
    const query = openLinkQuery(line.text.slice(0, context.pos - line.from));
    if (query === null || inCode(context.state, context.pos)) return null;
    const from = context.pos - query.length;
    const after = context.state.sliceDoc(context.pos, context.pos + 2);
    const closeTo = after === ']]' ? context.pos + 2 : context.pos;
    const targets = await config.current.suggest(query);
    if (context.aborted) return null;
    const apply =
      (insert: string) =>
      (view: EditorView): void => {
        view.dispatch({
          changes: { from, to: closeTo, insert: `${insert}]]` },
          selection: { anchor: from + insert.length + 2 },
        });
      };
    const KIND_LABEL = { note: 'Note', project: 'Project', task: 'Subtask' } as const;
    const options: Completion[] = targets.map((t) => ({
      label: t.label,
      detail: KIND_LABEL[t.kind],
      type: t.kind === 'note' ? 'text' : 'keyword',
      apply: apply(t.insert),
    }));
    const typed = query.trim();
    if (
      typed &&
      !targets.some((t) => t.kind === 'note' && targetKey(t.label) === targetKey(typed))
    ) {
      options.push({ label: typed, detail: 'New note', type: 'text', apply: apply(typed) });
    }
    return { from, to: context.pos, options, filter: false };
  };
}

/** The suggestion source on its own, for tests. */
export const completionSourceForTests = completionSource;

/** The [[links]] extension; `config.current` may change at any time (then dispatch
 *  `wikilinksChanged`). */
export function wikilinks(config: { current: WikilinkConfig }): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildWikilinkDecorations(
          view.state,
          view.hasFocus,
          config.current,
          view.visibleRanges,
        );
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.focusChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state) ||
          update.transactions.some((tr) => tr.effects.some((e) => e.is(wikilinksChanged)))
        ) {
          this.decorations = buildWikilinkDecorations(
            update.state,
            update.view.hasFocus,
            config.current,
            update.view.visibleRanges,
          );
        }
      }
    },
    { decorations: (p) => p.decorations },
  );

  const clicks = EditorView.domEventHandlers({
    mousedown: (event, view) => {
      // A rendered link opens with a plain click (as in Obsidian); on the line being edited,
      // Mod+click opens it and a plain click places the cursor.
      const el = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-wikilink]');
      if (el && event.button === 0) {
        event.preventDefault();
        config.current.open(el.dataset.wikilink ?? '');
        return true;
      }
      if (!(event.metaKey || event.ctrlKey)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const link = pos === null ? null : wikilinkAt(view.state, pos);
      if (!link) return false;
      event.preventDefault();
      config.current.open(link.target);
      return true;
    },
  });

  return [
    plugin,
    clicks,
    autocompletion({
      override: [completionSource(config)],
      icons: false,
      activateOnTyping: true,
      // Suggestions refresh as each "[[" query answers; Enter must always pick one, not
      // fall through to a new line during the default 75ms grace period.
      interactionDelay: 0,
    }),
  ];
}
