import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.jsx';
import { applyAppearance } from './theme.js';

applyAppearance();

createRoot(document.getElementById('root')).render(<App />);
