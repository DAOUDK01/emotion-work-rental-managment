import React from 'react';
import ReactDOM from 'react-dom/client';
import './lib/i18n';
import './index.css';
import App from './App';

// apply saved theme before first paint
try {
  if (localStorage.getItem('emf.theme') === 'dark') {
    document.documentElement.classList.add('dark');
  }
} catch {
  /* ignore */
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
