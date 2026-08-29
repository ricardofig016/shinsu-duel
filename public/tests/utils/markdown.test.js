import { readFileSync } from "fs";
import { renderRulesMarkdown } from "../../utils/markdown.js";

const squash = (html) => html.replace(/\s+/g, "");

describe("renderRulesMarkdown", () => {
  describe("headings", () => {
    test("h1 through h4 render with slug ids and h2 adds a rule", () => {
      const html = renderRulesMarkdown("# Title\n## My Section\n### Sub\n#### Deep");
      expect(squash(html)).toBe(
        squash(
          '<h1 id="title">Title</h1><h2 id="my-section">My Section</h2><hr /><h3 id="sub">Sub</h3><h4 id="deep">Deep</h4>'
        )
      );
    });

    test("heading ids survive punctuation via slugify", () => {
      const html = renderRulesMarkdown("## Shinsu (and such)!");
      expect(squash(html)).toBe(squash('<h2 id="shinsu-and-such">Shinsu (and such)!</h2><hr />'));
    });

    test("duplicate headings get numeric suffixes in order", () => {
      const html = renderRulesMarkdown("## Attributes\n### Attributes\n### Attributes");
      expect(squash(html)).toContain(squash('<h2 id="attributes">'));
      expect(squash(html)).toContain(squash('<h3 id="attributes-1">'));
      expect(squash(html)).toContain(squash('<h3 id="attributes-2">'));
    });
  });

  describe("paragraphs", () => {
    test("consecutive lines join with <br />", () => {
      expect(renderRulesMarkdown("line one\nline two")).toBe("<p>line one<br />line two</p>");
    });

    test("blank lines split paragraphs and close open lists", () => {
      expect(renderRulesMarkdown("a\n\nb")).toBe("<p>a</p>\n<p>b</p>");
    });

    test("html special characters are escaped", () => {
      expect(renderRulesMarkdown('<b> & "x\' `y`')).toBe(
        "<p>&lt;b&gt; &amp; &quot;x&#039; <code>y</code></p>"
      );
    });
  });

  describe("inline formatting", () => {
    test("bold and italic render", () => {
      expect(renderRulesMarkdown("**bold** and _em_")).toBe(
        "<p><strong>bold</strong> and <em>em</em></p>"
      );
    });

    test("anchor links render without target attributes", () => {
      expect(renderRulesMarkdown("[text](#section)")).toBe('<p><a href="#section">text</a></p>');
    });

    test("external links open in a new tab", () => {
      expect(renderRulesMarkdown("[text](https://example.com)")).toBe(
        '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">text</a></p>'
      );
    });

    test("same-site path links do not open in a new tab", () => {
      expect(renderRulesMarkdown("[rules](/rules?view=full#shinsu)")).toBe(
        '<p><a href="/rules?view=full#shinsu">rules</a></p>'
      );
    });

    test("link labels keep inline formatting", () => {
      expect(renderRulesMarkdown("[**b**](#x)")).toBe('<p><a href="#x"><strong>b</strong></a></p>');
    });

    test("images render with escaped src and alt", () => {
      expect(renderRulesMarkdown('![<Alt> & "text"](/assets/board.png)')).toBe(
        '<p><img src="/assets/board.png" alt="&lt;Alt&gt; &amp; &quot;text&quot;" /></p>'
      );
    });

    test("images work inside list items and table cells", () => {
      const html = renderRulesMarkdown("- ![a](/a.png)\n\n| H |\n| --- |\n| ![b](/b.png) |");
      expect(squash(html)).toContain(squash('<li><img src="/a.png" alt="a" /></li>'));
      expect(squash(html)).toContain(squash('<td><img src="/b.png" alt="b" /></td>'));
    });
  });

  describe("inline code", () => {
    test("spans render as code elements", () => {
      expect(renderRulesMarkdown("Regain `x` shinsu")).toBe(
        "<p>Regain <code>x</code> shinsu</p>"
      );
    });

    test("code content is protected from bold and italic", () => {
      expect(renderRulesMarkdown("`**a** and _b_`")).toBe("<p><code>**a** and _b_</code></p>");
    });

    test("code content is escaped", () => {
      expect(renderRulesMarkdown('`<b> & "x"`')).toBe(
        "<p><code>&lt;b&gt; &amp; &quot;x&quot;</code></p>"
      );
    });

    test("multiple spans render on one line", () => {
      expect(renderRulesMarkdown("`a` and `b`")).toBe(
        "<p><code>a</code> and <code>b</code></p>"
      );
    });

    test("unbalanced backticks stay literal", () => {
      expect(renderRulesMarkdown("a ` b")).toBe("<p>a ` b</p>");
    });

    test("code works inside link labels and list items", () => {
      const html = renderRulesMarkdown("[use `Charge`](#charge)\n\n- **Charge `x`**: regain `x`");
      expect(squash(html)).toContain(squash('<a href="#charge">use <code>Charge</code></a>'));
      expect(squash(html)).toContain(
        squash("<li><strong>Charge <code>x</code></strong>: regain <code>x</code>")
      );
    });
  });

  describe("code blocks", () => {
    test("fenced blocks render as pre with content escaped raw", () => {
      expect(renderRulesMarkdown("```\n**a** <b>\n```")).toBe(
        "<pre><code>**a** &lt;b&gt;</code></pre>"
      );
    });

    test("the info string is ignored", () => {
      expect(renderRulesMarkdown("```md\nplain text\n```")).toBe(
        "<pre><code>plain text</code></pre>"
      );
    });

    test("multi-line content and blank lines are preserved", () => {
      expect(renderRulesMarkdown("```\none\n\ntwo\n```")).toBe(
        "<pre><code>one\n\ntwo</code></pre>"
      );
    });

    test("list-looking lines inside a block stay text", () => {
      const html = renderRulesMarkdown("```\n- not a list\n1. nor this\n```");
      expect(html).toBe("<pre><code>- not a list\n1. nor this</code></pre>");
      expect(html).not.toContain("<ul>");
      expect(html).not.toContain("<ol>");
    });

    test("an unclosed fence consumes to the end", () => {
      expect(renderRulesMarkdown("```\nstill code")).toBe("<pre><code>still code</code></pre>");
    });

    test("content after a closed block parses normally", () => {
      const html = renderRulesMarkdown("```\ncode\n```\n\n- a list");
      expect(squash(html)).toBe(squash("<pre><code>code</code></pre><ul><li>a list</li></ul>"));
    });
  });

  describe("lists", () => {
    test("ordered lists nest on 3-space indents", () => {
      const html = renderRulesMarkdown("1. one\n   1. two\n   2. three\n2. four");
      expect(squash(html)).toBe(
        squash("<ol><li>one<ol><li>two</li><li>three</li></ol></li><li>four</li></ol>")
      );
    });

    test("unordered lists nest on 2-space indents", () => {
      const html = renderRulesMarkdown("- a\n  - b\n  - c\n- d");
      expect(squash(html)).toBe(
        squash("<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>")
      );
    });

    test("unordered lists nest four levels on the table-of-contents indents", () => {
      const html = renderRulesMarkdown("- l1\n  - l2\n    - l3\n      - l4");
      expect(squash(html)).toBe(
        squash("<ul><li>l1<ul><li>l2<ul><li>l3<ul><li>l4</li></ul></li></ul></li></ul></li></ul>")
      );
    });

    test("a list tag change at the same depth closes the previous list", () => {
      const html = renderRulesMarkdown("1. one\n- two");
      expect(squash(html)).toBe(squash("<ol><li>one</li></ol><ul><li>two</li></ul>"));
    });

    test("a blank line restarts an ordered list", () => {
      const html = renderRulesMarkdown("1. a\n\n2. b");
      expect(squash(html)).toBe(squash("<ol><li>a</li></ol><ol><li>b</li></ol>"));
    });

    test("both unordered markers produce lists", () => {
      expect(squash(renderRulesMarkdown("- a\n* b"))).toBe(squash("<ul><li>a</li><li>b</li></ul>"));
    });

    test("list items keep inline formatting", () => {
      const html = renderRulesMarkdown("- **bold** [link](#x)");
      expect(squash(html)).toBe(
        squash('<ul><li><strong>bold</strong> <a href="#x">link</a></li></ul>')
      );
    });
  });

  describe("tables", () => {
    test("header, separator, and body rows render as a table", () => {
      const html = renderRulesMarkdown("| Name | Type |\n| --- | --- |\n| A | B |");
      expect(squash(html)).toBe(
        squash(
          "<table><thead><tr><th>Name</th><th>Type</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table>"
        )
      );
    });

    test("cells keep inline formatting and alignment modifiers are not rendered", () => {
      const html = renderRulesMarkdown(
        "| [Team](https://wiki.example) | Kind |\n| :--- | ---: |\n| [T](https://wiki.example) | Org |"
      );
      expect(squash(html)).toContain(squash('<th><a href="https://wiki.example"'));
      expect(squash(html)).toContain("<td>Org</td>");
      expect(squash(html)).not.toContain("---");
    });

    test("pipe lines without a separator row stay paragraphs", () => {
      expect(renderRulesMarkdown("| just one line")).toBe("<p>| just one line</p>");
    });
  });

  describe("RULES.md regression", () => {
    const rulesMarkdown = readFileSync(new URL("../../../RULES.md", import.meta.url), "utf-8");
    const rulesHtml = renderRulesMarkdown(rulesMarkdown);
    const renderedIds = () => [...rulesHtml.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);

    test("every in-file anchor resolves to a rendered heading id", () => {
      const targets = [...rulesMarkdown.matchAll(/\]\(#([^)]+)\)/g)].map((match) => match[1]);
      expect(targets.length).toBeGreaterThan(40);
      const ids = new Set(renderedIds());
      for (const target of targets) expect(ids.has(target)).toBe(true);
    });

    test("rendered heading ids are unique", () => {
      const ids = renderedIds();
      expect(new Set(ids).size).toBe(ids.length);
    });

    test("bullets and the affiliation table render as structures, not paragraph blobs", () => {
      expect(rulesHtml).toContain("<ul>");
      expect(rulesHtml).toContain("<table>");
      expect(rulesHtml).not.toContain("<p>- ");
      expect(rulesHtml).not.toContain("<p>|");
    });

    test("fenced blocks render and no fence markers leak into the output", () => {
      expect(rulesHtml.match(/<pre><code>/g).length).toBe(7);
      expect(rulesHtml).not.toContain("```");
    });

    test("ordered list nesting is preserved", () => {
      expect(squash(rulesHtml)).toContain("<li><strong>RoundStart</strong>:<ol>");
    });

    test("every guide link to the reference resolves to a rendered heading id", () => {
      const guide = readFileSync(new URL("../../../HOW_TO_PLAY.md", import.meta.url), "utf-8");
      const targets = [
        ...new Set([...guide.matchAll(/\/rules\?view=full#([a-z0-9-]+)/g)].map((match) => match[1])),
      ];
      expect(targets.length).toBeGreaterThan(4);
      const ids = new Set(renderedIds());
      for (const target of targets) expect(ids.has(target)).toBe(true);
    });
  });
});
