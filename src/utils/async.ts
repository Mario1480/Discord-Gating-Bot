export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export async function withRetry<T>(
  fn: () => Promise<T>,
  delaysMs: number[] = [250, 750, 1750]
): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i <= delaysMs.length; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < delaysMs.length) {
        await sleep(delaysMs[i]);
      }
    }
  }

  throw lastError;
}
