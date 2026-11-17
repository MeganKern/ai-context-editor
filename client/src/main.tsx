import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/400-italic.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource-variable/source-serif-4/opsz.css";
import "./kit/kit.css";
import "./app/shell.css";
import "./features/workspace/workspace.css";
import "./features/llm/llm.css";
import "./features/threads/threads.css";
import "./features/conversation/conversation.css";
import "./features/composer/composer.css";
import "./features/library/library.css";
import "./features/templates/templates.css";
import "./features/inspector/inspector.css";
import "./features/help/help.css";
import { App } from "./app/App";
import { HelpRoot } from "./features/help/Help";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <HelpRoot />
  </StrictMode>
);
