import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { api } from "./api";
import { ConfirmPanel } from "./components/ConfirmPanel";
import "./features/core";
import "./commands/design";
import { clientModules } from "../../modules/index.client";
import { loadClientModules } from "./modules/host";
import { useSession } from "./session";
import { THEME_TOKENS, applyTheme, followAppearance } from "./theme/tokens";
import "./theme.css";

applyTheme(THEME_TOKENS);
followAppearance();

const stopWaiting = useSession.subscribe((session) => {
  if (session.kind !== "signed-in") return;
  stopWaiting();
  void loadClientModules(clientModules, api.modules);
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <ConfirmPanel />
  </React.StrictMode>,
);
