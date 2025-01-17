import loadNavbar from "/components/navbar/script.js";
import loadTooltip from "/components/tooltip/script.js";
import loadUnitCardVertical from "/components/unit-card-vertical/script.js";

const components = {
  navbar: { load: loadNavbar },
  tooltip: { load: loadTooltip },
  "unit-card-vertical": { load: loadUnitCardVertical },
};

export const loadComponent = async (container, component, data = null) => {
  if (!components[component] || !container) return;

  if (!components[component].html) {
    const response = await fetch(`/components/${component}/index.html`);
    components[component].html = await response.text();
  }

  container.innerHTML = components[component].html;
  await components[component].load(container, data);
};
