import { EditorSelection } from '@codemirror/state';
import type { StateCommand } from '@codemirror/state';

/** Wraps each selection in `mark` (bold **, italic *, code `), or unwraps it when it already is. */
export function toggleWrap(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    const n = mark.length;
    const tr = state.changeByRange((range) => {
      const before = state.sliceDoc(range.from - n, range.from);
      const after = state.sliceDoc(range.to, range.to + n);
      if (before === mark && after === mark) {
        return {
          changes: [
            { from: range.from - n, to: range.from },
            { from: range.to, to: range.to + n },
          ],
          range: EditorSelection.range(range.from - n, range.to - n),
        };
      }
      const text = state.sliceDoc(range.from, range.to);
      if (text.length > 2 * n && text.startsWith(mark) && text.endsWith(mark)) {
        return {
          changes: { from: range.from, to: range.to, insert: text.slice(n, -n) },
          range: EditorSelection.range(range.from, range.to - 2 * n),
        };
      }
      return {
        changes: [
          { from: range.from, insert: mark },
          { from: range.to, insert: mark },
        ],
        range: EditorSelection.range(range.from + n, range.to + n),
      };
    });
    dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
    return true;
  };
}

/** Any block prefix the toolbar can set: heading, bullet, task. */
const PREFIX = /^(\s*)(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] )?/;

/** Toggles a line prefix ("## ", "- ", "- [ ] ") on every line touched by the selection.
 * When all lines already have it, it is removed; otherwise it replaces any other prefix. */
export function toggleLinePrefix(prefix: string): StateCommand {
  return ({ state, dispatch }) => {
    const lines = new Set<number>();
    for (const r of state.selection.ranges) {
      for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) {
        lines.add(l);
      }
    }
    const parsed = [...lines].map((number) => {
      const line = state.doc.line(number);
      const m = PREFIX.exec(line.text);
      const indent = m?.[1] ?? '';
      const current = m?.[2] ?? '';
      return { line, indent, current };
    });
    const isSame = (current: string): boolean =>
      prefix.includes('[') ? /^[-*+] \[[ xX]\] $/.test(current) : current === prefix;
    const remove = parsed.every((p) => isSame(p.current));
    const changes = parsed.map(({ line, indent, current }) => ({
      from: line.from + indent.length,
      to: line.from + indent.length + current.length,
      insert: remove ? '' : prefix,
    }));
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'input.format' }));
    return true;
  };
}

/** [text](https://): selects the URL when text was selected, else the placeholder text. */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const label = text || 'link text';
    const insert = `[${label}](https://)`;
    const urlStart = range.from + label.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: text
        ? EditorSelection.range(urlStart, urlStart + 'https://'.length)
        : EditorSelection.range(range.from + 1, range.from + 1 + label.length),
    };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
  return true;
};

const TASK = /^(\s*[-*+] )\[([ xX])\]/;
const BULLET = /^(\s*)([-*+] )/;

/** Mod-Enter: ticks / unticks the task on the cursor line, or turns the line into a task. */
export const toggleTask: StateCommand = ({ state, dispatch }) => {
  const line = state.doc.lineAt(state.selection.main.head);
  const task = TASK.exec(line.text);
  let change: { from: number; to?: number; insert: string };
  if (task) {
    const at = line.from + task[1].length + 1;
    change = { from: at, to: at + 1, insert: task[2] === ' ' ? 'x' : ' ' };
  } else {
    const bullet = BULLET.exec(line.text);
    const at = line.from + (bullet ? bullet[0].length : (/^\s*/.exec(line.text)?.[0].length ?? 0));
    change = { from: at, insert: bullet ? '[ ] ' : '- [ ] ' };
  }
  dispatch(state.update({ changes: change, userEvent: 'input.format' }));
  return true;
};

/** Sets the task marker at `pos` ("[ ]" starts there) to checked or unchecked. */
export function setTaskAt(pos: number, checked: boolean): StateCommand {
  return ({ state, dispatch }) => {
    if (state.sliceDoc(pos, pos + 1) !== '[' || state.sliceDoc(pos + 2, pos + 3) !== ']') {
      return false;
    }
    dispatch(
      state.update({
        changes: { from: pos + 1, to: pos + 2, insert: checked ? 'x' : ' ' },
        userEvent: 'input.toggle',
      }),
    );
    return true;
  };
}
