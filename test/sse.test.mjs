// SSE helpers: a write() that reports back-pressure must not drop the client (the snapshot is hundreds of KB)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { broadcastEvent, writeToClient } from '../lib/sse.mjs';

const fakeClient = (over = {}) => ({ destroyed: false, writableEnded: false, writableLength: 0, writes: [],
  write(chunk) { this.writes.push(chunk); return false; }, destroy() { this.destroyed = true; }, ...over });

describe('SSE helpers', () => {
  it('keeps a client whose write() returns false while its buffer is below the limit', () => {
    const client = fakeClient({ writableLength: 700 * 1024 });
    assert.equal(writeToClient(client, 'x'), true);
    assert.equal(client.destroyed, false);
  });

  it('drops a client that stays far behind, and one whose write throws', () => {
    const slow = fakeClient({ writableLength: 100 });
    assert.equal(writeToClient(slow, 'x', 50), false);
    assert.equal(slow.destroyed, true);
    const broken = fakeClient({ write() { throw new Error('EPIPE'); } });
    assert.equal(writeToClient(broken, 'x'), false);
    assert.equal(broken.destroyed, true);
  });

  it('broadcasts to every healthy client and removes only the dropped ones', () => {
    const good = fakeClient(), dead = fakeClient({ destroyed: true });
    const clients = new Set([good, dead]);
    broadcastEvent(clients, { type: 'update' });
    assert.deepEqual([...clients], [good]);
    assert.equal(good.writes[0], 'data: {"type":"update"}\n\n');
  });

  it('delivers a multi-megabyte event over a real connection without cutting the stream', async () => {
    const clients = new Set();
    const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); clients.add(res); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const payload = 'a'.repeat(3 * 1024 * 1024);
    try {
      const received = await new Promise((resolve, reject) => {
        http.get({ port: server.address().port, host: '127.0.0.1' }, res => {
          let text = '';
          res.on('data', chunk => { text += chunk; if (text.endsWith('\n\n')) { resolve(text); res.destroy(); } });
          res.on('error', reject);
          res.on('aborted', () => reject(new Error('stream cut')));
        }).on('error', reject);
        const wait = setInterval(() => { if (clients.size) { clearInterval(wait); broadcastEvent(clients, { payload }); } }, 10);
      });
      assert.equal(JSON.parse(received.slice(6)).payload.length, payload.length);
    } finally { server.closeAllConnections(); server.close(); }
  });
});
