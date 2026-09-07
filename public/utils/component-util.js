import loadNavbar from "/components/navbar/script.js";
import loadTooltip from "/components/tooltip/script.js";
import loadUnitCardHorizontal from "/components/unit-card-horizontal/script.js";
import loadCardVertical from "/components/card-vertical/script.js";

const components = {
  navbar: { load: loadNavbar },
  tooltip: { load: loadTooltip },
  "unit-card-horizontal": { load: loadUnitCardHorizontal },
  "card-vertical": { load: loadCardVertical },
};

/**
 * Load a component's markup into the container and run its renderer.
 * The container must be attached to the document: components that measure
 * their layout while rendering (font fitting, overflow checks) need real
 * geometry, and a detached container measures as zero in every direction.
 */
export const loadComponent = async (container, component, data = null) => {
  if (!components[component] || !container) console.error("Invalid component or container");

  if (!components[component].html) {
    const response = await fetch(`/components/${component}/index.html`);
    components[component].html = await response.text();
  }

  container.innerHTML = components[component].html;
  await components[component].load(container, data);
};

export const addTooltip = async (container, hoverContainer, title, textList, iconPath = null) => {
  const tooltipComponent = document.createElement("div");
  tooltipComponent.classList.add("tooltip-component");
  container.appendChild(tooltipComponent);
  await loadComponent(tooltipComponent, "tooltip", { hoverContainer, title, textList, iconPath });
};

/**
 * Shrink the font size of the elements until the caller's overflow test stops
 * firing, starting at `max` em and stepping down to `min`. When the floor is
 * reached and content still overflows, the caller's CSS (ellipsis, clipping)
 * takes over. All sizes are in em relative to each element's parent.
 */
export const fitFontSize = (elements, isOverflowing, { max = 2, min = 0.8, step = 0.2 } = {}) => {
  if (elements.length === 0) return;
  const setFontSize = (size) => {
    for (const element of elements) element.style.fontSize = `${size}em`;
  };
  setFontSize(max);
  let size = max;
  while (size > min && isOverflowing()) {
    size = Math.max(min, size - step);
    setFontSize(size);
  }
};
