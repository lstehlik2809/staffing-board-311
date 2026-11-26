// Minimal worker pool for the as-of fits behind the forecast ledger.
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import { ledgerEntry } from './fit-worker.mjs';

export async function runFits(tasks, onDone) {
  if (tasks.length === 0) return [];
  const cores = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
  const size = Math.max(1, Math.min(tasks.length, cores - 1, 12));
  if (size === 1 || tasks.length < 4) {
    return tasks.map((t) => {
      const r = ledgerEntry(t);
      if (onDone) onDone(r);
      return r;
    });
  }
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: size }, () => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./fit-worker.mjs', import.meta.url));
    const feed = () => {
      if (next >= tasks.length) { worker.terminate(); resolve(); return; }
      worker.postMessage(tasks[next++]);
    };
    worker.on('message', (msg) => {
      if (!msg.ok) { worker.terminate(); reject(new Error(msg.error)); return; }
      results.push(msg.result);
      if (onDone) onDone(msg.result);
      feed();
    });
    worker.on('error', reject);
    feed();
  })));
  return results;
}
