import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { NotificationsProvider } from './components/notifications';
import '../index.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');

createRoot(root).render(
  <StrictMode>
    <NotificationsProvider>
      <App />
    </NotificationsProvider>
  </StrictMode>,
);
