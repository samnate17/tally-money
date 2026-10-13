'use strict';
// A private assistant that runs on this Mac. It talks to Ollama (https://ollama.com), a free app that runs open language models
// locally and listens only on this computer. Nothing here sends data anywhere else: the address is fixed to the loopback interface.

const HOST = 'http://127.0.0.1:11434';
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,99}$/;
const MAX_MESSAGES = 40;
const MAX_CHARS = 60000;
const ROLES = { system: 1, user: 1, assistant: 1 };

function createLocalAI({ fetchImpl, host } = {}) {
  const f = fetchImpl || ((...a) => fetch(...a));
  const base = host || HOST;
  const running = new Map();   // request id -> AbortController

  async function status() {
    let res;
    try { res = await f(base + '/api/tags', { signal: AbortSignal.timeout(2500) }); } catch (e) { return { running: false, models: [] }; }
    if (!res.ok) return { running: false, models: [] };
    let j = {};
    try { j = await res.json(); } catch (e) { /* empty */ }
    const models = (Array.isArray(j.models) ? j.models : []).map((m) => ({ name: String(m.name || m.model || ''), size: +m.size || 0 })).filter((m) => MODEL_RE.test(m.name));
    return { running: true, models };
  }

  function clean(messages) {
    if (!Array.isArray(messages) || !messages.length) throw new Error('There is nothing to send.');
    if (messages.length > MAX_MESSAGES) throw new Error('This chat is too long. Clear it and start again.');
    let total = 0;
    const out = messages.map((m) => {
      if (!m || !ROLES[m.role] || typeof m.content !== 'string') throw new Error('Invalid message.');
      total += m.content.length;
      return { role: m.role, content: m.content };
    });
    if (total > MAX_CHARS) throw new Error('This chat is too long. Clear it and start again.');
    return out;
  }

  // Streams the answer. onToken(text) is called for each piece. Resolves with the full text.
  async function chat({ id, model, messages, onToken }) {
    if (!MODEL_RE.test(String(model || ''))) throw new Error('Choose a model first.');
    const msgs = clean(messages);
    const ctl = new AbortController();
    if (id) running.set(id, ctl);
    let res;
    try {
      res = await f(base + '/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ model, messages: msgs, stream: true, options: { num_ctx: 8192, temperature: 0.3 } }),
      });
    } catch (e) {
      if (id) running.delete(id);
      if (ctl.signal.aborted) return { text: '', stopped: true };
      throw new Error('Ollama is not running. Open the Ollama app and try again.');
    }
    try {
      if (!res.ok) {
        let msg = '';
        try { msg = String((await res.json()).error || ''); } catch (e) { /* empty */ }
        if (res.status === 404) throw new Error('That model is not installed. In Terminal run: ollama pull ' + model);
        throw new Error(msg || 'Ollama returned an error (' + res.status + ').');
      }
      let text = '', buf = '';
      const dec = new TextDecoder();
      const eat = (line) => {
        line = line.trim();
        if (!line) return;
        let j;
        try { j = JSON.parse(line); } catch (e) { return; }
        if (j.error) throw new Error(String(j.error));
        const t = j.message && typeof j.message.content === 'string' ? j.message.content : '';
        if (t) { text += t; if (onToken) onToken(t); }
      };
      try {
        for await (const chunk of res.body) {
          buf += typeof chunk === 'string' ? chunk : dec.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) { eat(buf.slice(0, i)); buf = buf.slice(i + 1); }
        }
        eat(buf);
      } catch (e) {
        if (ctl.signal.aborted) return { text, stopped: true };
        throw e;
      }
      return { text, stopped: false };
    } finally {
      if (id) running.delete(id);
    }
  }

  function cancel(id) {
    const c = running.get(id);
    if (c) c.abort();
    return !!c;
  }

  return { status, chat, cancel, _clean: clean };
}

module.exports = { createLocalAI, HOST, MODEL_RE };
