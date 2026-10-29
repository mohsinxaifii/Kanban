import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.jsx';
import { applyTheme } from './theme.js';

applyTheme();

createRoot(document.getElementById('root')).render(<App />);
