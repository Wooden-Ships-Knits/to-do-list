import { GripVertical } from 'lucide-react';
import type { HTMLAttributes, Ref } from 'react';
import styles from './dnd.module.css';

interface Props extends HTMLAttributes<HTMLButtonElement> {
  name: string;
  disabled: boolean;
  handleRef?: Ref<HTMLButtonElement>;
}

/** Six-dot grip. Only the handle starts a drag, so text selection and inline editing keep working. */
export function DragHandle({ name, disabled, handleRef, ...rest }: Props) {
  return (
    <button
      ref={handleRef}
      type="button"
      className={styles.handle}
      aria-label={`Drag to reorder ${name}`}
      title={disabled ? 'Switch to manual order to rearrange' : 'Drag to reorder'}
      disabled={disabled}
      {...rest}
    >
      <GripVertical size={16} strokeWidth={1.75} aria-hidden="true" focusable="false" />
    </button>
  );
}
