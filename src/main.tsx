import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {reloadWhenCodeIsStale} from './utils/staleCode';

reloadWhenCodeIsStale();
createRoot(document.getElementById('root')!).render(<App />);
