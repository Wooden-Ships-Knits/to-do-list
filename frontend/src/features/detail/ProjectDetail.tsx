import { useMemo } from 'react';
import { ApiError, useProject, useRestoreProject } from '../../api/hooks';
import type { Category } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Overlay } from '../../components/ui/Overlay';
import type { OverlayVariant } from '../../components/ui/Overlay';
import { useToast } from '../../components/Toast';
import type { Layout } from '../../lib/useLayout';
import { useActions } from '../actions/ProjectActions';
import { ActivityList } from './ActivityList';
import { ProjectForm } from './ProjectForm';

const VARIANTS: Record<Layout, OverlayVariant> = {
  mobile: 'full',
  tablet: 'drawer',
  desktop: 'panel',
};

interface Props {
  layout: Layout;
  /** Project id, or "new" for the create form. */
  target: string;
  defaultCategory: Category;
}

/** Desktop: side panel. Tablet: drawer at 80% width. Mobile: full-screen sheet. */
export function ProjectDetail({ layout, target, defaultCategory }: Props) {
  const actions = useActions();
  const toast = useToast();
  const isNew = target === 'new';
  const query = useProject(isNew ? null : target);
  const restore = useRestoreProject();
  const project = query.data;
  const variant = VARIANTS[layout];

  const title = useMemo(() => {
    if (isNew) return 'Add project';
    return project?.name ?? 'Project';
  }, [isNew, project?.name]);

  const notFound = query.error instanceof ApiError && query.error.status === 404;

  return (
    <Overlay open onClose={actions.close} variant={variant} title={title} testId="detail">
      {isNew && (
        <ProjectForm
          mode="create"
          defaultCategory={defaultCategory}
          onCancel={actions.close}
          onSaved={(created) => {
            toast.push({ message: `Created "${created.name}".` });
            actions.close();
          }}
        />
      )}
      {!isNew && notFound && (
        <div>
          <p>This project no longer exists.</p>
          <Button onClick={actions.close}>Close</Button>
        </div>
      )}
      {!isNew && query.isError && !notFound && (
        <div role="alert">
          <p>Could not load this project: {query.error.message}</p>
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </div>
      )}
      {!isNew && query.isPending && <p aria-live="polite">Loading...</p>}
      {!isNew && project && project.deleted_at && (
        <div>
          <p>This project was deleted.</p>
          <Button
            variant="primary"
            onClick={() =>
              restore.mutate(project.id, {
                onError: (error) => toast.push({ kind: 'error', message: error.message }),
              })
            }
          >
            Restore
          </Button>
        </div>
      )}
      {!isNew && project && !project.deleted_at && (
        <>
          <ProjectForm
            key={project.id}
            mode="edit"
            project={project}
            defaultCategory={project.category}
            onCancel={actions.close}
            onDelete={() => actions.remove(project)}
            onSaved={(saved) => {
              toast.push({ message: `Saved "${saved.name}".` });
              if (layout === 'mobile') actions.close();
            }}
          />
          <ActivityList projectId={project.id} />
        </>
      )}
    </Overlay>
  );
}
