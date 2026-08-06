/**
 * batchProcessor
 * Runs a list of tasks in parallel with a limited concurrency (limit).
 * 
 * @param {Array} items - List of items to process
 * @param {Function} taskFn - Function (item, index) => Promise
 * @param {number} limit - Max concurrent tasks
 * @returns {Promise<Array>} Results
 */
export async function batchProcessor(items, taskFn, limit = 5) {
  const results = [];
  let i = 0;

  async function worker() {
    while (i < items.length) {
      const index = i++;
      const item = items[index];
      try {
        const res = await taskFn(item, index);
        results[index] = { status: "fulfilled", value: res };
      } catch (err) {
        results[index] = { status: "rejected", reason: err };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  
  await Promise.all(workers);
  return results;
}
