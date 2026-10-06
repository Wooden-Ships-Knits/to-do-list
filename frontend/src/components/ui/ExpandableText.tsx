import { useEffect, useRef, useState } from 'react';
import styles from './ExpandableText.module.css';

/** Long text is truncated to 2 lines with an explicit expand control. */
export function ExpandableText({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => {
      if (!expanded) setOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);

  if (!text) return <span className={styles.empty}>-</span>;
  return (
    <div className={styles.wrap}>
      <div ref={ref} className={expanded ? styles.full : styles.clamped}>
        {text}
      </div>
      {(overflowing || expanded) && (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Less' : 'More'}
        </button>
      )}
    </div>
  );
}
