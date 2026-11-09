// Deletes all stored demo sessions (Pondr's own data under data/sessions).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "sessions");
fs.rmSync(dir, { recursive: true, force: true });
console.log("All demo sessions cleared.");
