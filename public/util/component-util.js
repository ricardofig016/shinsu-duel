import loadNavbar from "/components/navbar/script.js";

const components = {
  navbar: { load: loadNavbar },
};

export const loadComponent = async (component) => {
  console.log(`Loading ${component}...`);
  if (!components[component]) return;

  if (!components[component].html) {
    const response = await fetch(`/components/${component}/index.html`);
    components[component].html = await response.text();
    console.log(`${component} ready to load`);
  }

  const componentContainers = document.querySelectorAll(`.${component}-container`);
  for (const container of componentContainers) {
    container.innerHTML = components[component].html;
    await components[component].load(container);
  }
};