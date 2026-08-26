/**
 * Standalone credit-usage sanity check (PROJECT_GUIDE.md Section 3 &
 * Section 5) — run before/after the big historical pull to confirm actual
 * credit consumption.
 *
 *   npx tsx scripts/check-usage.ts
 */
import "./_env";
import { getFortyGuardClient } from "@/lib/fortyguard/client";

async function main() {
  const client = getFortyGuardClient();

  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const usage = await client.fetchApiKeyCustomUsage(startDate, endDate);

  const window = usage.date_range?.date_range_formatted ?? `${startDate} -> ${endDate}`;
  console.log(`Window      : ${window}`);
  console.log(`Credits used: ${usage.total_credits_used}`);
  for (const row of usage.activity_breakdown ?? []) {
    console.log(`  ${row.name.padStart(28)}: ${row.credits} credits over ${row.count} calls`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
