import { Navigate, Route, Routes } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import Invite from './pages/Invite';
import Home from './pages/Home';
import { useAuth } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';

function Guard({ children }) {
  const { auth, ready } = useAuth();
  if (!ready) {
    return <div className="h-full w-full grid place-items-center text-slate-400">Загрузка…</div>;
  }
  if (!auth) return <Navigate to="/login" replace />;
  return children;
}

function GuestOnly({ children }) {
  const { auth, ready } = useAuth();
  if (!ready) return null;
  if (auth) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route
          path="/login"
          element={
            <GuestOnly>
              <Login />
            </GuestOnly>
          }
        />
        <Route
          path="/register"
          element={
            <GuestOnly>
              <Register />
            </GuestOnly>
          }
        />
        <Route
          path="/invite/:code"
          element={
            <GuestOnly>
              <Invite />
            </GuestOnly>
          }
        />
        <Route
          path="/"
          element={
            <Guard>
              <Home />
            </Guard>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
