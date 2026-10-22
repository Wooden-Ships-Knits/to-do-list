import { lazy, Suspense } from 'react';
import styles from './MarkdownEditor.module.css';

export interface MarkdownEditorProps {
  /** id of the editable element (the label's target for tests and aria). */
  id: string;
  /** id of the element that labels the editor. */
  labelId: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  minRows?: number;
}

// CodeMirror is loaded only when an editor is shown, so the table stays fast to load.
const Impl = lazy(() => import('./editor/MarkdownEditorImpl'));

export function preloadMarkdownEditor(): void {
  void import('./editor/MarkdownEditorImpl');
}

/** Plain textarea with the same value while the editor code loads (typing already works). */
function Fallback({
  id,
  labelId,
  value,
  onChange,
  onBlur,
  invalid,
  describedBy,
  minRows = 3,
}: MarkdownEditorProps) {
  return (
    <textarea
      id={id}
      aria-labelledby={labelId}
      className={styles.fallback}
      rows={minRows}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
    />
  );
}

/** Markdown editor with live preview (Obsidian-style): formatting renders as you type, the
 * raw Markdown shows only on the line being edited. */
export function MarkdownEditor(props: MarkdownEditorProps) {
  return (
    <Suspense fallback={<Fallback {...props} />}>
      <Impl {...props} />
    </Suspense>
  );
}
