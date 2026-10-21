import { latLngToCell } from "h3-js";
import pino from "pino";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  adminConfigured,
  checkPassword,
  clearLoginFailures,
  createSessionToken,
  loginBlocked,
  recordLoginFailure,
  SESSION_MS,
  verifySessionToken,
} from "./admin-auth";
import { overrideInputSchema } from "./admin/overrides";
import { isStale, STALE_AFTER_MS } from "./freshness";
import { errInfo, REDACT_PATHS, safeErrorMessage } from "./log";
import { computeHealth } from "./health";
import { isReducedAccuracy, type ScoringEvent } from "./scoring";

const PASSWORD = "correct horse battery staple";
const NOW = Date.parse("2026-10-21T12:00:00Z");

describe("admin session", () => {
  it("accepts its own token until it expires", async () => {
    const token = await createSessionToken(PASSWORD, NOW);
    expect(await verifySessionToken(token, PASSWORD, NOW + 1000)).toBe(true);
    expect(await verifySessionToken(token, PASSWORD, NOW + SESSION_MS + 1)).toBe(false);
  });

  it("rejects forged, tampered or re-keyed tokens", async () => {
    const token = await createSessionToken(PASSWORD, NOW);
    const [exp, sig] = token.split(".");
    expect(await verifySessionToken(`${Number(exp) + 3_600_000}.${sig}`, PASSWORD, NOW)).toBe(false); // extended expiry
    expect(await verifySessionToken(`${exp}.${"0".repeat(64)}`, PASSWORD, NOW)).toBe(false);
    expect(await verifySessionToken(token, "another long password", NOW)).toBe(false); // password changed
    expect(await verifySessionToken(undefined, PASSWORD, NOW)).toBe(false);
    expect(await verifySessionToken("garbage", PASSWORD, NOW)).toBe(false);
  });

  it("is disabled without a long enough password", async () => {
    expect(adminConfigured(undefined)).toBe(false);
    expect(adminConfigured("short")).toBe(false);
    expect(adminConfigured(PASSWORD)).toBe(true);
    const token = await createSessionToken("short", NOW);
    expect(await verifySessionToken(token, "short", NOW)).toBe(false);
  });

  it("checks passwords", async () => {
    expect(await checkPassword(PASSWORD, PASSWORD)).toBe(true);
    expect(await checkPassword("correct horse battery stapl", PASSWORD)).toBe(false);
    expect(await checkPassword("", PASSWORD)).toBe(false);
  });

  it("locks a client after 5 failures for 15 minutes", () => {
    const client = "203.0.113.7";
    for (let i = 0; i < 5; i++) recordLoginFailure(client, NOW);
    expect(loginBlocked(client, NOW + 60_000)).toBe(true);
    expect(loginBlocked("198.51.100.1", NOW)).toBe(false);
    expect(loginBlocked(client, NOW + 16 * 60_000)).toBe(false);
    clearLoginFailures(client);
    expect(loginBlocked(client, NOW)).toBe(false);
  });
});

describe("override input", () => {
  const h3 = latLngToCell(44.4949, 11.3426, 9);
  it("accepts a valid override", () => {
    expect(overrideInputSchema.parse({ h3, level: 3, reason: "Confirmed by phone", expiresInMinutes: 120 })).toBeTruthy();
  });
  it.each([
    [{ h3: "not-a-cell", level: 3, reason: "x".repeat(5), expiresInMinutes: 60 }],
    [{ h3: latLngToCell(44.4949, 11.3426, 8), level: 3, reason: "wrong res", expiresInMinutes: 60 }],
    [{ h3, level: 5, reason: "too high", expiresInMinutes: 60 }],
    [{ h3, level: 2, reason: "", expiresInMinutes: 60 }],
    [{ h3, level: 2, reason: "forever", expiresInMinutes: 100_000 }],
    [{ h3, level: 2, reason: "extra", expiresInMinutes: 60, text: "nope" }],
  ])("rejects %j", (input) => {
    expect(overrideInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("freshness and health", () => {
  const now = new Date(NOW);
  it("is stale without a snapshot or after 10 minutes", () => {
    expect(isStale(null, now)).toBe(true);
    expect(isStale(new Date(NOW - STALE_AFTER_MS + 1000), now)).toBe(false);
    expect(isStale(new Date(NOW - STALE_AFTER_MS - 1000).toISOString(), now)).toBe(true);
  });

  it("reports ok / degraded / down", () => {
    const fresh = new Date(NOW - 60_000);
    expect(computeHealth({ dbOk: true, generatedAt: fresh, reducedAccuracy: false }, now)).toMatchObject({ status: "ok", snapshot: { ageSeconds: 60, stale: false } });
    expect(computeHealth({ dbOk: true, generatedAt: fresh, reducedAccuracy: true }, now).status).toBe("degraded");
    expect(computeHealth({ dbOk: true, generatedAt: new Date(NOW - 3_600_000), reducedAccuracy: false }, now).status).toBe("degraded");
    expect(computeHealth({ dbOk: false, generatedAt: null, reducedAccuracy: false }, now)).toMatchObject({ status: "down", database: "unreachable" });
  });
});

describe("reduced accuracy", () => {
  const e = (over: Partial<ScoringEvent>): ScoringEvent => ({
    eventType: "march", credibility: 1, confidence: 1, occurredAt: new Date(NOW), h3Cells: [], sourceFeed: "news:x", sourceClass: "news", ...over,
  });
  it("is on when events came from the rules fallback, ignoring TPER's rule-based signals", () => {
    expect(isReducedAccuracy([e({ extractor: "gemini" })])).toBe(false);
    expect(isReducedAccuracy([e({ extractor: "rules", source: "tper" })])).toBe(false);
    expect(isReducedAccuracy([e({ extractor: "gemini" }), e({ extractor: "rules", source: "news" })])).toBe(true);
    expect(isReducedAccuracy([])).toBe(false);
  });
});

describe("log redaction", () => {
  it("removes text, URLs and author data even if a call passes them", () => {
    const lines: string[] = [];
    const sink = new Writable({ write: (chunk, _enc, cb) => (lines.push(String(chunk)), cb()) });
    const l = pino({ redact: { paths: REDACT_PATHS, remove: true } }, sink);
    l.info({ adapter: "reddit", text: "Corteo, foto di u/x", url: "https://reddit.com/u/x", item: { text: "secret", author: "x" } }, "run");
    expect(lines[0]).toContain('"adapter":"reddit"');
    expect(lines[0]).not.toMatch(/Corteo|reddit\.com|secret|"author"/);
  });
});

describe("error messages", () => {
  it("never carry query parameters (which can contain post text)", () => {
    const err = Object.assign(
      new Error('Failed query: insert into "raw_items" ("text") values ($1)\nparams: Corteo in via Zamboni, foto di u/someone'),
      { name: "DrizzleQueryError", cause: { message: 'relation "raw_items" does not exist', code: "42P01" } },
    );
    expect(safeErrorMessage(err)).toBe('query failed (42P01): relation "raw_items" does not exist');
    expect(JSON.stringify(errInfo(err))).not.toMatch(/Corteo|someone|params/);
    expect(safeErrorMessage(new Error("connect ECONNREFUSED 127.0.0.1:5432"))).toBe("connect ECONNREFUSED 127.0.0.1:5432");
    expect(safeErrorMessage(new Error("bad thing params: secret"))).toBe("bad thing");
  });
});
