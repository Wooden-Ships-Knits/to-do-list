import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { ProjectActionsProvider } from './features/actions/ProjectActions';
import { TaskActionsProvider } from './features/subtasks/TaskActions';
import { DashboardPage } from './pages/DashboardPage';

const ImportPage = lazy(() =>
  import('./pages/ImportPage').then((m) => ({ default: m.ImportPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: true },
  },
});

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter>
            <ProjectActionsProvider>
              <TaskActionsProvider>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route
                    path="/import"
                    element={
                      <Suspense
                        fallback={
                          <p role="status" style={{ padding: 16 }}>
                            Loading...
                          </p>
                        }
                      >
                        <ImportPage />
                      </Suspense>
                    }
                  />
                  <Route path="*" element={<DashboardPage />} />
                </Routes>
              </TaskActionsProvider>
            </ProjectActionsProvider>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
