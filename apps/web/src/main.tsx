import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { OverviewProvider } from './state/overview';
import { SessionProvider } from './state/session';
import { ToastProvider } from './state/toast';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('缺少 #root 挂载节点，请检查 index.html');
}

createRoot(container).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <ToastProvider>
          <OverviewProvider>
            <App />
          </OverviewProvider>
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
