import { normalizeTooltipEntries } from "/utils/tooltip-entries.js";
import { renderSegments } from "/utils/card-text-dom.js";

/**
 * Render one tooltip. `container` is the tooltip component's own root, which
 * `addTooltip` mounts on the body so the frame's page coordinates match its
 * containing block. `bare` drops the frame chrome: the tooltip then shows its
 * entry node alone, which is how a card link's hover renders the card face.
 */
const load = async (container, {
  hoverContainer,
  title,
  textList,
  iconPath = null,
  bare = false,
}) => {
  const tooltipFrame = container.querySelector(".tooltip-frame");
  if (bare) tooltipFrame.classList.add("tooltip-frame-bare");

  const iconEl = container.querySelector(".tooltip-icon");
  const sanitizePath = (p) => {
    if (typeof p !== "string") return null;
    const s = p.trim();
    if (!s || s === "undefined" || s === "null") return null;
    // ensure absolute-ish path so browser won't resolve it under current page path
    if (!s.startsWith("/") && !s.startsWith("http://") && !s.startsWith("https://")) return `/${s}`;
    return s;
  };
  const safeIcon = sanitizePath(iconPath);
  if (!safeIcon) {
    if (iconEl) iconEl.remove();
  } else {
    if (iconEl) iconEl.src = safeIcon;
  }
  const titleEl = container.querySelector(".tooltip-title");
  if (titleEl) titleEl.innerText = title;

  // String payload is rendered as text content, so card names and ability
  // text can never inject markup; styled entries only ever add a class.
  // Segment entries render through the linked-text renderer, which builds
  // elements (never markup strings), and node entries are pre-built by the
  // caller — injection safety holds either way.
  const tooltipTextContainer = container.querySelector(".tooltip-text");
  tooltipTextContainer.replaceChildren(
    ...normalizeTooltipEntries(textList).map((entry) => {
      if (entry.node) return entry.node;
      const p = document.createElement("p");
      p.classList.add("tooltip-entry");
      if (entry.segments) p.replaceChildren(renderSegments(entry.segments));
      else p.textContent = entry.text;
      if (entry.style) p.classList.add(`tooltip-entry-${entry.style}`);
      return p;
    })
  );

  hoverContainer.addEventListener("mousemove", (event) => {
    const offset = 8;
    // The frame is absolutely positioned, so its coordinates belong to
    // whichever containing block it lands in. Measuring the frame parked at
    // 0,0 gives that block's origin, and placing the pointer relative to it
    // keeps the tooltip under the cursor in every host: on the body it lands
    // on the page origin, and in a host that positions or transforms its
    // subtree it lands on that ancestor. The frame is already on screen by the
    // time the pointer moves, so the measurement is real.
    tooltipFrame.style.top = "0px";
    tooltipFrame.style.left = "0px";
    const origin = tooltipFrame.getBoundingClientRect();
    // Which half of the screen the pointer is in is a viewport question.
    const x = event.clientX + (event.clientX > window.innerWidth / 2 ? -(tooltipFrame.offsetWidth + offset) : offset);
    const y = event.clientY + (event.clientY > window.innerHeight / 2 ? -(tooltipFrame.offsetHeight + offset) : offset);
    tooltipFrame.style.left = `${x - origin.left}px`;
    tooltipFrame.style.top = `${y - origin.top}px`;
  });
  hoverContainer.addEventListener("mouseover", () => tooltipFrame.classList.add("active"));
  hoverContainer.addEventListener("mouseout", () => tooltipFrame.classList.remove("active"));
};

export default load;
