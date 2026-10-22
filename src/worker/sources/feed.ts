import { XMLParser } from "fast-xml-parser";

// Minimal RSS 2.0 / Atom reader.

export type FeedEntry = {
  id: string;
  title: string;
  link?: string;
  /** HTML body (description / content:encoded / Atom content). */
  html: string;
  published?: Date;
  /** Atom <author> uri or name. For counting independent authors only; never stored. */
  author?: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  htmlEntities: true,
  // Feeds embed HTML; keep tags inside descriptions as text.
  stopNodes: ["*.description", "*.content:encoded", "*.content", "*.summary"],
});

type Node = string | number | { "#text"?: string; "@_href"?: string; "@_rel"?: string } | undefined;

const text = (n: Node): string =>
  n === undefined ? "" : typeof n === "object" ? String(n["#text"] ?? "") : String(n);

const list = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

const stripCdata = (s: string) => s.replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "");

function date(s: string): Date | undefined {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function atomLink(links: Node | Node[]): string | undefined {
  const all = list(links as Node);
  const alt = all.find((l) => typeof l === "object" && (!l["@_rel"] || l["@_rel"] === "alternate"));
  return typeof alt === "object" ? alt["@_href"] : undefined;
}

function atomAuthor(a: Node | Record<string, Node>): string | undefined {
  if (!a || typeof a !== "object") return undefined;
  const rec = a as Record<string, Node>;
  return (text(rec.uri) || text(rec.name)).trim() || undefined;
}

export function parseFeed(xml: string): FeedEntry[] {
  const doc = parser.parse(xml);
  if (doc.rss) {
    return list(doc.rss.channel?.item).map((it: Record<string, Node>) => {
      const link = stripCdata(text(it.link)).trim();
      return {
        // Link first: TPER gives every item the same non-permalink guid.
        id: link || stripCdata(text(it.guid)).trim(),
        title: stripCdata(text(it.title)).trim(),
        link: link || undefined,
        html: decodeEscapedHtml(stripCdata(text(it["content:encoded"]) || text(it.description))),
        published: date(text(it.pubDate)),
      };
    });
  }
  if (doc.feed) {
    return list(doc.feed.entry).map((e: Record<string, Node>) => ({
      id: text(e.id).trim(),
      title: text(e.title).trim(),
      link: atomLink(e.link),
      html: decodeEscapedHtml(text(e.content) || text(e.summary)),
      published: date(text(e.published) || text(e.updated)),
      author: atomAuthor(e.author),
    }));
  }
  return [];
}

// Atom content type="html" and some RSS bodies (Carlino, TPER) are entity-escaped HTML;
// with stopNodes they stay escaped. Unescape once, only when it is escaped markup.
function decodeEscapedHtml(s: string): string {
  if (!/&lt;\/?[a-z]/i.test(s)) return s;
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
