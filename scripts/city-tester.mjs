#!/usr/bin/env node
/*
  Batch city tester for /api/weather
  - Reads city list from optional files:
      data/cities_cn.txt (UTF-8, one city per line)
      data/cities_world.txt (UTF-8, one city per line)
    If not present, falls back to an internal seed set.
  - Calls BASE_URL + "/api/weather?city=<name>" with X-Access-Token header.
  - Writes CSV report to reports/city-test-<timestamp>.csv

  ENV:
    BASE_URL   default: http://localhost:8788
    TOKEN      required by server; if server hasn't configured TOKEN/TOKEN_HASH, all requests will be 401
    CONCURRENCY default: 5
    LIMIT      optional: only test first N cities
    MAX_RETRIES         default: 5 (per city)
    BACKOFF_BASE_MS     default: 1000 (base for exponential backoff)
    JITTER_MS           default: 300 (randomized jitter)
    PAUSE_MS            default: 0 (pause between requests per worker)
    START_STAGGER_MS    default: 0 (stagger worker start by idx * START_STAGGER_MS)
*/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.BASE_URL || 'http://localhost:8788';
const TOKEN = process.env.TOKEN || process.env.ACCESS_TOKEN || process.env.X_ACCESS_TOKEN || '';
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : null;
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 5);
const BACKOFF_BASE_MS = Number(process.env.BACKOFF_BASE_MS || 1000);
const JITTER_MS = Number(process.env.JITTER_MS || 300);
const PAUSE_MS = Number(process.env.PAUSE_MS || 0);
const START_STAGGER_MS = Number(process.env.START_STAGGER_MS || 0);

// New: adaptive QPS limiter controls
const TARGET_QPS = Number(process.env.TARGET_QPS || 5); // baseline QPS
const MIN_QPS = Number(process.env.MIN_QPS || 1);       // floor QPS when limited
const SUCCESS_STREAK_FOR_RAMP = Number(process.env.SUCCESS_STREAK_FOR_RAMP || 20); // successes before ramp up

function ts() { return new Date().toISOString(); }
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function readListIfExists(p){
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      return raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    }
  } catch {}
  return [];
}

// Internal seed to kick off validation quickly
const seedCN = [
  '北京','上海','广州','深圳','重庆','天津','杭州','成都','武汉','南京','西安','苏州','长沙','郑州','青岛','合肥','福州','厦门','济南','大连',
  '湖州','泾县','文昌','墨脱','崇礼','永嘉','武义','三亚','海口','银川','西宁','拉萨','乌鲁木齐','呼和浩特','石家庄'
];
const seedWorld = [
  'New York','London','Paris','Berlin','Tokyo','Seoul','Singapore','Sydney','Toronto','Sao Paulo','Mumbai','Johannesburg','Moscow','Dubai','Los Angeles','Mexico City','Jakarta','Istanbul','Cairo','Bangkok'
];

function unique(arr){
  const set = new Set();
  const res = [];
  for (const s of arr) {
    const key = s.normalize('NFKC');
    if (!set.has(key)) { set.add(key); res.push(s); }
  }
  return res;
}

function ensureDir(dir){ fs.mkdirSync(dir, { recursive: true }); }

function parseRetryAfter(retryAfter){
  if (!retryAfter) return null;
  const n = Number(retryAfter);
  if (Number.isFinite(n)) return Math.max(0, Math.floor(n * 1000));
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    const delta = date.getTime() - Date.now();
    return Math.max(0, delta);
  }
  return null;
}

function expoBackoff(attempt){
  const base = BACKOFF_BASE_MS * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * (JITTER_MS + 1));
  return base + jitter;
}

// New: simple token-bucket rate limiter with adaptive target
class RateLimiter {
  constructor(targetQps = 5, minQps = 1){
    this.baseQps = targetQps;
    this.minQps = minQps;
    this.currentQps = Math.max(minQps, targetQps | 0);
    this.tokens = this.currentQps;
    this.queue = [];
    this.successStreak = 0;
    this.interval = setInterval(()=>{
      // Refill tokens each second according to currentQps
      this.tokens = this.currentQps;
      this._drain();
    }, 1000);
  }
  stop(){ clearInterval(this.interval); }
  _drain(){
    while (this.tokens > 0 && this.queue.length > 0) {
      this.tokens--;
      const next = this.queue.shift();
      next();
    }
  }
  acquire(){
    return new Promise(res=>{
      this.queue.push(res);
      this._drain();
    });
  }
  on429(){
    this.successStreak = 0;
    if (this.currentQps > this.minQps) {
      this.currentQps = Math.max(this.minQps, this.currentQps - 1);
      console.log(`[${ts()}] [QPS] throttled due to 429 -> currentQps=${this.currentQps}`);
    }
  }
  onSuccess(){
    this.successStreak++;
    if (this.successStreak >= SUCCESS_STREAK_FOR_RAMP && this.currentQps < this.baseQps) {
      this.currentQps++;
      this.successStreak = 0;
      console.log(`[${ts()}] [QPS] ramp up -> currentQps=${this.currentQps}`);
    }
  }
}

async function fetchJsonWithRateAwareRetry(url, options={}, maxRetries=MAX_RETRIES, timeoutMs=20000) {
  let lastErr;
  for (let i=0;i<=maxRetries;i++){
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(t);

      // Handle HTTP 429 with backoff and retry
      if (r.status === 429) {
        const ra = r.headers.get('retry-after');
        const wait = parseRetryAfter(ra) ?? expoBackoff(i);
        if (i < maxRetries) {
          await sleep(wait);
          continue;
        } else {
          const text = await r.text().catch(()=> '');
          let json;
          try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text || 'Rate limited' }; }
          return { status: r.status, json };
        }
      }

      const text = await r.text();
      let json;
      try { json = text ? JSON.parse(text) : {}; } catch(parseErr){
        throw new Error(`Non-JSON response: ${parseErr.message}`);
      }
      return { status: r.status, json };
    } catch (e) {
      lastErr = e;
      if (i < maxRetries) await sleep(expoBackoff(i));
    }
  }
  throw lastErr || new Error('fetch failed');
}

async function run(){
  const cnPath = path.resolve(__dirname, '../data/cities_cn.txt');
  const worldPath = path.resolve(__dirname, '../data/cities_world.txt');
  const cnList = readListIfExists(cnPath);
  const worldList = readListIfExists(worldPath);
  let cities = unique([ ...cnList, ...worldList ]);
  if (cities.length === 0){
    cities = unique([ ...seedCN, ...seedWorld ]);
  }
  if (LIMIT && Number.isFinite(LIMIT)) cities = cities.slice(0, LIMIT);

  ensureDir(path.resolve(__dirname, '../reports'));
  const outPath = path.resolve(__dirname, `../reports/city-test-${Date.now()}.csv`);
  const header = 'city,status,http_status,success,error,usedFallback,usedFallbackReason,elapsed_ms' + os.EOL;
  fs.writeFileSync(outPath, header);

  console.log(`[${ts()}] Testing ${cities.length} cities; BASE_URL=${BASE_URL}; CONCURRENCY=${CONCURRENCY}; MAX_RETRIES=${MAX_RETRIES}; BACKOFF_BASE_MS=${BACKOFF_BASE_MS}; JITTER_MS=${JITTER_MS}; PAUSE_MS=${PAUSE_MS}; START_STAGGER_MS=${START_STAGGER_MS}; TARGET_QPS=${TARGET_QPS}; MIN_QPS=${MIN_QPS}`);
  if (!TOKEN) {
    console.warn('[warn] TOKEN not provided via env. Requests will likely fail with 401 if server requires it.');
  }

  // Global rate limiter shared across workers
  const limiter = new RateLimiter(TARGET_QPS, MIN_QPS);

  let ok=0, fail=0;
  const queue = cities.slice();
  const workers = Array.from({length: Math.max(1, CONCURRENCY)}, (_, idx) => (async ()=>{
    if (START_STAGGER_MS > 0 && idx > 0) await sleep(idx * START_STAGGER_MS);
    while(queue.length){
      const city = queue.shift();
      const started = Date.now();
      try {
        await limiter.acquire(); // pace by global QPS limiter
        const url = `${BASE_URL}/api/weather?city=${encodeURIComponent(city)}`;
        const { status, json } = await fetchJsonWithRateAwareRetry(url, {
          headers: { 'X-Access-Token': TOKEN }
        });
        const elapsed = Date.now() - started;
        const success = !!(json && json.success === true);
        const error = json && json.error ? String(json.error) : '';
        const usedFallback = json && json.usedFallback ? '1' : '0';
        const usedFallbackReason = json && json.usedFallbackReason ? String(json.usedFallbackReason) : '';
        fs.appendFileSync(outPath, `${city},${success?'ok':'fail'},${status},${success?1:0},"${error.replaceAll('"','\\"')}",${usedFallback},"${usedFallbackReason.replaceAll('"','\\"')}",${elapsed}` + os.EOL);
        if (status === 429) {
          limiter.on429();
        } else if (success) {
          limiter.onSuccess();
        }
        if (success) ok++; else fail++;
        const tag = success ? 'OK' : `ERR(${status})`;
        console.log(`[${ts()}] [${idx}] ${tag} ${city} ${elapsed}ms ${error?'- '+error:''}`);
      } catch (e) {
        const elapsed = Date.now() - started;
        fail++;
        fs.appendFileSync(outPath, `${city},fail,0,0,"${String(e.message||e).replaceAll('"','\\"')}",0,"",${elapsed}` + os.EOL);
        console.log(`[${ts()}] [${idx}] ERR ${city} ${elapsed}ms - ${e.message||e}`);
      } finally {
        if (PAUSE_MS > 0) await sleep(PAUSE_MS);
      }
    }
  })());

  await Promise.all(workers);
  limiter.stop();
  console.log(`[${ts()}] Done. ok=${ok}, fail=${fail}. Report: ${outPath}`);
}

run().catch(e=>{
  console.error(e);
  process.exit(1);
});