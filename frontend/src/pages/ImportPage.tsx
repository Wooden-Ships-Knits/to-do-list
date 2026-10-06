import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, useImportCsv } from '../api/hooks';
import type { ImportReport } from '../api/types';
import { Button } from '../components/ui/Button';
import { formatDate } from '../lib/dates';
import styles from './ImportPage.module.css';

const COLUMNS =
  'Category, Project, Description, Stage, Status Notes, Ongoing Issue, Plan Date, Adjusted Plan Date, Actual Date, Projected Start, Deadline Note, PIC';

export function ImportPage() {
  const input = useRef<HTMLInputElement>(null);
  const importer = useImportCsv();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const check = (chosen: File): void => {
    setFile(chosen);
    setReport(null);
    setFileError(null);
    setDone(null);
    importer.mutate(
      { file: chosen, dryRun: true },
      {
        onSuccess: setReport,
        onError: (error: unknown) =>
          setFileError(error instanceof ApiError ? error.message : 'Could not read the file.'),
      },
    );
  };

  const confirm = (): void => {
    if (!file) return;
    importer.mutate(
      { file, dryRun: false },
      {
        onSuccess: (result) => setDone(result.imported),
        onError: (error: unknown) => {
          if (error instanceof ApiError && error.code === 'import_validation_failed') {
            setReport(error.details as ImportReport);
          }
          setFileError(error instanceof ApiError ? error.message : 'Import failed.');
        },
      },
    );
  };

  const reset = (): void => {
    setFile(null);
    setReport(null);
    setFileError(null);
    setDone(null);
    if (input.current) input.current.value = '';
  };

  const canImport =
    report !== null && report.error_rows === 0 && report.total_rows > 0 && done === null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.back}>
          Back to projects
        </Link>
        <h1>Import projects from CSV</h1>
      </header>

      <section className={styles.card} aria-labelledby="step1">
        <h2 id="step1">1. Choose a file</h2>
        <p className={styles.muted}>
          Columns: {COLUMNS}. Only Category and Project are required. Dates can be YYYY-MM-DD or
          &quot;Tue, Oct 06, 26&quot;; leave blank or write TBD for no date. Separate several PICs
          with a semicolon. Exports from this app can be imported again.
        </p>
        <label className={styles.file}>
          <span>CSV file</span>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) check(chosen);
            }}
          />
        </label>
        {importer.isPending && !report && <p role="status">Checking file...</p>}
        {fileError && (
          <p className={styles.error} role="alert">
            {fileError}
          </p>
        )}
      </section>

      {report && (
        <section className={styles.card} aria-labelledby="step2">
          <h2 id="step2">2. Review</h2>
          <p role="status" data-testid="import-summary">
            {report.total_rows} {report.total_rows === 1 ? 'row' : 'rows'}: {report.valid_rows}{' '}
            valid, {report.error_rows} with errors.
            {report.ignored_columns.length > 0 &&
              ` Ignored columns: ${report.ignored_columns.join(', ')}.`}
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Result</th>
                  <th>Project</th>
                  <th>Category</th>
                  <th>Stage</th>
                  <th>Plan date</th>
                  <th>PIC</th>
                  <th>Problems</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.row} className={row.valid ? '' : styles.bad} data-valid={row.valid}>
                    <td className="num">{row.row}</td>
                    <td>{row.valid ? 'OK' : 'Error'}</td>
                    <td>{row.data.name}</td>
                    <td>{row.data.category}</td>
                    <td>{row.data.stage}</td>
                    <td className="num">{formatDate(row.data.plan_date)}</td>
                    <td>{row.data.pics.length ? row.data.pics.join(', ') : 'TBD'}</td>
                    <td>
                      {row.errors.map((e) => (
                        <div key={`${e.field}-${e.message}`}>
                          {e.field ? `${e.field}: ` : ''}
                          {e.message}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {report && done === null && (
        <section className={styles.actions}>
          <Button
            variant="primary"
            disabled={!canImport || importer.isPending}
            onClick={confirm}
            data-testid="confirm-import"
          >
            Import {report.valid_rows} {report.valid_rows === 1 ? 'project' : 'projects'}
          </Button>
          <Button onClick={reset}>Choose another file</Button>
          {report.error_rows > 0 && (
            <span className={styles.error}>
              Fix the rows with errors and upload the file again. Nothing is imported until every
              row is valid.
            </span>
          )}
        </section>
      )}

      {done !== null && (
        <section className={styles.card} role="status" data-testid="import-done">
          <h2>Import complete</h2>
          <p>
            {done} {done === 1 ? 'project was' : 'projects were'} added.
          </p>
          <div className={styles.actions}>
            <Link to="/" className={styles.back}>
              Back to projects
            </Link>
            <Button onClick={reset}>Import another file</Button>
          </div>
        </section>
      )}
    </div>
  );
}
