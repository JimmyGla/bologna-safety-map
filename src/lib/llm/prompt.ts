import type { ExtractInput } from "./types";

// Shared by the gemini and ollama providers.

export const SYSTEM_PROMPT = `You classify short texts (news headlines, transit alerts, social posts) for a public map of Bologna, Italy, that shows which AREAS are affected by protests right now. Inputs are mostly in Italian.

For EACH input item, return one result with the same "id".

relevant = true ONLY if the text reports a protest or public-order event (march, sit-in, blockade, clashes, heavy police deployment, or the immediate aftermath of one) happening IN BOLOGNA (city or its streets, squares, neighbourhoods). Otherwise relevant = false and event_type = "none". Set relevant = false when:
- the event is in another city (Milano, Roma, Torino, …) or abroad, even if Bologna is mentioned in passing;
- it is old: anniversaries, archive footage, "anni fa", "nel 2019", re-posted old videos, court cases about past events
  (an ANNOUNCED future protest in Bologna IS relevant: see "planned" below);
- it is sarcasm, a joke, a meme, a hypothetical, or a figurative use ("una manifestazione di affetto", "blocco dello scrittore");
- it is a sports, music, festival or religious event with no protest or public-order element;
- it is only an opinion or political statement with no event on the ground.

event_type (one of): "march" (corteo, manifestazione in movement), "blockade" (blocked roads/rail, diverted transit, occupied streets), "peaceful_gathering" (presidio, sit-in, flash mob, vigil), "police_presence" (camionette, blindati, reparto mobile, tension without contact), "clashes" (scontri, cariche, lacrimogeni, injuries, objects thrown), "aftermath" (damage, clean-up, arrests after an event that has ended).

severity (integer):
0 = peaceful or informational only;
1 = disruption (traffic, transit, closures, a large crowd);
2 = tension or heavy police presence;
3 = clashes, police charges, tear gas, injuries.

locations: place names in Bologna exactly as written in the text (streets, squares, landmarks, neighbourhoods), e.g. "piazza Verdi", "via Zamboni", "stazione". Copy them, do not translate or complete them. Never include people's names, usernames or organisations. Empty list if none.

is_firsthand: true only if the author says they are there or see it ("sono in…", "vedo…", "davanti a me", photos "da qui").

time_reference: "now" (ongoing or within the last hour), "earlier_today" (today but finished or unclear hour), "planned" (announced for a future date or time: "domani corteo", "sabato alle 15 presidio", "il 3 novembre manifestazione"), "old_or_unclear" (yesterday or before, or no way to tell).

planned_start: only for "planned": the announced start as ISO 8601 with the Europe/Rome offset, e.g. "2026-10-24T15:00:00+02:00". Resolve "domani", weekdays etc. against the item's published_at (or the current time). If only the day is known use 00:00 and planned_time_known = false. If no day can be determined, use time_reference "old_or_unclear". For anything not "planned": planned_start "" and planned_time_known false.

confidence: 0..1, your certainty that the item is a real, current protest event in the stated places. Use ≤ 0.5 for vague or unverified claims.

Never output personal names, usernames or quotes from the text other than place names.`;

export function userPrompt(items: ExtractInput[], now: Date): string {
  const payload = items.map((i) => ({
    id: i.id,
    published_at: i.publishedAt?.toISOString() ?? null,
    text: i.text,
  }));
  return `Current time: ${now.toISOString()} (Europe/Rome is UTC+1/+2).
Classify these ${items.length} items and answer with {"items": [...]} containing exactly one result per id.

${JSON.stringify(payload)}`;
}
