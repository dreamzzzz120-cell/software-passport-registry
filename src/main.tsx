import React from 'react';
import ReactDOM from 'react-dom/client';
import LazyApp from './LazyApp';
import './index.css';
import './styles/spr-shell.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LazyApp />
  </React.StrictMode>,
);
