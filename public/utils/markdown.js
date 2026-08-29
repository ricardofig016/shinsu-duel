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

const HEADING_PATTERN = /^(#{1,4})\s+(.+)$/;
const ORDERED_LIST_PATTERN = /^(\s*)\d+\.\s+(.+)$/;
const UNORDERED_LIST_PATTERN = /^(\s*)[*-]\s+(.+)$/;
const FENCE_PATTERN = /^\s*```/;
const CODE_PATTERN = /`([^`]+)`/g;
const TABLE_ROW_PATTERN = /^\s*\|/;
const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/g;
const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;
const EXTERNAL_LINK_PATTERN = /^https?:/i;

const renderInlineMarkdown = (text) => {
  const images = [];
  const withImageTokens = text.replace(IMAGE_PATTERN, (_, alt, src) => {
    images.push(`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`);
    return `@@IMGTOKEN${images.length - 1}@@`;
  });

  const links = [];
  const withLinkTokens = withImageTokens.replace(LINK_PATTERN, (_, label, href) => {
    const attributes = EXTERNAL_LINK_PATTERN.test(href)
      ? ' target="_blank" rel="noopener noreferrer"'
      : "";
    links.push(`<a href="${escapeHtml(href)}"${attributes}>${renderInlineMarkdown(label)}</a>`);
    return `@@LINKTOKEN${links.length - 1}@@`;
  });

  const codeSpans = [];
  const withCodeTokens = withLinkTokens.replace(CODE_PATTERN, (_, content) => {
    codeSpans.push(`<code>${escapeHtml(content)}</code>`);
    return `@@CODETOKEN${codeSpans.length - 1}@@`;
  });

  return escapeHtml(withCodeTokens)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/@@LINKTOKEN(\d+)@@/g, (_, index) => links[Number(index)])
    .replace(/@@CODETOKEN(\d+)@@/g, (_, index) => codeSpans[Number(index)])
    .replace(/@@IMGTOKEN(\d+)@@/g, (_, index) => images[Number(index)]);
};

const splitTableRow = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const isTableSeparatorRow = (cells) =>
  cells.length > 0 &&
  cells.some((cell) => cell !== "") &&
  cells.every((cell) => cell === "" || /^:?-+:?$/.test(cell));

export const renderRulesMarkdown = (markdown) => {
  const html = [];
  const lines = markdown.split(/\r?\n/);
  const openLists = [];
  const usedHeadingIds = new Set();
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map(renderInlineMarkdown).join("<br />")}</p>`);
    paragraph = [];
  };

  const closeLists = (targetDepth = 0) => {
    while (openLists.length > targetDepth) {
      html.push("</li>");
      html.push(`</${openLists[openLists.length - 1].tag}>`);
      openLists.pop();
    }
  };

  const openList = (tag, indent) => {
    html.push(`<${tag}>`);
    openLists.push({ tag, indent, items: 0 });
  };

  const listDepth = (indent) => {
    let depth = 1;
    while (depth <= openLists.length && openLists[depth - 1].indent < indent) depth += 1;
    return depth;
  };

  const renderListLine = (tag, indent, content) => {
    flushParagraph();
    const depth = listDepth(indent);
    if (openLists.length >= depth && openLists[depth - 1].tag !== tag) closeLists(depth - 1);
    while (openLists.length < depth) openList(tag, indent);
    closeLists(depth);
    if (openLists[depth - 1].items > 0) html.push("</li>");
    html.push(`<li>${renderInlineMarkdown(content)}`);
    openLists[depth - 1].items += 1;
  };

  const renderHeading = (level, text) => {
    flushParagraph();
    closeLists();

    const base = slugify(text) || "section";
    let id = base;
    let suffix = 1;
    while (usedHeadingIds.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    usedHeadingIds.add(id);

    html.push(`<h${level} id="${id}">${renderInlineMarkdown(text)}</h${level}>`);
    if (level === 2) html.push("<hr />");
  };

  const renderTable = (block) => {
    const rows = block.map(splitTableRow);

    html.push("<table>");
    html.push("<thead><tr>");
    rows[0].forEach((cell) => html.push(`<th>${renderInlineMarkdown(cell)}</th>`));
    html.push("</tr></thead>");
    html.push("<tbody>");
    rows.slice(2).forEach((cells) => {
      html.push("<tr>");
      cells.forEach((cell) => html.push(`<td>${renderInlineMarkdown(cell)}</td>`));
      html.push("</tr>");
    });
    html.push("</tbody>");
    html.push("</table>");
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (FENCE_PATTERN.test(line)) {
      flushParagraph();
      closeLists();
      const contentLines = [];
      let fenceEnd = index + 1;
      while (fenceEnd < lines.length && !FENCE_PATTERN.test(lines[fenceEnd])) {
        contentLines.push(lines[fenceEnd]);
        fenceEnd += 1;
      }
      html.push(`<pre><code>${escapeHtml(contentLines.join("\n"))}</code></pre>`);
      index = fenceEnd;
      continue;
    }

    if (TABLE_ROW_PATTERN.test(line)) {
      let blockEnd = index;
      while (blockEnd < lines.length && TABLE_ROW_PATTERN.test(lines[blockEnd])) blockEnd += 1;
      const block = lines.slice(index, blockEnd);

      if (block.length >= 2 && isTableSeparatorRow(splitTableRow(block[1]))) {
        flushParagraph();
        closeLists();
        renderTable(block);
      } else {
        block.forEach((row) => paragraph.push(row));
      }

      index = blockEnd - 1;
      continue;
    }

    const headingMatch = HEADING_PATTERN.exec(line);
    if (headingMatch) {
      renderHeading(headingMatch[1].length, headingMatch[2]);
      continue;
    }

    const orderedMatch = ORDERED_LIST_PATTERN.exec(line);
    if (orderedMatch) {
      renderListLine("ol", orderedMatch[1], orderedMatch[2]);
      continue;
    }

    const unorderedMatch = UNORDERED_LIST_PATTERN.exec(line);
    if (unorderedMatch) {
      renderListLine("ul", unorderedMatch[1], unorderedMatch[2]);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeLists();
      continue;
    }

    closeLists();
    paragraph.push(line);
  }

  flushParagraph();
  closeLists();

  return html.join("\n");
};
