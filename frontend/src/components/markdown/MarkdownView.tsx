import { lazy, Suspense } from 'react';
import styles from './MarkdownView.module.css';

export interface MarkdownViewProps {
  text: string;
  /** Dense rendering for table cells: no block margins, headings at body size. */
  compact?: boolean;
  className?: string;
}

// The Markdown parser is a separate chunk, fetched right after start-up (see preload below), so
// the first paint of the table does not wait for it.
const loadRender = () => import('./MarkdownRender');
const Render = lazy(loadRender);

export function preloadMarkdown(): void {
  void loadRender();
}

/** Markdown (GFM) shown as formatted text. Until the renderer has loaded, the plain text is
 *  shown (most notes are plain text anyway). */
export function MarkdownView(props: MarkdownViewProps) {
  return (
    <Suspense
      fallback={
        <div
          className={[
            styles.md,
            styles.plain,
            props.compact ? styles.compact : '',
            props.className ?? '',
          ]
            .join(' ')
            .trim()}
        >
          {props.text}
        </div>
      }
    >
      <Render {...props} />
    </Suspense>
  );
}
