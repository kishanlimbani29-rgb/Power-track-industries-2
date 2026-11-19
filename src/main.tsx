import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => { if ((e as TouchEvent).touches.length > 1) e.preventDefault(); }, { passive: false });

createRoot(document.getElementById('root')!).render(<App />);
