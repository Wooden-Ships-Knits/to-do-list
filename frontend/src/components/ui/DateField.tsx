import { MAX_DATE, MIN_DATE } from '../../lib/dates';
import styles from './DateField.module.css';

interface DateFieldProps {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: string;
  hideClear?: boolean;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  invalid?: boolean;
  describedBy?: string;
}

/** Native date input (the platform picker on phones) plus a clear button: clearing = TBD. */
export function DateField({
  id,
  label,
  value,
  onChange,
  max,
  hideClear,
  onKeyDown,
  invalid,
  describedBy,
}: DateFieldProps) {
  return (
    <span className={styles.wrap}>
      <input
        id={id}
        type="date"
        className={styles.input}
        aria-label={id ? undefined : label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={value}
        min={MIN_DATE}
        max={max ?? MAX_DATE}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {!hideClear && (
        <button
          type="button"
          className={styles.clear}
          onClick={() => onChange('')}
          disabled={value === ''}
          aria-label={`Clear ${label} (set to TBD)`}
        >
          Clear
        </button>
      )}
    </span>
  );
}
