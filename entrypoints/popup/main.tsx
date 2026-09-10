import { createRoot } from 'react-dom/client';
import { SupabaseAuthProvider } from './lib/SupabaseAuthContext';
import { AuthGate } from './components/AuthGate';
import App from './App';

function Root() {
  return (
    <SupabaseAuthProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </SupabaseAuthProvider>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<Root />);