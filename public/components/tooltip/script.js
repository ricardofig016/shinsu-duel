const load = async (container, { hoverContainer, title, text, iconPath = null }) => {
  if (!iconPath) container.querySelector(".tooltip-icon").remove();
  else container.querySelector(".tooltip-icon").src = iconPath;
  container.querySelector(".tooltip-title").innerText = title;
  container.querySelector(".tooltip-text").innerText = text;

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
