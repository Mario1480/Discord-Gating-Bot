export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const maxWorkers = Math.max(1, Math.min(concurrency, items.length));
  let index = 0;

  const runners = Array.from({ length: maxWorkers }, async () => {
    while (true) {
      const current = index;
      index += 1;

      if (current >= items.length) {
        break;
      }

      await worker(items[current], current);
    }
  });

  await Promise.all(runners);
}
