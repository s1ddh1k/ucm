import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app";
import "./globals.css";
// Register persistent PTY event listeners before any component mounts
import "./stores/terminal";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
