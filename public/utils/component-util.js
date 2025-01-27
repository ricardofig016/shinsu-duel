import loadNavbar from "/components/navbar/script.js";
import loadTooltip from "/components/tooltip/script.js";
import loadUnitCardHorizontal from "/components/unit-card-horizontal/script.js";
import loadUnitCardVertical from "/components/unit-card-vertical/script.js";

const components = {
  navbar: { load: loadNavbar },
  tooltip: { load: loadTooltip },
  "unit-card-horizontal": { load: loadUnitCardHorizontal },
  "unit-card-vertical": { load: loadUnitCardVertical },
};

export const loadComponent = async (container, component, data = null) => {
  if (!components[component] || !container) console.error("Invalid component or container");

  if (!components[component].html) {
    const response = await fetch(`/components/${component}/index.html`);
    components[component].html = await response.text();
  }

  container.innerHTML = components[component].html;
  await components[component].load(container, data);
};

export const addTooltip = async (container, hoverContainer, title, text, iconPath = null) => {
  const tooltipComponent = document.createElement("div");
  tooltipComponent.classList.add("tooltip-component");
  container.appendChild(tooltipComponent);
  await loadComponent(tooltipComponent, "tooltip", { hoverContainer, title, text, iconPath });
};
