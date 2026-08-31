import dotenv from "dotenv";

// Load the project-root .env (next to .env.example) before any module reads
// process.env. Imported first in index.js so JWT_SECRET & co. are set by the
// time app.js is evaluated. Tests import app.js directly, so they never load it.
// A personal .env (gitignored) always wins; dotenv skips keys already set,
// so anything missing from it falls back to the committed dev profile.
dotenv.config({ path: new URL("../.env", import.meta.url) });
if (process.env.NODE_ENV === "development") {
  dotenv.config({ path: new URL("../.env.dev", import.meta.url) });
}
