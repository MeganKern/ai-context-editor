import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/400-italic.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource-variable/source-serif-4/opsz.css";
import { App } from "./App";
import { HelpRoot } from "./help/Help";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <HelpRoot />
  </StrictMode>
);
