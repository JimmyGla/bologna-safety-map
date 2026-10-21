import type { AdaptiveSchedule } from "../sources/types";

/**
 * Adaptive polling for social sources: halve the interval after a poll that found new
 * relevant items, grow it ×1.5 after an empty poll, within [min, max]. Ticked every minute.
 */
export class AdaptivePoller {
  interval: number;
  private nextAt = 0;

  constructor(private schedule: AdaptiveSchedule) {
    this.interval = schedule.baseMinutes;
  }

  due(now: Date): boolean {
    return now.getTime() >= this.nextAt;
  }

  record(foundRelevant: boolean, now: Date) {
    const { minMinutes, maxMinutes } = this.schedule;
    this.interval = foundRelevant
      ? Math.max(minMinutes, Math.floor(this.interval / 2))
      : Math.min(maxMinutes, Math.ceil(this.interval * 1.5));
    // Small slack so a 1-minute cron tick doesn't miss the slot by milliseconds.
    this.nextAt = now.getTime() + this.interval * 60_000 - 5_000;
  }
}
