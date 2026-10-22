import styles from './CheckList.module.css';

export interface CheckOption {
  value: string;
  label: string;
}

interface CheckListProps {
  legend: string;
  options: CheckOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  hideLegend?: boolean;
  /** Options side by side (wrapping) instead of one per line. */
  inline?: boolean;
  /** Test/automation hook. */
  name?: string;
}

/** Multi-select as a list of native checkboxes: keyboard and screen-reader friendly,
 *  and the same control works in popovers, drawers, sheets and forms. */
export function CheckList({
  legend,
  options,
  selected,
  onChange,
  hideLegend,
  inline = false,
  name,
}: CheckListProps) {
  const toggle = (value: string): void => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };
  return (
    <fieldset className={styles.fieldset} data-name={name}>
      <legend className={hideLegend ? 'sr-only' : styles.legend}>{legend}</legend>
      <div className={`${styles.list} ${inline ? styles.inline : ''}`}>
        {options.map((o) => (
          <label key={o.value} className={styles.option}>
            <input
              type="checkbox"
              checked={selected.includes(o.value)}
              onChange={() => toggle(o.value)}
              value={o.value}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
