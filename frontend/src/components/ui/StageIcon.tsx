import {
  CircleCheckBig,
  CircleDashed,
  CircleDot,
  CircleDotDashed,
  CircleEllipsis,
  CirclePause,
  CirclePlay,
  Search,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { stageSlug } from '../../lib/avatar';
import styles from './StageIcon.module.css';

const ICONS: Record<string, LucideIcon> = {
  'not-started': CircleDashed,
  investigation: Search,
  'in-progress': CircleDotDashed,
  'in-development': CircleDotDashed,
  testing: CircleEllipsis,
  waiting: CirclePause,
  built: CircleDot,
  live: CirclePlay,
  'under-maintenance': Wrench,
  done: CircleCheckBig,
};

/** Status circle in front of a project name, like ClickUp's. Decorative: the stage is always
 *  written in the Stage column and in the tooltip. */
export function StageIcon({ name }: { name: string }) {
  const slug = stageSlug(name);
  const Icon = ICONS[slug] ?? CircleDashed;
  return (
    <span
      className={styles.icon}
      style={{ color: `var(--dot-${slug}, var(--dot-default))` }}
      title={name}
      aria-hidden="true"
      data-stage-icon={slug}
    >
      <Icon size={16} strokeWidth={1.75} />
    </span>
  );
}
