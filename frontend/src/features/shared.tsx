import { Button } from '../components/ui/Button';
import styles from './shared.module.css';

export function EmptyState({
  filtered,
  onClear,
  onAdd,
}: {
  filtered: boolean;
  onClear: () => void;
  onAdd: () => void;
}) {
  return (
    <div className={styles.state} data-testid="empty-state">
      <h2>{filtered ? 'No projects match these filters' : 'No projects yet'}</h2>
      <p>
        {filtered
          ? 'Try removing a filter or searching for something else.'
          : 'Add the first project to start tracking work.'}
      </p>
      {filtered ? (
        <Button onClick={onClear}>Clear filters</Button>
      ) : (
        <Button variant="primary" onClick={onAdd}>
          Add project
        </Button>
      )}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.state} role="alert" data-testid="error-state">
      <h2>Could not load projects</h2>
      <p>{message}</p>
      <Button variant="primary" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
