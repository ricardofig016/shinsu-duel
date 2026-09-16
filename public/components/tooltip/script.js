import { normalizeTooltipEntries } from "/utils/tooltip-entries.js";
import { renderSegments } from "/utils/card-text-dom.js";

const load = async (container, { hoverContainer, title, textList, iconPath = null }) => {
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
  container.querySelector(".tooltip-title").innerText = title;

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
      if (entry.segments) p.replaceChildren(renderSegments(entry.segments));
      else p.textContent = entry.text;
      if (entry.style) p.classList.add(`tooltip-text-${entry.style}`);
      return p;
    })
  );

  const tooltipFrame = container.querySelector(".tooltip-frame");
  hoverContainer.addEventListener("mousemove", (event) => {
    const offset = 8;
    let top = event.pageY;
    let left = event.pageX;
    if (event.pageY > window.innerHeight / 2) top -= tooltipFrame.offsetHeight + offset;
    else top += offset;
    if (event.pageX > window.innerWidth / 2) left -= tooltipFrame.offsetWidth + offset;
    else left += offset;
    tooltipFrame.style.top = `${top}px`;
    tooltipFrame.style.left = `${left}px`;
  });
  hoverContainer.addEventListener("mouseover", () => tooltipFrame.classList.add("active"));
  hoverContainer.addEventListener("mouseout", () => tooltipFrame.classList.remove("active"));
};

export default load;
