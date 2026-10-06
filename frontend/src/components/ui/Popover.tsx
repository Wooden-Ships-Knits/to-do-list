import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Popover.module.css';

interface PopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  align?: 'start' | 'end';
  role?: 'dialog' | 'menu' | 'none';
  minWidth?: number;
  /** Runs before the built-in handling (e.g. Enter-to-save in inline editors). */
  onContentKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/** Floating panel anchored to a trigger, rendered in a portal so table scroll containers
 *  never clip it. Closes on Escape (wherever the focus is) and on outside click; focus
 *  returns to the trigger. */
export function Popover({
  anchor,
  open,
  onClose,
  label,
  children,
  align = 'start',
  role = 'dialog',
  minWidth = 220,
  onContentKeyDown,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  const reposition = useCallback(() => {
    if (!anchor || !ref.current) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(ref.current.offsetWidth, minWidth);
    const margin = 8;
    let left = align === 'end' ? rect.right - width : rect.left;
    left = Math.min(Math.max(margin, left), window.innerWidth - width - margin);
    const below = window.innerHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const placeAbove = below < 200 && above > below;
    setStyle({
      left,
      minWidth,
      maxHeight: Math.max(160, placeAbove ? above : below) - 4,
      ...(placeAbove ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
  }, [anchor, align, minWidth]);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition, children]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    // Capture phase: Escape closes the popover first, and does not also close an overlay
    // underneath it.
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
      anchor?.focus();
    };
    document.addEventListener('keydown', onEscape, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onEscape, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, anchor, onClose, reposition]);

  if (!open) return null;

  return createPortal(
    <div
      ref={ref}
      className={styles.popover}
      style={style}
      role={role === 'none' ? 'presentation' : role}
      aria-label={label}
      onKeyDown={onContentKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}
