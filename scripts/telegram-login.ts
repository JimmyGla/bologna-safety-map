// One-off: log in to Telegram with your account and print a session string for TG_SESSION.
//
//   1. Create an app at https://my.telegram.org → API development tools.
//   2. Put TG_API_ID and TG_API_HASH in .env.local.
//   3. npm run telegram:login   (asks for phone, login code, and 2FA password if set)
//   4. Paste the printed TG_SESSION=... line into .env.local.
//
// The session string gives full access to the account: treat it like a password, keep it
// only in .env.local / your secrets store. A separate account for the worker is a good idea.
// The worker only ever reads public channels with it.

import { config } from "dotenv";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

config({ path: ".env.local", quiet: true });

async function main() {
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH;
  if (!apiId || !apiHash) {
    console.error("Set TG_API_ID and TG_API_HASH in .env.local first (https://my.telegram.org).");
    process.exit(1);
  }

  const rl = createInterface({ input, output });
  const ask = (q: string) => rl.question(q);
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 3 });
  await client.start({
    phoneNumber: () => ask("Phone number (international format, e.g. +39…): "),
    phoneCode: () => ask("Login code from Telegram: "),
    password: () => ask("2FA password (empty if none): "),
    onError: (err) => console.error(err.message),
  });
  rl.close();

  console.log("\nAdd this line to .env.local (keep it secret):\n");
  console.log(`TG_SESSION=${client.session.save()}`);
  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
