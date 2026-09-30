import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./features/core";
import { THEME_TOKENS, applyTheme, followAppearance } from "./theme/tokens";
import "./theme.css";

applyTheme(THEME_TOKENS);
followAppearance();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
