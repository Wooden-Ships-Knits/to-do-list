import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { LanguageSupport } from '@codemirror/language';
import { Annotation, EditorState } from '@codemirror/state';
import type { StateCommand } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
import { Bold, Code, Heading, Italic, Link, List, ListChecks } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { insertLink, toggleLinePrefix, toggleTask, toggleWrap } from './commands';
import { livePreview, openLinkOnModClick } from './livePreview';
import { tablePreview } from './tablePreview';
import type { MarkdownEditorProps } from '../MarkdownEditor';
import styles from '../MarkdownEditor.module.css';

/** Marks changes that come from props (form reset, conflict refresh), not from typing. */
const External = Annotation.define<boolean>();

const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform);
const MOD = isMac ? 'Cmd' : 'Ctrl';

interface Tool {
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  run: StateCommand;
}

const TOOLS: Tool[] = [
  { label: 'Bold', shortcut: `${MOD}+B`, icon: Bold, run: toggleWrap('**') },
  { label: 'Italic', shortcut: `${MOD}+I`, icon: Italic, run: toggleWrap('*') },
  { label: 'Heading', icon: Heading, run: toggleLinePrefix('## ') },
  { label: 'Bulleted list', icon: List, run: toggleLinePrefix('- ') },
  {
    label: 'Checklist',
    shortcut: `${MOD}+Enter`,
    icon: ListChecks,
    run: toggleLinePrefix('- [ ] '),
  },
  { label: 'Link', shortcut: `${MOD}+K`, icon: Link, run: insertLink },
  { label: 'Code', shortcut: `${MOD}+E`, icon: Code, run: toggleWrap('`') },
];

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

export default function MarkdownEditorImpl({
  id,
  labelId,
  value,
  onChange,
  onBlur,
  placeholder,
  invalid,
  describedBy,
  minRows = 3,
}: MarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Latest callbacks without re-creating the editor.
  const callbacks = useRef({ onChange, onBlur });
  useLayoutEffect(() => {
    callbacks.current = { onChange, onBlur };
  }, [onChange, onBlur]);

  useEffect(() => {
    if (!host.current) return;
    const attrs: Record<string, string> = {
      id,
      'aria-labelledby': labelId,
      'aria-multiline': 'true',
      spellcheck: 'true',
      autocapitalize: 'sentences',
    };
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          // GFM Markdown without the embedded HTML / code-block languages (keeps the chunk small;
          // raw HTML is never rendered anyway).
          new LanguageSupport(markdownLanguage),
          livePreview,
          tablePreview,
          openLinkOnModClick,
          EditorView.lineWrapping,
          placeholder ? placeholderExt(placeholder) : [],
          keymap.of([
            { key: 'Mod-b', run: toggleWrap('**') },
            { key: 'Mod-i', run: toggleWrap('*') },
            { key: 'Mod-e', run: toggleWrap('`') },
            { key: 'Mod-k', run: insertLink },
            { key: 'Mod-Enter', run: toggleTask },
            ...markdownKeymap,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.contentAttributes.of(attrs),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((t) => t.annotation(External))) {
              callbacks.current.onChange(update.state.doc.toString());
            }
            if (update.focusChanged && !update.view.hasFocus) callbacks.current.onBlur?.();
          }),
        ],
      }),
    });
    view.current = instance;
    return () => {
      instance.destroy();
      view.current = null;
    };
    // The editor is created once; value changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, labelId, placeholder]);

  // Keep the document in sync when the value changes from outside (reset, refetch).
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current === value) return;
    v.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: External.of(true),
    });
  }, [value]);

  // aria-invalid / aria-describedby can change without re-creating the editor.
  useEffect(() => {
    const content = view.current?.contentDOM;
    if (!content) return;
    if (invalid) content.setAttribute('aria-invalid', 'true');
    else content.removeAttribute('aria-invalid');
    if (describedBy) content.setAttribute('aria-describedby', describedBy);
    else content.removeAttribute('aria-describedby');
  }, [invalid, describedBy]);

  const run = (tool: Tool): void => {
    const v = view.current;
    if (!v) return;
    tool.run(v);
    v.focus();
  };

  return (
    <div className={styles.wrap} data-invalid={invalid ? 'true' : undefined} data-escape-leaves>
      <div className={styles.toolbar} role="toolbar" aria-label="Formatting" aria-controls={id}>
        {TOOLS.map((tool) => (
          <button
            key={tool.label}
            type="button"
            className={styles.tool}
            aria-label={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
            title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(tool)}
          >
            <tool.icon {...ICON} />
          </button>
        ))}
      </div>
      <div
        ref={host}
        className={styles.editor}
        style={{ ['--md-min-rows' as string]: String(minRows) }}
        data-testid="markdown-editor"
      />
    </div>
  );
}
