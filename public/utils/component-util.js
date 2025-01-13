import loadNavbar from "/components/navbar/script.js";
import loadCardVertical from "/components/card-vertical/script.js";

const components = {
  navbar: { load: loadNavbar },
  "card-vertical": { load: loadCardVertical },
};

export const loadComponent = async (component, data = null) => {
  // console.log(`Loading component: ${component}`);
  if (!components[component]) return;

  if (!components[component].html) {
    const response = await fetch(`/components/${component}/index.html`);
    components[component].html = await response.text();
  }
  // console.log(components[component].html);

  const componentContainers = document.querySelectorAll(`.${component}-component`);
  for (const container of componentContainers) {
    container.innerHTML = components[component].html;
    await components[component].load(container, data);
  }
  // console.log(`Component loaded: ${component}`);
};

export const loadComponents = async () => {
  for (const component in components) {
    await loadComponent(component);
  }
};
