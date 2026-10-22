import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMeta, usePersons, useStages } from '../../api/hooks';
import {
  useCreateTask,
  useDeleteTask,
  useMoveTask,
  usePatchTask,
  useRestoreTask,
} from '../../api/taskHooks';
import type { PatchTaskVars } from '../../api/taskHooks';
import type { Task, TaskPatch, TaskPlacement } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Overlay } from '../../components/ui/Overlay';
import { useToast } from '../../components/Toast';
import { describePatch } from '../../lib/describe';
import { donePatch } from '../../lib/tasks';
import styles from '../actions/ProjectActions.module.css';

export interface PatchOptions {
  onSaved?: (saved: Task) => void;
  /** After success or failure (the failure itself is reported by the provider). */
  onSettled?: () => void;
}

export interface TaskActions {
  /** Opens the subtask in the project's panel / sheet (URL: ?project=..&task=..). */
  open: (task: Pick<Task, 'id' | 'project_id'>) => void;
  /** Back from the subtask to its project. */
  back: () => void;
  create: (projectId: string, parentId: string | null, name: string) => Promise<Task>;
  patch: (task: Task, patch: TaskPatch, options?: PatchOptions) => void;
  setDone: (task: Task, done: boolean, options?: PatchOptions) => void;
  move: (task: Task, to: TaskPlacement, announce?: string) => void;
  /** Asks first; `hasChildren` mentions that its own subtasks go too. */
  remove: (task: Task, hasChildren?: boolean) => void;
}

const TaskActionsContext = createContext<TaskActions | null>(null);

export function useTaskActions(): TaskActions {
  const ctx = useContext(TaskActionsContext);
  if (!ctx) throw new Error('useTaskActions must be used inside TaskActionsProvider');
  return ctx;
}

interface ConflictState {
  vars: PatchTaskVars;
  latest: Task;
}

export function TaskActionsProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: stages = [] } = useStages();
  const { data: persons = [] } = usePersons();
  const { data: meta } = useMeta();
  const today = meta?.today ?? '';
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [deletingBranch, setDeletingBranch] = useState(false);

  const createMutation = useCreateTask();
  const patchMutation = usePatchTask((error, vars) => {
    const latest = error.latest<Task>();
    if (error.status === 409 && latest) {
      setConflict({ vars, latest });
      return;
    }
    toast.push({
      kind: 'error',
      message: `Could not save "${vars.task.name}": ${error.message} The change was reverted.`,
    });
  });
  const moveMutation = useMoveTask((error, vars) => {
    toast.push({
      kind: 'error',
      message:
        error.status === 409
          ? `"${vars.task.name}" was changed by someone else, so it was not moved. The latest order is shown; try again.`
          : `Could not move "${vars.task.name}": ${error.message} The change was reverted.`,
    });
  });
  const deleteMutation = useDeleteTask();
  const restoreMutation = useRestoreTask();

  const open = useCallback(
    (task: Pick<Task, 'id' | 'project_id'>) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set('project', task.project_id);
        next.set('task', task.id);
        return next;
      });
    },
    [setSearchParams],
  );

  const back = useCallback(() => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('task');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const create = useCallback(
    (projectId: string, parentId: string | null, name: string) =>
      createMutation.mutateAsync({ projectId, body: { name, parent_id: parentId } }),
    [createMutation],
  );

  const patch = useCallback(
    (task: Task, body: TaskPatch, options?: PatchOptions) => {
      if (Object.keys(body).length === 0) {
        options?.onSettled?.();
        return;
      }
      patchMutation.mutate(
        { task, patch: body },
        { onSuccess: options?.onSaved, onSettled: options?.onSettled },
      );
    },
    [patchMutation],
  );

  const setDone = useCallback(
    (task: Task, done: boolean, options?: PatchOptions) =>
      patch(task, donePatch(task, done, stages, today), options),
    [patch, stages, today],
  );

  const move = useCallback(
    (task: Task, to: TaskPlacement, announce?: string) => {
      moveMutation.mutate(
        { task, to },
        { onSuccess: () => (announce ? toast.push({ message: announce }) : undefined) },
      );
    },
    [moveMutation, toast],
  );

  const remove = useCallback((task: Task, hasChildren = false) => {
    setDeletingBranch(hasChildren);
    setDeleting(task);
  }, []);

  const confirmDelete = (): void => {
    const task = deleting;
    if (!task) return;
    setDeleting(null);
    deleteMutation.mutate(task, {
      onSuccess: () => {
        if (searchParams.get('task') === task.id) back();
        toast.push({
          message: `Deleted subtask "${task.name}".`,
          action: {
            label: 'Undo',
            onClick: () =>
              restoreMutation.mutate(task, {
                onSuccess: () => toast.push({ message: `Restored "${task.name}".` }),
                onError: (error) =>
                  toast.push({
                    kind: 'error',
                    message: `Could not restore "${task.name}": ${error.message}`,
                  }),
              }),
          },
          durationMs: 10000,
        });
      },
      onError: (error) =>
        toast.push({
          kind: 'error',
          message: `Could not delete "${task.name}": ${error.message} It was put back.`,
        }),
    });
  };

  const actions = useMemo<TaskActions>(
    () => ({ open, back, create, patch, setDone, move, remove }),
    [open, back, create, patch, setDone, move, remove],
  );

  return (
    <TaskActionsContext.Provider value={actions}>
      {children}

      <Overlay
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        variant="dialog"
        title="Delete subtask?"
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete}>
              Delete
            </Button>
          </>
        }
      >
        <p className={styles.text}>
          <strong>{deleting?.name}</strong>
          {deletingBranch ? ' and its own subtasks will' : ' will'} be removed. You can undo this
          right after.
        </p>
      </Overlay>

      <Overlay
        open={conflict !== null}
        onClose={() => setConflict(null)}
        variant="dialog"
        title="Changed by someone else"
        footer={
          <>
            <Button onClick={() => setConflict(null)}>Keep latest</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!conflict) return;
                const { vars, latest } = conflict;
                setConflict(null);
                patch(latest, vars.patch, {
                  onSaved: () =>
                    toast.push({
                      message: 'Your change was applied on top of the latest version.',
                    }),
                });
              }}
            >
              Apply my change again
            </Button>
          </>
        }
      >
        {conflict && (
          <div className={styles.text}>
            <p>
              Subtask <strong>{conflict.latest.name}</strong> was updated by someone else. The list
              now shows the latest data.
            </p>
            <p>Your change was not saved:</p>
            <ul className={styles.list}>
              {describePatch(conflict.vars.patch, stages, persons).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </Overlay>
    </TaskActionsContext.Provider>
  );
}
