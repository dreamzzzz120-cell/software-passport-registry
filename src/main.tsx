import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './styles/spr-shell.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('SPR bootstrap failed: #root element is missing from index.html');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
