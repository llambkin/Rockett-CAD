import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ConfirmPanel } from "./components/ConfirmPanel";
import "./features/core";
import "./commands/design";
import { THEME_TOKENS, applyTheme, followAppearance } from "./theme/tokens";
import "./theme.css";

applyTheme(THEME_TOKENS);
followAppearance();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <ConfirmPanel />
  </React.StrictMode>,
);
