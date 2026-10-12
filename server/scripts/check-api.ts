/**
 * Demo preflight: confirms the Anthropic API key in .env works, without printing it.
 * Run: npm run check:api -w server
 */
import Anthropic from "@anthropic-ai/sdk";

const key = process.env.ANTHROPIC_API_KEY ?? "";
if (!key) {
  console.error("✗ ANTHROPIC_API_KEY is empty. Add it to caseflow/.env");
  process.exit(1);
}
if (!key.startsWith("sk-ant-") || /\s|["']/.test(key)) {
  console.error("✗ ANTHROPIC_API_KEY doesn't look right (expected sk-ant-..., no quotes or spaces).");
  process.exit(1);
}

const client = new Anthropic();
const started = Date.now();
try {
  const response = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 1024,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: "Reply with exactly: CaseFlow preflight OK" }],
  });
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
  console.log(`✓ API reachable · model ${response.model} · ${Date.now() - started} ms · stop_reason ${response.stop_reason}`);
  console.log(`  reply: ${text}`);
  console.log(`  tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);
} catch (error) {
  if (error instanceof Anthropic.AuthenticationError) console.error("✗ The API rejected the key (401). Check it was copied completely.");
  else if (error instanceof Anthropic.PermissionDeniedError) console.error("✗ The key lacks permission for this model (403).");
  else if (error instanceof Anthropic.RateLimitError) console.error("✗ Rate limited or out of credits (429). Check billing in the Anthropic Console.");
  else if (error instanceof Anthropic.APIError) console.error(`✗ API error ${error.status}: ${error.message}`);
  else console.error(`✗ Could not reach the API: ${(error as Error).message}`);
  process.exit(1);
}
