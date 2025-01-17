const load = async (container, { hoverContainer, title, text, iconPath = null }) => {
  if (!iconPath) container.querySelector(".tooltip-icon").style.display = "none";
  container.querySelector(".tooltip-icon").src = iconPath;
  container.querySelector(".tooltip-title").innerText = title;
  container.querySelector(".tooltip-text").innerText = text;

  const tooltipFrame = container.querySelector(".tooltip-frame");
  hoverContainer.addEventListener("mousemove", (event) => {
    tooltipFrame.style.left = `${event.pageX + 10}px`;
    tooltipFrame.style.top = `${event.pageY + 10}px`;
  });
  hoverContainer.addEventListener("mouseover", () => {
    tooltipFrame.classList.add("active");
  });
  hoverContainer.addEventListener("mouseout", () => {
    // setTimeout(() => tooltipFrame.classList.remove("active"), 200);
    tooltipFrame.classList.remove("active");
  });
};

export default load;
