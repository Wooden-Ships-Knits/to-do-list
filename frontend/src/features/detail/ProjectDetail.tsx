import { History } from 'lucide-react';
import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, useProject, useRestoreProject } from '../../api/hooks';
import type { Category } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Overlay } from '../../components/ui/Overlay';
import type { OverlayVariant } from '../../components/ui/Overlay';
import { useToast } from '../../components/Toast';
import type { Layout } from '../../lib/useLayout';
import { useActions } from '../actions/ProjectActions';
import { useTasks } from '../../api/taskHooks';
import { SubtaskList } from '../subtasks/SubtaskList';
import { CATEGORY_LABELS } from '../../lib/status';
import { ActivityList } from './ActivityList';
import { DetailLayout } from './DetailLayout';
import { ProjectForm } from './ProjectForm';

// Opened on demand (a subtask's own view), so it is not part of the first download.
const TaskDetail = lazy(() =>
  import('../subtasks/TaskDetail').then((m) => ({ default: m.TaskDetail })),
);

const VARIANTS: Record<Layout, OverlayVariant> = {
  mobile: 'full',
  tablet: 'modal',
  desktop: 'modal',
};

interface Props {
  layout: Layout;
  /** Project id, or "new" for the create form. */
  target: string;
  defaultCategory: Category;
}

/** Desktop and tablet: a large centred pop-up (ClickUp-style task view). Mobile: full-screen
 *  sheet. */
export function ProjectDetail({ layout, target, defaultCategory }: Props) {
  const actions = useActions();
  const toast = useToast();
  const isNew = target === 'new';
  const query = useProject(isNew ? null : target);
  const restore = useRestoreProject();
  const project = query.data;
  const variant = VARIANTS[layout];
  const [searchParams] = useSearchParams();
  const taskId = isNew ? null : searchParams.get('task');
  const tasks = useTasks(isNew ? null : target, taskId !== null);
  const taskName = taskId ? tasks.data?.find((t) => t.id === taskId)?.name : undefined;

  const title = useMemo(() => {
    if (isNew) return 'Add project';
    // A breadcrumb: the name itself is the big editable title in the body.
    if (taskId) return `${project?.name ?? 'Project'} / ${taskName ?? 'Subtask'}`;
    return project ? `${CATEGORY_LABELS[project.category]} / ${project.name}` : 'Project';
  }, [isNew, project, taskId, taskName]);

  const notFound = query.error instanceof ApiError && query.error.status === 404;

  // History only when asked for; unsaved edits are confirmed before the pop-up closes.
  const [showActivity, setShowActivity] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);
  const requestClose = (): void => {
    if (dirty) setConfirmClose(true);
    else actions.close();
  };

  const editing = !isNew && project && !project.deleted_at ? project : null;

  let body: ReactNode;
  if (isNew) {
    body = (
      <DetailLayout
        main={
          <ProjectForm
            mode="create"
            defaultCategory={defaultCategory}
            onCancel={requestClose}
            onDirtyChange={onDirtyChange}
            onSaved={(created) => {
              toast.push({ message: `Created "${created.name}".` });
              actions.close();
            }}
          />
        }
      />
    );
  } else if (editing && taskId) {
    body = (
      <Suspense fallback={<DetailLayout main={<p aria-live="polite">Loading...</p>} />}>
        <TaskDetail
          projectId={editing.id}
          projectName={editing.name}
          taskId={taskId}
          showActivity={showActivity}
          onDirtyChange={onDirtyChange}
        />
      </Suspense>
    );
  } else if (editing) {
    body = (
      <DetailLayout
        main={
          <>
            <ProjectForm
              key={editing.id}
              mode="edit"
              project={editing}
              defaultCategory={editing.category}
              onCancel={requestClose}
              onDirtyChange={onDirtyChange}
              onDelete={() => actions.remove(editing)}
              onSaved={(saved) => {
                toast.push({ message: `Saved "${saved.name}".` });
                if (layout === 'mobile') actions.close();
              }}
            />
            <SubtaskList
              projectId={editing.id}
              parent={{ id: null, name: editing.name, depth: 0 }}
            />
          </>
        }
        side={showActivity ? <ActivityList projectId={editing.id} /> : undefined}
      />
    );
  } else {
    body = (
      <DetailLayout
        main={
          <>
            {notFound && (
              <div>
                <p>This project no longer exists.</p>
                <Button onClick={actions.close}>Close</Button>
              </div>
            )}
            {query.isError && !notFound && (
              <div role="alert">
                <p>Could not load this project: {query.error.message}</p>
                <Button onClick={() => void query.refetch()}>Retry</Button>
              </div>
            )}
            {query.isPending && <p aria-live="polite">Loading...</p>}
            {project?.deleted_at && (
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
          </>
        }
      />
    );
  }

  return (
    <>
      <Overlay
        open
        onClose={requestClose}
        variant={variant}
        title={title}
        testId="detail"
        headerActions={
          editing && (
            <Button
              aria-pressed={showActivity}
              onClick={() => setShowActivity((v) => !v)}
              data-testid="toggle-activity"
            >
              <History size={16} strokeWidth={1.75} aria-hidden="true" />
              Activity
            </Button>
          )
        }
      >
        {body}
      </Overlay>
      <Overlay
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        variant="dialog"
        title="Discard changes?"
        footer={
          <>
            <Button onClick={() => setConfirmClose(false)}>Keep editing</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmClose(false);
                setDirty(false);
                actions.close();
              }}
            >
              Discard
            </Button>
          </>
        }
      >
        <p>You have changes that are not saved yet. Close without saving them?</p>
      </Overlay>
    </>
  );
}
