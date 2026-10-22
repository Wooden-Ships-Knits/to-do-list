import { EditorSelection, EditorState } from '@codemirror/state';
import type { StateCommand, Transaction } from '@codemirror/state';
import { insertLink, setTaskAt, toggleLinePrefix, toggleTask, toggleWrap } from './commands';

/** Runs a command on `doc` where "|" marks the cursor or "{..}" a selection. */
function run(doc: string, command: StateCommand): { doc: string; selected: string } {
  let anchor = 0;
  let head = 0;
  let text = doc;
  if (doc.includes('|')) {
    anchor = head = doc.indexOf('|');
    text = doc.replace('|', '');
  } else if (doc.includes('{') && doc.includes('}')) {
    anchor = doc.indexOf('{');
    head = doc.indexOf('}') - 1;
    text = doc.replace('{', '').replace('}', '');
  }
  let state = EditorState.create({
    doc: text,
    selection: EditorSelection.single(anchor, head),
  });
  command({
    state,
    dispatch: (tr: Transaction) => {
      state = tr.state;
    },
  });
  const sel = state.selection.main;
  return { doc: state.doc.toString(), selected: state.sliceDoc(sel.from, sel.to) };
}

describe('editor commands', () => {
  it('wraps and unwraps a selection in bold / italic / code', () => {
    expect(run('make {this} bold', toggleWrap('**'))).toEqual({
      doc: 'make **this** bold',
      selected: 'this',
    });
    expect(run('make **{this}** bold', toggleWrap('**')).doc).toBe('make this bold');
    expect(run('make {**this**} bold', toggleWrap('**')).doc).toBe('make this bold');
    expect(run('a |b', toggleWrap('*')).doc).toBe('a **b');
    expect(run('x {y}', toggleWrap('`')).doc).toBe('x `y`');
  });

  it('toggles line prefixes for headings, bullets and checklists', () => {
    expect(run('{one\ntwo}', toggleLinePrefix('- ')).doc).toBe('- one\n- two');
    expect(run('{- one\n- two}', toggleLinePrefix('- ')).doc).toBe('one\ntwo');
    expect(run('|title', toggleLinePrefix('## ')).doc).toBe('## title');
    expect(run('## |title', toggleLinePrefix('## ')).doc).toBe('title');
    // another prefix is replaced, not stacked
    expect(run('- |item', toggleLinePrefix('- [ ] ')).doc).toBe('- [ ] item');
    expect(run('- [x] |item', toggleLinePrefix('- [ ] ')).doc).toBe('item');
    expect(run('  - |nested', toggleLinePrefix('## ')).doc).toBe('  ## nested');
  });

  it('inserts a link and selects the part to type next', () => {
    expect(run('see {docs}', insertLink)).toEqual({
      doc: 'see [docs](https://)',
      selected: 'https://',
    });
    expect(run('see |', insertLink)).toEqual({
      doc: 'see [link text](https://)',
      selected: 'link text',
    });
  });

  it('Mod-Enter ticks, unticks or creates a task on the cursor line', () => {
    expect(run('- [ ] a|', toggleTask).doc).toBe('- [x] a');
    expect(run('- [X] a|', toggleTask).doc).toBe('- [ ] a');
    expect(run('- a|', toggleTask).doc).toBe('- [ ] a');
    expect(run('plain|', toggleTask).doc).toBe('- [ ] plain');
    expect(run('  indented|', toggleTask).doc).toBe('  - [ ] indented');
  });

  it('sets a task marker at a position, and refuses anything else', () => {
    expect(run('- [ ] a', setTaskAt(2, true)).doc).toBe('- [x] a');
    expect(run('- [x] a', setTaskAt(2, false)).doc).toBe('- [ ] a');
    expect(run('- [x] a', setTaskAt(0, false)).doc).toBe('- [x] a');
  });
});
