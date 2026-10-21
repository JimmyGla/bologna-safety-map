import { config } from "dotenv";

// Imported first by the worker entrypoint: ES imports run in order, and src/db reads
// DATABASE_URL as soon as it is imported.
config({ path: ".env.local", quiet: true });
