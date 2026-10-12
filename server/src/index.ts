import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { POLICIES } from "./rules/policies";

const app = new Hono().basePath("/api");

app.get("/health", (c) =>
  c.json({
    status: "ok",
    policies: POLICIES.map(({ version, effectiveFrom, effectiveTo }) => ({ version, effectiveFrom, effectiveTo })),
  }),
);

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`CaseFlow API listening on http://localhost:${port}`));
