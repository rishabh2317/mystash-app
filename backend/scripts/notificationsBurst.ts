import { runOutboxBurst } from '../src/notifications/jobs/loadHarness';

const count = Number(process.env.NOTIFICATIONS_BURST_COUNT ?? 100_000);
const restartAfter = Number(process.env.NOTIFICATIONS_BURST_RESTART_AFTER ?? Math.floor(count / 2));

async function main(): Promise<void> {
  const result = await runOutboxBurst({ count, restartAfter });
  console.log(
    JSON.stringify(
      {
        harness: 'in-memory outbox drain + FakePushProvider; Redis is unused',
        ...result,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
