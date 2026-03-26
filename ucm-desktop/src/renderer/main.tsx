import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app";
import "./globals.css";

// In web mode (no Electron preload), inject the fetch+WS API client
if (!window.ucm) {
  import("./api-client").then(({ createApiClient }) => {
    window.ucm = createApiClient();
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
} else {
  // Electron mode — preload already set window.ucm
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
