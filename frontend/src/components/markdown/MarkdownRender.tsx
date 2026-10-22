import { CheckSquare, Square } from 'lucide-react';
import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeUrl } from './safeUrl';
import styles from './MarkdownView.module.css';

import type { MarkdownViewProps } from './MarkdownView';

const ICON = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const;

function heading(level: number) {
  // Visual headings only: Markdown inside a panel must not break the page's heading outline.
  return function Heading({ children }: { children?: ReactNode }) {
    return <p className={`${styles.heading} ${styles[`h${level}`]}`}>{children}</p>;
  };
}

const components: Components = {
  a: ({ href, children }) => {
    const url = safeUrl(href);
    if (!url) return <span className={styles.badLink}>{children}</span>;
    return (
      <a href={url} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    );
  },
  // Remote images are not loaded (privacy, layout); the alt text links to the image instead.
  img: ({ src, alt }) => {
    const url = safeUrl(typeof src === 'string' ? src : null);
    const label = `Image: ${alt || 'untitled'}`;
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer nofollow">
        {label}
      </a>
    ) : (
      <span>{label}</span>
    );
  },
  // GFM task list checkboxes: read-only here, shown as an icon with a text equivalent.
  input: ({ checked, type }) => {
    if (type !== 'checkbox') return null;
    return (
      <span className={styles.task} data-checked={checked ? 'true' : 'false'}>
        {checked ? <CheckSquare {...ICON} /> : <Square {...ICON} />}
        <span className="sr-only">{checked ? 'Done: ' : 'Not done: '}</span>
      </span>
    );
  },
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(4),
  h6: heading(4),
};

/** Renders Markdown (GFM) safely: raw HTML is never rendered, only http(s)/mailto links. */
export default function MarkdownRender({ text, compact = false, className }: MarkdownViewProps) {
  return (
    <div
      className={[styles.md, compact ? styles.compact : '', className ?? ''].join(' ').trim()}
      data-testid="markdown"
    >
      <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </Markdown>
    </div>
  );
}
