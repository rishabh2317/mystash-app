import { runFeedLoad } from '../src/notifications/jobs/loadHarness';

const feedSize = Number(process.env.NOTIFICATIONS_LOAD_FEED_SIZE ?? 2_000);
const requests = Number(process.env.NOTIFICATIONS_LOAD_REQUESTS ?? 400);
const concurrency = Number(process.env.NOTIFICATIONS_LOAD_CONCURRENCY ?? 20);

async function main(): Promise<void> {
  const result = await runFeedLoad({ feedSize, requests, concurrency });
  console.log(
    JSON.stringify(
      {
        harness: 'in-process Express + InMemoryNotificationRepository',
        feedSize,
        requests,
        concurrency,
        units: 'ms',
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
