import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { preloadMarkdown } from './components/markdown/MarkdownView';
import './styles/global.css';

// Fetched in parallel with the first data request, so notes are formatted by the time rows show.
preloadMarkdown();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
