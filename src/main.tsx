import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './styles/spr-shell.css';
import './styles/command-center.css';
import { installPageViewTracking } from './analytics';

const root = document.getElementById('root');

if (!root) {
  throw new Error('SPR bootstrap failed: #root element is missing from index.html');
}

installPageViewTracking();

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
