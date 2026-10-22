import type { Project } from '../../api/types';
import { Menu } from '../../components/ui/Menu';
import type { Actions } from '../actions/ProjectActions';

export interface OrderMoves {
  /** Null when the project is already first / last among the visible rows of its category. */
  up: (() => void) | null;
  down: (() => void) | null;
}

/** Row actions are always reachable by tap or keyboard (never hover-only, never swipe-only). */
export function RowMenu({
  project,
  actions,
  order,
  trigger,
  triggerClassName,
  onAddSubtask,
}: {
  project: Project;
  actions: Actions;
  /** Opens the "Add subtask" box (table) or the project's sheet (cards). */
  onAddSubtask?: () => void;
  /** Present only while the list is in manual order. */
  order?: OrderMoves;
  trigger?: React.ReactNode;
  triggerClassName?: string;
}) {
  return (
    <Menu
      label={`More actions for ${project.name}`}
      trigger={trigger}
      triggerClassName={triggerClassName}
      items={[
        { label: 'Edit', onSelect: () => actions.open(project.id) },
        {
          label: 'Add subtask',
          hidden: !onAddSubtask,
          onSelect: () => onAddSubtask?.(),
        },
        {
          label: 'Move up',
          hidden: !order?.up,
          onSelect: () => order?.up?.(),
        },
        {
          label: 'Move down',
          hidden: !order?.down,
          onSelect: () => order?.down?.(),
        },
        { label: 'Move to category...', onSelect: () => actions.chooseCategory(project) },
        { label: 'Delete', danger: true, onSelect: () => actions.remove(project) },
      ]}
    />
  );
}
