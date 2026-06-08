/**
 * 通用并发限流执行器
 * 控制同时执行的异步任务数量，避免资源耗尽
 */

export async function parallelLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * 简单的并发限制：最多同时运行 maxConcurrent 个 Promise
 */
export async function limitConcurrency<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrent: number,
): Promise<T[]> {
  const results: T[] = [];
  let running = 0;
  let nextIndex = 0;

  return new Promise((resolve, reject) => {
    function runNext() {
      while (running < maxConcurrent && nextIndex < tasks.length) {
        const idx = nextIndex++;
        running++;
        tasks[idx]()
          .then((result) => {
            results[idx] = result;
            running--;
            if (running === 0 && nextIndex >= tasks.length) {
              resolve(results);
            } else {
              runNext();
            }
          })
          .catch((err) => {
            reject(err);
          });
      }
      if (tasks.length === 0) resolve([]);
    }
    runNext();
  });
}
