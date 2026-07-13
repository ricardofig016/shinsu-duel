import { loadComponent } from "/utils/component-util.js";

const escapeHtml = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const renderInlineMarkdown = (text) => {
  const links = [];
  const withLinkTokens = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const attributes = href.startsWith("#") ? "" : ' target="_blank" rel="noopener noreferrer"';
    links.push(`<a href="${escapeHtml(href)}"${attributes}>${renderInlineMarkdown(label)}</a>`);
    return `@@LINKTOKEN${links.length - 1}@@`;
  });

  return escapeHtml(withLinkTokens)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/@@LINKTOKEN(\d+)@@/g, (_, index) => links[Number(index)]);
};

const closeLists = (html, listStack, targetDepth = 0) => {
  while (listStack.length > targetDepth) {
    html.push("</ol>");
    listStack.pop();
  }
};

const renderRulesMarkdown = (markdown) => {
  const html = [];
  const listDepths = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map(renderInlineMarkdown).join("<br />")}</p>`);
    paragraph = [];
  };

  const closeLists = (targetDepth = 0) => {
    while (listDepths.length > targetDepth) {
      html.push("</li>");
      html.push("</ol>");
      listDepths.pop();
    }
  };

  markdown.split(/\r?\n/).forEach((line) => {
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      closeLists();

      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const id = level === 1 ? "" : ` id="${slugify(text)}"`;

      html.push(`<h${level}${id}>${renderInlineMarkdown(text)}</h${level}>`);
      if (level === 2) html.push("<hr />");
      return;
    }

    const listMatch = /^(\s*)\d+\.\s+(.+)$/.exec(line);
    if (listMatch) {
      flushParagraph();

      const depth = Math.floor(listMatch[1].length / 3) + 1;
      while (listDepths.length < depth) {
        html.push("<ol>");
        listDepths.push(0);
      }
      closeLists(depth);

      if (listDepths[depth - 1] > 0) html.push("</li>");

      html.push(`<li>${renderInlineMarkdown(listMatch[2])}`);
      listDepths[depth - 1] += 1;
      return;
    }

    if (!line.trim()) {
      flushParagraph();
      closeLists();
      return;
    }

    closeLists();
    paragraph.push(line);
  });

  flushParagraph();
  closeLists();

  return html.join("\n");
};

document.addEventListener("DOMContentLoaded", async () => {
  const navbarContainer = document.getElementById("navbar-component");
  const rulesContainer = document.getElementById("rules-container");

  await loadComponent(navbarContainer, "navbar");

  try {
    const response = await fetch("/rules/content");
    if (!response.ok) throw new Error(`Failed to load rules: ${response.status}`);

    rulesContainer.innerHTML = renderRulesMarkdown(await response.text());
  } catch (error) {
    console.error(error);
    rulesContainer.textContent = "Failed to load rules.";
  }
});
