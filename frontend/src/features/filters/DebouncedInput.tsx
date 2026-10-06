import { useEffect, useRef, useState } from 'react';
import type { InputHTMLAttributes } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onCommit: (value: string) => void;
  delayMs?: number;
}

/** Text input that reports changes after the user stops typing (300 ms by default). */
export function DebouncedInput({ value, onCommit, delayMs = 300, ...rest }: Props) {
  const [local, setLocal] = useState(value);
  const committed = useRef(value);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });

  // External changes (clear all, chip removal, back button) replace the local text.
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setLocal(value);
    }
  }, [value]);

  useEffect(() => {
    if (local === committed.current) return;
    const id = window.setTimeout(() => {
      committed.current = local;
      commitRef.current(local);
    }, delayMs);
    return () => window.clearTimeout(id);
  }, [local, delayMs]);

  return (
    <input
      {...rest}
      value={local}
      onChange={(event) => setLocal(event.target.value)}
      onKeyDown={(event) => {
        rest.onKeyDown?.(event);
        if (event.key === 'Enter') {
          committed.current = local;
          commitRef.current(local);
        }
      }}
    />
  );
}
