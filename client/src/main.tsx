import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { THEME_TOKENS, applyTheme } from "./theme/tokens";
import "./theme.css";

applyTheme(THEME_TOKENS);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
