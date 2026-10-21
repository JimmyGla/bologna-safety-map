import { describe, expect, it } from "vitest";
import { clientIp, RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("allows 60 requests per minute per IP, then refuses until the window resets", () => {
    const rl = new RateLimiter(60);
    const t = 1_000_000;
    for (let i = 0; i < 60; i++) expect(rl.check("1.2.3.4", t + i).allowed).toBe(true);
    const over = rl.check("1.2.3.4", t + 100);
    expect(over).toMatchObject({ allowed: false, remaining: 0 });
    expect(over.resetMs).toBeGreaterThan(59_000);
    expect(rl.check("5.6.7.8", t + 100).allowed).toBe(true); // other clients unaffected
    expect(rl.check("1.2.3.4", t + 60_000).allowed).toBe(true); // new window
  });

  it("forgets expired windows and bounds memory", () => {
    const rl = new RateLimiter(1, 60_000, 3);
    for (const ip of ["a", "b", "c"]) rl.check(ip, 0);
    // A flood of distinct keys clears the table instead of growing without bound.
    expect(rl.check("d", 1).allowed).toBe(true);
    expect(rl.check("a", 2).allowed).toBe(true);
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for hop, then x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
