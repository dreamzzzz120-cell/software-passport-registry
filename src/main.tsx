import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Analytics } from '@vercel/analytics/react';
import ExperienceAgent from './components/ExperienceAgent';
import SoftwareWorkspaceView from './components/SoftwareWorkspaceView';
import './index.css';
import './styles/spr-shell.css';
import './styles/command-center.css';
import { installPageViewTracking } from './analytics';

const root = document.getElementById('root');

if (!root) throw new Error('SPR bootstrap failed: #root element is missing from index.html');

installPageViewTracking();

function SprApplication() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return (<>{path === '/software/workspace' ? <SoftwareWorkspaceView /> : <><App /><ExperienceAgent /></>}<Analytics /></>);
}

ReactDOM.createRoot(root).render(<React.StrictMode><SprApplication /></React.StrictMode>);
