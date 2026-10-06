import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useApp } from '@/state/app';
import { useChat } from '@/state/chat';
import { Sidebar } from '@/features/sidebar/Sidebar';
import { ChatPage } from '@/features/chat/ChatPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { ProjectDialog } from '@/features/projects/ProjectDialog';
import { SharePage } from '@/features/share/SharePage';
import { Toaster } from '@/components/ui/Toaster';
import { Logo } from '@/components/Icon';
import { Button } from '@/components/ui/Button';

const CodeWorkspace = lazy(() => import('@/features/code/CodeWorkspace').then((m) => ({ default: m.CodeWorkspace })));
const AdminPage = lazy(() => import('@/features/admin/AdminPage').then((m) => ({ default: m.AdminPage })));

function Splash() {
  return (
    <div className="flex h-full items-center justify-center">
      <Logo className="size-10 animate-pulse" />
    </div>
  );
}

function Shell() {
  const navigate = useNavigate();
  const devWarning = useApp((s) => s.config?.devWarning);
  const isAdmin = useApp((s) => s.session?.isAdmin);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        useChat.getState().newChat();
        navigate('/');
      }
      if (mod && e.key === ',') {
        e.preventDefault();
        useApp.getState().openSettings('general');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
  return (
    <div className="flex h-full flex-col">
      {devWarning && <div className="shrink-0 bg-warn/15 px-4 py-1.5 text-center text-xs text-warn">{devWarning}</div>}
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1">
          <Suspense fallback={<Splash />}>
            <Routes>
              <Route path="/" element={<ChatPage />} />
              <Route path="/c/:id" element={<ChatPage />} />
              <Route path="/code" element={<CodeWorkspace />} />
              <Route path="/admin" element={isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      <SettingsDialog />
      <ProjectDialog />
    </div>
  );
}

export function App() {
  const booted = useApp((s) => s.booted);
  const bootError = useApp((s) => s.bootError);
  const session = useApp((s) => s.session);
  const boot = useApp((s) => s.boot);
  useEffect(() => void boot(), [boot]);

  if (location.pathname.startsWith('/share/'))
    return (
      <>
        {booted ? (
          <Routes>
            <Route path="/share/:id" element={<SharePage />} />
          </Routes>
        ) : (
          <Splash />
        )}
      </>
    );

  return (
    <>
      {!booted ? (
        <Splash />
      ) : bootError ? (
        <div className="flex h-full items-center justify-center p-6">
          <div className="max-w-md rounded-3xl border border-line bg-panel p-6 text-center">
            <AlertTriangle className="mx-auto mb-3 size-8 text-warn" />
            <h1 className="font-semibold">Can't connect to the Lumora server</h1>
            <p className="mt-2 text-sm text-muted">{bootError}</p>
            <Button className="mt-4" variant="primary" onClick={() => location.reload()}>
              Retry
            </Button>
          </div>
        </div>
      ) : session?.authenticated ? (
        <Shell />
      ) : (
        <LoginPage />
      )}
      <Toaster />
    </>
  );
}
