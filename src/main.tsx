import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './styles/spr-shell.css';
import './styles/command-center.css';
import { installPageViewTracking } from './analytics';

const ExperienceAgent = lazy(() => import('./components/ExperienceAgent'));

const root = document.getElementById('root');

if (!root) {
  throw new Error('SPR bootstrap failed: #root element is missing from index.html');
}

installPageViewTracking();

function SprApplication() {
  return (
    <>
      <App />
      <Suspense fallback={null}>
        <ExperienceAgent />
      </Suspense>
    </>
  );
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <SprApplication />
  </React.StrictMode>,
);
