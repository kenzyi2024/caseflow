import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./api/app";
import { VacmsHouseholdExtract } from "./integrations/vacms";
import { VecWageMatchFile } from "./integrations/vec";
import { CaseService } from "./pipeline/case-service";
import { EventStore } from "./store/event-store";

export const DB_URL = new URL("../var/caseflow.db", import.meta.url);
export const SAMPLES_DIR = new URL("../data/documents/", import.meta.url);

mkdirSync(fileURLToPath(new URL(".", DB_URL)), { recursive: true });
const store = new EventStore(fileURLToPath(DB_URL));
const households = VacmsHouseholdExtract.fromFile();
const wages = VecWageMatchFile.fromFile();
for (const r of [...households.rejects, ...wages.rejects]) console.warn(`data quality: ${r.source} line ${r.line}: ${r.reason}`);

const service = new CaseService({ store, households, wages });
const opened = await service.syncFromVacms();
if (!process.env.ANTHROPIC_API_KEY) console.warn("ANTHROPIC_API_KEY is not set: intake and notices will fail and route cases to manual review.");

const app = createApp({ service, store, households, samplesDir: SAMPLES_DIR });
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () =>
  console.log(`CaseFlow API on http://localhost:${port} · ${store.caseNumbers().length} cases (${opened} newly opened from VaCMS)`),
);
