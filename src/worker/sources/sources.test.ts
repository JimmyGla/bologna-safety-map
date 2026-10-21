import { describe, expect, it } from "vitest";
import { parseFeed } from "./feed";
import { redditBody } from "./reddit";
import { isProtestDiversion, parseTelegramPreview, tperAdapter } from "./tper";
import type { AdapterContext } from "./types";

// Synthetic fixtures shaped like the real feeds (checked 2026-10-21).

const CARLINO_LIKE = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item>
  <title>Corteo in centro, traffico bloccato</title>
  <link>https://www.example-news.it/bologna/cronaca/corteo-centro-abc123</link>
  <description>Sintesi breve</description>
  <content:encoded>&lt;p&gt;Bologna, 21 ottobre –&amp;nbsp;Il corteo &lt;b&gt;ha raggiunto&lt;/b&gt; via Rizzoli.&lt;/p&gt;</content:encoded>
  <pubDate>Wed, 21 Oct 2026 07:28:17 GMT</pubDate>
  <guid>https://www.example-news.it/bologna/cronaca/corteo-centro-abc123</guid>
</item></channel></rss>`;

const REPUBBLICA_LIKE = `<rss version="2.0"><channel><item><title><![CDATA[Presidio in piazza]]></title><link><![CDATA[https://bologna.example.it/cronaca/2026/10/21/news/presidio-1/?rss]]></link><author><![CDATA[redazione@example.it (Redazione)]]></author><pubDate>Wed, 21 Oct 2026 10:12:36 +0200</pubDate><description><![CDATA[<p><img src="x.jpg"/></p>Testo del presidio]]></description></item></channel></rss>`;

const REDDIT_LIKE = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry>
  <author><name>/u/example_user</name><uri>https://www.reddit.com/user/example_user</uri></author>
  <category term="bologna" label="r/bologna"/>
  <content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Qualcuno sa perché c&amp;#39;è la polizia in via Irnerio?&lt;/p&gt;&lt;/div&gt;&lt;!-- SC_ON --&gt; &amp;#32; submitted by &amp;#32; &lt;a href=&quot;https://www.reddit.com/user/example_user&quot;&gt; /u/example_user &lt;/a&gt; &lt;br/&gt; &lt;span&gt;&lt;a href=&quot;https://www.reddit.com/r/bologna/comments/1abc/x/&quot;&gt;[link]&lt;/a&gt;&lt;/span&gt;</content>
  <id>t3_1abc</id>
  <link href="https://www.reddit.com/r/bologna/comments/1abc/polizia_in_via_irnerio/"/>
  <updated>2026-10-21T09:00:00+00:00</updated>
  <published>2026-10-21T09:00:00+00:00</published>
  <title>Polizia in via Irnerio?</title>
</entry></feed>`;

const TELEGRAM_LIKE = `<html><body><section class="tgme_channel_history">
<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="TperInfoViabilita/1481">
  <div class="tgme_widget_message_text js-message_text" dir="auto">** ATTENZIONE ***<br/>#Cortei, #manifestazioni e disordini stanno interessando le principali direttrici del centro di #Bologna.<br/>#RITARDI e salti di corse</div>
  <a class="tgme_widget_message_date" href="https://t.me/TperInfoViabilita/1481"><time datetime="2026-10-21T09:27:17+00:00" class="time">11:27</time></a>
</div></div>
<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="TperInfoViabilita/1484">
  <div class="tgme_widget_message_text js-message_text" dir="auto">#Savigno – chiusura per “Sagra”<br/>Causa svolgimento della manifestazione denominata “Festival del Tartufo”</div>
  <a class="tgme_widget_message_date"><time datetime="2026-10-21T08:15:43+00:00">10:15</time></a>
</div></div>
</section></body></html>`;

describe("parseFeed", () => {
  it("reads RSS with escaped HTML bodies (Carlino)", () => {
    const [e] = parseFeed(CARLINO_LIKE);
    expect(e.id).toBe("https://www.example-news.it/bologna/cronaca/corteo-centro-abc123");
    expect(e.published?.toISOString()).toBe("2026-10-21T07:28:17.000Z");
    expect(e.html).toContain("<b>ha raggiunto</b>");
  });

  it("reads RSS with CDATA (Repubblica), using the link as id", () => {
    const [e] = parseFeed(REPUBBLICA_LIKE);
    expect(e).toMatchObject({ title: "Presidio in piazza", id: "https://bologna.example.it/cronaca/2026/10/21/news/presidio-1/?rss" });
    expect(e.published?.toISOString()).toBe("2026-10-21T08:12:36.000Z");
  });

  it("reads Atom (Reddit)", () => {
    const [e] = parseFeed(REDDIT_LIKE);
    expect(e).toMatchObject({ id: "t3_1abc", link: "https://www.reddit.com/r/bologna/comments/1abc/polizia_in_via_irnerio/" });
  });
});

describe("reddit", () => {
  it("keeps the post body and drops the author footer", () => {
    const body = redditBody(parseFeed(REDDIT_LIKE)[0].html);
    expect(body).toBe("Qualcuno sa perché c'è la polizia in via Irnerio?");
    expect(body).not.toMatch(/example_user|submitted/);
  });
});

describe("tper", () => {
  it("parses the Telegram channel preview", () => {
    const posts = parseTelegramPreview(TELEGRAM_LIKE);
    expect(posts.map((p) => p.id)).toEqual(["TperInfoViabilita/1481", "TperInfoViabilita/1484"]);
    expect(posts[0].published?.toISOString()).toBe("2026-10-21T09:27:17.000Z");
    expect(posts[0].text).toContain("disordini stanno interessando");
  });

  it.each<[string, boolean]>([
    ["#Cortei e disordini nel centro di #Bologna, ritardi", true],
    ["#Bologna – deviazioni linee 11 e 27 per corteo in via Rizzoli", true],
    ["Deviazioni per manifestazione sindacale in piazza Maggiore", true],
    ["#Bologna – deviazione per presidio in via Stalingrado", true],
    ["#Savigno – chiusura per la manifestazione Festival del Tartufo", false],
    ["#Bologna – manifestazione podistica, chiusure in centro", false],
    ["#Molinella – corteo storico, chiusure", false],
    ["#Bologna – chiusura di via Novelli per lavori", false],
  ])("isProtestDiversion(%s) = %s", (text, expected) => {
    expect(isProtestDiversion(text)).toBe(expected);
  });

  it("turns stored diversions into rule-based blockade events", () => {
    const ctx = { now: () => new Date("2026-10-21T10:00:00Z") } as AdapterContext;
    const [ev] = tperAdapter.signals!(
      [{ id: 7, source: "tper", feed: "telegram", externalId: "tg:x/1", text: "#Bologna – deviazioni per corteo e disordini in Bolognina", publishedAt: new Date("2026-10-21T09:00:00Z") }],
      ctx,
    );
    expect(ev).toMatchObject({
      rawItemId: 7,
      source: "tper",
      sourceFeed: "tper:telegram",
      eventType: "blockade",
      severity: 2,
      sourceClass: "transit",
      extractor: "rules",
      locationNames: ["Bolognina"],
    });
    expect(ev.h3Cells!.length).toBeGreaterThan(0);
  });
});
