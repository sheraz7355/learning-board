import { createRoot } from 'react-dom/client';
import App from './App';
import './app.css';

// No StrictMode: it mounts the board twice in development, which only costs speed here.
createRoot(document.getElementById('root')!).render(<App />);
