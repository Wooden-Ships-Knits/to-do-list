import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { ProjectActionsProvider } from './features/actions/ProjectActions';
import { RequireAuth, UnauthorizedRedirect } from './features/auth/AuthGate';
import { TaskActionsProvider } from './features/subtasks/TaskActions';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';

const ImportPage = lazy(() =>
  import('./pages/ImportPage').then((m) => ({ default: m.ImportPage })),
);
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const NotesPage = lazy(() => import('./pages/NotesPage').then((m) => ({ default: m.NotesPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: true },
  },
});

function Lazy({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <p role="status" style={{ padding: 16 }}>
          Loading...
        </p>
      }
    >
      {children}
    </Suspense>
  );
}

/** Everything behind the login. */
function AppRoutes() {
  return (
    <RequireAuth>
      <ProjectActionsProvider>
        <TaskActionsProvider>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route
              path="/import"
              element={
                <Lazy>
                  <ImportPage />
                </Lazy>
              }
            />
            <Route
              path="/users"
              element={
                <Lazy>
                  <UsersPage />
                </Lazy>
              }
            />
            {['/notes', '/notes/:noteId'].map((path) => (
              <Route
                key={path}
                path={path}
                element={
                  <Lazy>
                    <NotesPage />
                  </Lazy>
                }
              />
            ))}
            <Route path="*" element={<DashboardPage />} />
          </Routes>
        </TaskActionsProvider>
      </ProjectActionsProvider>
    </RequireAuth>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter>
            <UnauthorizedRedirect />
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/change-password" element={<ChangePasswordPage />} />
              <Route path="/*" element={<AppRoutes />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
