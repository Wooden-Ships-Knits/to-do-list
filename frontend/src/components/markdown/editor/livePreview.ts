import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { safeUrl } from '../safeUrl';
import { setTaskAt } from './commands';

/*
 * Live preview, like Obsidian: Markdown renders while you type. Syntax characters (#, **, `,
 * [](url), > ...) are hidden on every line except the lines the cursor or selection is on, so
 * the text stays editable as plain Markdown where you are working and reads as formatted text
 * everywhere else. Without focus, every line is rendered.
 */

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.pos === this.pos;
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-md-checkbox';
    box.checked = this.checked;
    box.tabIndex = -1; // keyboard: Mod-Enter on the line (the editor keeps the focus)
    box.setAttribute('aria-label', this.checked ? 'Done, mark as not done' : 'Mark as done');
    box.addEventListener('mousedown', (event) => event.preventDefault());
    box.addEventListener('click', (event) => {
      event.preventDefault();
      setTaskAt(this.pos, !this.checked)(view);
    });
    return box;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const dot = document.createElement('span');
    dot.className = 'cm-md-bullet';
    dot.textContent = '•';
    dot.setAttribute('aria-hidden', 'true');
    return dot;
  }
}

class RuleWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const hr = document.createElement('span');
    hr.className = 'cm-md-hr';
    hr.setAttribute('aria-hidden', 'true');
    return hr;
  }
}

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });
const mark = (cls: string): Decoration => Decoration.mark({ class: cls });
const line = (cls: string): Decoration => Decoration.line({ class: cls });

const MARKS: Record<string, string> = {
  Emphasis: 'cm-md-em',
  StrongEmphasis: 'cm-md-strong',
  InlineCode: 'cm-md-code',
  Strikethrough: 'cm-md-strike',
};

/** Line numbers the selection touches (where Markdown is shown raw). Empty without focus. */
export function activeLines(state: EditorState, focused: boolean): Set<number> {
  const lines = new Set<number>();
  if (!focused) return lines;
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

function touches(state: EditorState, active: Set<number>, from: number, to: number): boolean {
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  for (let n = first; n <= last; n++) if (active.has(n)) return true;
  return false;
}

/** Hides from..to. Plugins may not replace line breaks, so multi-line ranges stay visible. */
function pushHide(state: EditorState, out: Range<Decoration>[], from: number, to: number): void {
  if (to > from && state.doc.lineAt(from).number === state.doc.lineAt(to).number) {
    out.push(hide.range(from, to));
  }
}

/** Hides `node` plus the single space after it (for "# ", "> ", "- "). */
function hideWithSpace(state: EditorState, node: SyntaxNode, out: Range<Decoration>[]): void {
  const end = state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
  pushHide(state, out, node.from, end);
}

export function buildDecorations(
  state: EditorState,
  focused: boolean,
  ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }],
): DecorationSet {
  const active = activeLines(state, focused);
  const out: Range<Decoration>[] = [];
  const tree = syntaxTree(state);

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter: (ref) => {
        const node = ref.node;
        const name = node.name;
        const raw = touches(state, active, node.from, node.to);

        const heading = /^(ATX|Setext)Heading(\d)$/.exec(name);
        if (heading) {
          const level = Math.min(Number(heading[2]), 4);
          out.push(line(`cm-md-h cm-md-h${level}`).range(state.doc.lineAt(node.from).from));
          return;
        }
        if (name === 'HeaderMark') {
          if (!raw && node.parent?.name.startsWith('ATX')) hideWithSpace(state, node, out);
          return;
        }
        if (name in MARKS) {
          if (node.to > node.from) out.push(mark(MARKS[name]).range(node.from, node.to));
          return;
        }
        if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
          if (!raw) pushHide(state, out, node.from, node.to);
          return;
        }
        if (name === 'CodeMark') {
          if (!raw && node.parent?.name === 'InlineCode') pushHide(state, out, node.from, node.to);
          return;
        }
        if (name === 'Link' || name === 'Image') {
          const marks = node.getChildren('LinkMark');
          const url = node.getChild('URL');
          if (marks.length >= 2) {
            const textFrom = marks[0].to;
            const textTo = marks[1].from;
            if (textTo > textFrom) out.push(mark('cm-md-link').range(textFrom, textTo));
            if (!raw && url) {
              // "[" before the text, "](url "title")" after it
              pushHide(state, out, marks[0].from, marks[0].to);
              pushHide(state, out, marks[1].from, node.to);
            }
          }
          return false;
        }
        if (name === 'URL' && node.parent?.name === 'Autolink') {
          out.push(mark('cm-md-link').range(node.from, node.to));
          return;
        }
        if (name === 'Blockquote') {
          for (let pos = node.from; pos <= node.to;) {
            const l = state.doc.lineAt(pos);
            out.push(line('cm-md-quote').range(l.from));
            pos = l.to + 1;
          }
          return;
        }
        if (name === 'QuoteMark') {
          if (!raw) hideWithSpace(state, node, out);
          return;
        }
        if (name === 'FencedCode' || name === 'CodeBlock') {
          for (let pos = node.from; pos <= node.to;) {
            const l = state.doc.lineAt(pos);
            out.push(line('cm-md-codeblock').range(l.from));
            pos = l.to + 1;
          }
          return false;
        }
        if (name === 'HorizontalRule') {
          if (!raw && node.to > node.from) out.push(rule.range(node.from, node.to));
          return;
        }
        if (name === 'ListMark') {
          const item = node.parent;
          const task = item?.getChild('Task');
          const text = state.sliceDoc(node.from, node.to);
          if (task) {
            // "- [ ] text": the list mark goes away, the [ ] becomes a checkbox (always).
            if (!raw) hideWithSpace(state, node, out);
          } else if (!raw && /^[-*+]$/.test(text)) {
            out.push(bullet.range(node.from, node.to));
          }
          return;
        }
        if (name === 'TaskMarker') {
          const checked = /\[[xX]\]/.test(state.sliceDoc(node.from, node.to));
          // The selection inside the marker itself shows the raw "[x]" so it can be edited.
          const editingMarker = state.selection.ranges.some(
            (r) => focused && r.from <= node.to && r.to >= node.from && raw,
          );
          if (!editingMarker) {
            out.push(
              Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(
                node.from,
                node.to,
              ),
            );
          }
          if (checked) {
            const lineEnd = state.doc.lineAt(node.to).to;
            const start = Math.min(node.to + 1, lineEnd);
            if (lineEnd > start) out.push(mark('cm-md-task-done').range(start, lineEnd));
          }
          return;
        }
        return;
      },
    });
  }
  return Decoration.set(out, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state, view.hasFocus, view.visibleRanges);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildDecorations(
          update.state,
          update.view.hasFocus,
          update.view.visibleRanges,
        );
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Mod+click on a rendered link opens it in a new tab (a plain click just places the cursor). */
export const openLinkOnModClick = EditorView.domEventHandlers({
  click: (event, view) => {
    if (!(event.metaKey || event.ctrlKey)) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1);
    while (node && node.name !== 'Link' && node.name !== 'Autolink') node = node.parent;
    const url = node?.getChild('URL');
    if (!url) return false;
    const href = safeUrl(view.state.sliceDoc(url.from, url.to));
    if (!href) return false;
    window.open(href, '_blank', 'noopener,noreferrer');
    event.preventDefault();
    return true;
  },
});
