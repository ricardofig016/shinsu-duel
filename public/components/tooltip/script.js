const load = async (container, { hoverContainer, title, text, iconPath = null }) => {
  if (!iconPath) container.querySelector(".tooltip-icon").style.display = "none";
  if (iconPath) container.querySelector(".tooltip-icon").src = iconPath;
  container.querySelector(".tooltip-title").innerText = title;
  container.querySelector(".tooltip-text").innerText = text;

  const tooltipFrame = container.querySelector(".tooltip-frame");
  hoverContainer.addEventListener("mousemove", (event) => {
    if (event.pageY > window.innerHeight / 2) {
      tooltipFrame.style.top = `${event.pageY - tooltipFrame.offsetHeight - 5}px`;
      tooltipFrame.style.left = `${event.pageX + 5}px`;
    } else {
      tooltipFrame.style.top = `${event.pageY + 10}px`;
      tooltipFrame.style.left = `${event.pageX + 10}px`;
    }
  });
  hoverContainer.addEventListener("mouseover", () => tooltipFrame.classList.add("active"));
  hoverContainer.addEventListener("mouseout", () => tooltipFrame.classList.remove("active"));
};

export default load;
