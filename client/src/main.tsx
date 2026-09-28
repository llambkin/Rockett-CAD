import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { THEME_TOKENS, applyTheme, followPreviewTint } from "./theme/tokens";
import "./theme.css";

applyTheme(THEME_TOKENS);
followPreviewTint();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
