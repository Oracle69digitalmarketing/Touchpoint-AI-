
import React from 'react';
import ReactDOM from 'react-dom/client';
import PublicTouchpointChat from './components/PublicTouchpointChat';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <PublicTouchpointChat />
  </React.StrictMode>
);
