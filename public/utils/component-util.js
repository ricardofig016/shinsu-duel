import loadNavbar from "/components/navbar/script.js";
import loadCardVertical from "/components/unit-card-vertical/script.js";

const components = {
  navbar: { load: loadNavbar },
  "unit-card-vertical": { load: loadCardVertical },
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
