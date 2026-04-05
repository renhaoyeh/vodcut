import { createRoot } from 'react-dom/client';

function App() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <h2 className="text-2xl font-bold text-foreground">Hello from React!</h2>
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
