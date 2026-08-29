import { loadComponent } from "/utils/component-util.js";
import { renderRulesMarkdown } from "/utils/markdown.js";

const VIEWS = {
  learn: {
    buttonId: "learn-tab-button",
    panelId: "learn-panel",
    endpoint: "/rules/guide/content",
    failureMessage: "Failed to load the guide.",
  },
  full: {
    buttonId: "full-tab-button",
    panelId: "full-panel",
    endpoint: "/rules/content",
    failureMessage: "Failed to load the rules.",
  },
};

const selectView = (view, { updateUrl = true } = {}) => {
  for (const [name, config] of Object.entries(VIEWS)) {
    document.getElementById(config.buttonId).classList.toggle("active", name === view);
    document.getElementById(config.panelId).classList.toggle("hidden", name !== view);
  }
  if (updateUrl) {
    window.history.replaceState(null, "", view === "full" ? "/rules?view=full" : "/rules");
  }
};

const loadView = async (view) => {
  const config = VIEWS[view];
  const panel = document.getElementById(config.panelId);
  try {
    const response = await fetch(config.endpoint);
    if (!response.ok) throw new Error(`${config.endpoint} responded ${response.status}`);
    panel.innerHTML = renderRulesMarkdown(await response.text());
  } catch (error) {
    console.error(error);
    panel.textContent = config.failureMessage;
  }
};

const resolveInitialView = () =>
  new URLSearchParams(window.location.search).get("view") === "full" ? "full" : "learn";

const scrollToHashTarget = () => {
  if (!window.location.hash) return;
  const target = document.getElementById(window.location.hash.slice(1));
  if (target) target.scrollIntoView();
};

document.addEventListener("DOMContentLoaded", async () => {
  await loadComponent(document.getElementById("navbar-component"), "navbar");

  for (const [view, config] of Object.entries(VIEWS)) {
    document.getElementById(config.buttonId).addEventListener("click", () => selectView(view));
  }

  await Promise.all(Object.keys(VIEWS).map(loadView));
  selectView(resolveInitialView(), { updateUrl: false });
  scrollToHashTarget();
});
