import React from 'react';
import { createRoot } from "react-dom/client";
import App from './App';

declare global {
  interface Window {
    SERVER_DATA: any;
  }
}

// document.querySelector('#loading')!.remove();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App serverData={window.SERVER_DATA} />
  </React.StrictMode>
);
