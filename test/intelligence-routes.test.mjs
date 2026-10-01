import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installHttpSecurity } from '../lib/http-security.mjs';
import { installIntelligenceRoutes } from '../lib/intelligence/routes.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';

async function fixture(t, auth = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-routes-'));
  const now = new Date().toISOString();
  const events = buildEvents({meta:{timestamp:now},newsFeed:[{headline:'Árvíz <script>bad()</script>',source:'Test',url:'https://example.org/report',publishedAt:now}]});
  const history = new HistoryStore(dir); history.add(events);
  const app = express(); installHttpSecurity(app, auth);
  installIntelligenceRoutes(app, { getSnapshot:()=>({events}), history, language:'hu' });
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  return {url:`http://127.0.0.1:${server.address().port}`,events};
}

test('history and all exports share authentication with current events', async t=>{
  const {url,events}=await fixture(t,{user:'reader',password:'test-password'});
  for(const path of ['/api/history','/api/export?format=html','/api/events/'+events[0].id]) {
    assert.equal((await fetch(url+path)).status,401);
    const response=await fetch(url+path,{headers:{Authorization:'Basic '+Buffer.from('reader:test-password').toString('base64')}});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  }
});

test('HTTP query validation, literal Unicode search and safe printable export',async t=>{
  const {url,events}=await fixture(t);
  for(const query of ['limit=201','from=2026-02-30','kind=unknown','q[x]=oops','offset=-1'])assert.equal((await fetch(url+'/api/history?'+query)).status,400,query);
  const response=await fetch(url+'/api/history?q=arviz');const data=await response.json();assert.equal(data.total,1);assert.equal(data.items[0].id,events[0].id);
  const html=await fetch(url+'/api/export?format=html&q=arviz');const body=await html.text();
  assert.equal(html.status,200);assert.ok(html.headers.get('content-security-policy').includes("default-src 'none'"));
  assert.ok(!body.includes('<script>'));assert.ok(body.includes('&lt;script&gt;'));
  assert.equal(html.headers.get('x-export-count'),'1');
  assert.equal((await fetch(url+'/api/export?format=exe')).status,400);
  assert.equal((await fetch(url+'/api/events/bad')).status,400);
  assert.equal((await fetch(url+'/api/events/event-'+ '0'.repeat(32))).status,404);
});
