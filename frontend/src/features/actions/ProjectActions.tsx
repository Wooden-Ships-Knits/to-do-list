import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ApiError } from '../../api/client';
import {
  useDeleteProject,
  usePatchProject,
  usePersons,
  useReorderProject,
  useRestoreProject,
  useStages,
  useMeta,
} from '../../api/hooks';
import type { PatchVars } from '../../api/hooks';
import type { Category, Project, ProjectPatch } from '../../api/types';
import { CATEGORIES } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { DateField } from '../../components/ui/DateField';
import { Overlay } from '../../components/ui/Overlay';
import { useToast } from '../../components/Toast';
import { formatDate } from '../../lib/dates';
import { describePatch } from '../../lib/describe';
import { CATEGORY_LABELS, DONE_STAGE } from '../../lib/status';
import styles from './ProjectActions.module.css';

interface PatchOptions {
  successMessage?: string;
}

export interface ReorderTarget {
  category: Category;
  beforeId?: string;
  afterId?: string;
}

export interface Actions {
  /** Opens the detail panel / sheet (id) or the create form ('new'). */
  open: (id: string) => void;
  close: () => void;
  patch: (project: Project, patch: ProjectPatch, options?: PatchOptions) => void;
  changeStage: (project: Project, stageId: number) => void;
  /** Manual order: place next to another project (or at the end of a category). */
  reorder: (project: Project, target: ReorderTarget) => Promise<void>;
  /** Opens the "Move to category" dialog. */
  chooseCategory: (project: Project) => void;
  remove: (project: Project) => void;
}

const ActionsContext = createContext<Actions | null>(null);

export function useActions(): Actions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useActions must be used inside ProjectActionsProvider');
  return ctx;
}

interface ConflictState {
  vars: PatchVars;
  latest: Project;
}

interface DonePromptState {
  project: Project;
  stageId: number;
}

export function ProjectActionsProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: stages = [] } = useStages();
  const { data: persons = [] } = usePersons();
  const { data: meta } = useMeta();
  const today = meta?.today ?? '';

  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [donePrompt, setDonePrompt] = useState<DonePromptState | null>(null);
  const [doneDate, setDoneDate] = useState('');
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [moving, setMoving] = useState<Project | null>(null);
  const [moveTarget, setMoveTarget] = useState<Category>('current');

  const patchMutation = usePatchProject((error: ApiError, vars: PatchVars) => {
    if (error.status === 409 && error.current) {
      setConflict({ vars, latest: error.current });
      return;
    }
    toast.push({
      kind: 'error',
      message: `Could not save "${vars.project.name}": ${error.message} The change was reverted.`,
    });
  });
  const reorderMutation = useReorderProject((error, vars) => {
    if (error.status === 409) {
      toast.push({
        kind: 'error',
        message: `"${vars.project.name}" was changed by someone else, so it was not moved. The latest order is shown; try again.`,
      });
      return;
    }
    toast.push({
      kind: 'error',
      message: `Could not move "${vars.project.name}": ${error.message} The change was reverted.`,
    });
  });
  const deleteMutation = useDeleteProject();
  const restoreMutation = useRestoreProject();

  const open = useCallback(
    (id: string) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('project', id);
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const close = useCallback(() => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('project');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const patch = useCallback(
    (project: Project, body: ProjectPatch, options?: PatchOptions) => {
      patchMutation.mutate(
        { project, patch: body },
        {
          onSuccess: () => {
            if (options?.successMessage) toast.push({ message: options.successMessage });
          },
        },
      );
    },
    [patchMutation, toast],
  );

  const changeStage = useCallback(
    (project: Project, stageId: number) => {
      if (stageId === project.stage_id) return;
      const stage = stages.find((s) => s.id === stageId);
      if (stage?.name === DONE_STAGE && !project.actual_date) {
        setDoneDate(today);
        setDonePrompt({ project, stageId });
        return;
      }
      patch(project, { stage_id: stageId });
    },
    [stages, patch, today],
  );

  const reorder = useCallback(
    async (project: Project, target: ReorderTarget): Promise<void> => {
      if (project.number === null) return;
      try {
        await reorderMutation.mutateAsync({
          project,
          move: {
            id: project.id,
            fromCategory: project.category,
            fromNumber: project.number,
            ...target,
          },
        });
      } catch {
        /* reported by the mutation's onError (toast + rollback) */
      }
    },
    [reorderMutation],
  );

  const chooseCategory = useCallback((project: Project) => {
    setMoveTarget(CATEGORIES.find((c) => c !== project.category) ?? 'current');
    setMoving(project);
  }, []);

  const remove = useCallback((project: Project) => setDeleting(project), []);

  const confirmDelete = (): void => {
    const project = deleting;
    if (!project) return;
    setDeleting(null);
    deleteMutation.mutate(project, {
      onSuccess: () => {
        if (searchParams.get('project') === project.id) close();
        toast.push({
          message: `Deleted "${project.name}".`,
          action: {
            label: 'Undo',
            onClick: () =>
              restoreMutation.mutate(project.id, {
                onSuccess: () => toast.push({ message: `Restored "${project.name}".` }),
                onError: (error) =>
                  toast.push({
                    kind: 'error',
                    message: `Could not restore "${project.name}": ${error.message}`,
                  }),
              }),
          },
          durationMs: 10000,
        });
      },
      onError: (error) =>
        toast.push({
          kind: 'error',
          message: `Could not delete "${project.name}": ${error.message}`,
        }),
    });
  };

  const actions = useMemo<Actions>(
    () => ({ open, close, patch, changeStage, reorder, chooseCategory, remove }),
    [open, close, patch, changeStage, reorder, chooseCategory, remove],
  );

  const donePromptError =
    donePrompt && doneDate && doneDate > today ? 'Actual date cannot be in the future.' : null;

  return (
    <ActionsContext.Provider value={actions}>
      {children}

      <Overlay
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        variant="dialog"
        title="Delete project?"
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
          <strong>{deleting?.name}</strong> will be removed from the list. You can undo this right
          after.
        </p>
      </Overlay>

      <Overlay
        open={moving !== null}
        onClose={() => setMoving(null)}
        variant="dialog"
        title="Move to category"
        footer={
          <>
            <Button onClick={() => setMoving(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                const project = moving;
                if (!project) return;
                setMoving(null);
                void reorder(project, { category: moveTarget }).then(() =>
                  toast.push({
                    message: `Moved "${project.name}" to ${CATEGORY_LABELS[moveTarget]}.`,
                  }),
                );
              }}
            >
              Move
            </Button>
          </>
        }
      >
        <p className={styles.text}>
          <strong>{moving?.name}</strong> is in {moving ? CATEGORY_LABELS[moving.category] : ''}. It
          will be placed at the end of the category you choose.
        </p>
        <fieldset className={styles.choices}>
          <legend className={styles.legend}>Category</legend>
          {CATEGORIES.filter((c) => c !== moving?.category).map((c) => (
            <label key={c} className={styles.choice}>
              <input
                type="radio"
                name="move-category"
                value={c}
                checked={moveTarget === c}
                onChange={() => setMoveTarget(c)}
              />
              <span>{CATEGORY_LABELS[c]}</span>
            </label>
          ))}
        </fieldset>
      </Overlay>

      <Overlay
        open={donePrompt !== null}
        onClose={() => setDonePrompt(null)}
        variant="dialog"
        title="Mark as done"
        footer={
          <>
            <Button onClick={() => setDonePrompt(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!doneDate || donePromptError !== null}
              onClick={() => {
                if (!donePrompt) return;
                const { project, stageId } = donePrompt;
                setDonePrompt(null);
                patch(project, { stage_id: stageId, actual_date: doneDate });
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <p className={styles.text}>
          <strong>{donePrompt?.project.name}</strong> has no actual date. When was it completed?
        </p>
        <div className={styles.field}>
          <label htmlFor="done-date">Actual date</label>
          <DateField
            id="done-date"
            label="Actual date"
            value={doneDate}
            onChange={setDoneDate}
            max={today}
            hideClear
          />
        </div>
        {donePromptError && (
          <p className={styles.error} role="alert">
            {donePromptError}
          </p>
        )}
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
                  successMessage: 'Your change was applied on top of the latest version.',
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
              <strong>{conflict.latest.name}</strong> was updated by someone else while you were
              editing. The list now shows the latest data (version {conflict.latest.version}).
            </p>
            <p>Your change was not saved:</p>
            <ul className={styles.list}>
              {describePatch(conflict.vars.patch, stages, persons).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {conflict.latest.actual_date && (
              <p className={styles.muted}>
                Latest actual date: {formatDate(conflict.latest.actual_date)}
              </p>
            )}
          </div>
        )}
      </Overlay>
    </ActionsContext.Provider>
  );
}
