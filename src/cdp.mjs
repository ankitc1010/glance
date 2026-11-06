import { EventEmitter } from 'node:events';

// CDP over Chromium's --remote-debugging-pipe: NUL-delimited JSON. Using the pipe
// means no debug port on loopback, which other apps on an Android phone could reach.
export class Cdp extends EventEmitter {
  #w;
  #id = 1;
  #pending = new Map();
  #chunks = [];

  constructor(w, r) {
    super();
    this.#w = w;
    r.on('data', (d) => this.#feed(d));
    r.on('close', () => this.#failAll(new Error('browser connection closed')));
  }

  #feed(d) {
    let start = 0;
    let nul;
    while ((nul = d.indexOf(0, start)) !== -1) {
      this.#chunks.push(d.subarray(start, nul));
      const msg = JSON.parse(Buffer.concat(this.#chunks).toString('utf8'));
      this.#chunks = [];
      start = nul + 1;
      this.#dispatch(msg);
    }
    if (start < d.length) this.#chunks.push(d.subarray(start));
  }

  #dispatch(m) {
    if (m.id === undefined) {
      this.emit(m.method, m.params, m.sessionId);
      return;
    }
    const p = this.#pending.get(m.id);
    if (!p) return;
    this.#pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`));
    else p.resolve(m.result);
  }

  #failAll(err) {
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.#pending.clear();
  }

  send(method, params = {}, { sessionId, timeout = 30000 } = {}) {
    return new Promise((resolve, reject) => {
      const id = this.#id++;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method}: no reply after ${timeout} ms (page may be busy)`));
      }, timeout);
      this.#pending.set(id, { resolve, reject, timer, method });
      this.#w.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
  }
}
