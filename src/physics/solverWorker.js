// Web Worker wrapper around the pure solver so the UI stays responsive.
import { solve } from './solver.js';

self.onmessage = (ev) => {
  const { id, cfg, constraints, opts } = ev.data;
  let last = 0;
  try {
    const result = solve(cfg, constraints, {
      ...opts,
      onProgress: (p) => {
        if (p - last > 0.02 || p >= 1) {
          last = p;
          self.postMessage({ id, type: 'progress', progress: p });
        }
      },
    });
    self.postMessage({ id, type: 'done', result });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err && err.stack ? err.stack : err) });
  }
};
