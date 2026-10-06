import { Check, MoreHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { IconButton } from './Button';
import { Popover } from './Popover';
import styles from './Menu.module.css';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
  /** Marks the current choice in a single-choice menu (Theme: Dark / Light / System). */
  checked?: boolean;
}

interface MenuProps {
  label: string;
  items: MenuItem[];
  /** Custom trigger content; defaults to a three-dot icon. */
  trigger?: ReactNode;
  align?: 'start' | 'end';
  triggerClassName?: string;
}

export function Menu({ label, items, trigger, align = 'end', triggerClassName }: MenuProps) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const visible = items.filter((i) => !i.hidden);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (open)
      window.setTimeout(() => listRef.current?.querySelector<HTMLElement>('button')?.focus(), 0);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLElement>('button') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    const move = (to: number): void => {
      event.preventDefault();
      buttons[(to + buttons.length) % buttons.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(buttons.length - 1);
    else if (event.key === 'Tab') close();
  };

  const triggerNode = trigger ? (
    <button
      ref={setAnchor}
      type="button"
      className={triggerClassName}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={label}
      onClick={() => setOpen((v) => !v)}
    >
      {trigger}
    </button>
  ) : (
    <IconButton
      ref={setAnchor}
      label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      className={triggerClassName}
      onClick={() => setOpen((v) => !v)}
    >
      <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden="true" focusable="false" />
    </IconButton>
  );

  return (
    <>
      {triggerNode}
      <Popover
        anchor={anchor}
        open={open}
        onClose={close}
        label={label}
        role="none"
        align={align}
        minWidth={180}
      >
        <div
          ref={listRef}
          role="menu"
          tabIndex={-1}
          aria-label={label}
          onKeyDown={onKeyDown}
          className={styles.list}
        >
          {visible.map((item) => (
            <button
              key={item.label}
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={item.checked}
              className={`${styles.item} ${item.danger ? styles.danger : ''}`}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              <span>{item.label}</span>
              {item.checked && <Check size={14} strokeWidth={1.75} aria-hidden="true" />}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
