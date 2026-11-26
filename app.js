/* 로또 번호 추천 — 랜덤·통계·취향·재미 추천, 번호 보관함, 당첨 자동 비교, 통계 */

// 화면에 표시되는 버전. 파일을 고칠 때 sw.js의 CACHE 이름 번호와 같이 올린다.
const APP_VERSION = 'v9';
const APP_DATE = '2026-11-26';

// ===== LOGIC START (화면과 무관한 순수 로직: 시험 대상) =====
const WEEK_MS = 7 * 24 * 3600 * 1000;
const ROUND1_MS = Date.UTC(2002, 11, 7, 20, 45); // 1회 추첨(한국 시간)을 UTC 필드로 표현

function kstNowMs(now = new Date()) {
  return now.getTime() + 9 * 3600 * 1000;
}

// 아직 추첨되지 않은 가장 가까운 회차
function nextRound(now = new Date()) {
  const passed = Math.floor((kstNowMs(now) - ROUND1_MS) / WEEK_MS) + 1;
  return passed + 1;
}

function roundDateLabel(round) {
  const d = new Date(ROUND1_MS + (round - 1) * WEEK_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function randInt(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % n;
}

const sortNums = (a) => [...a].sort((x, y) => x - y);

function shuffled(list, rand = randInt) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ALL = Array.from({ length: 45 }, (_, i) => i + 1);

function pickSix() {
  return sortNums(shuffled(ALL).slice(0, 6));
}

// weights[1..45]에 비례해 중복 없이 k개 뽑기
function weightedPick(weights, k) {
  const chosen = [];
  for (let t = 0; t < k; t++) {
    let total = 0;
    for (let n = 1; n <= 45; n++) if (!chosen.includes(n)) total += weights[n];
    let r = (randInt(1000000) / 1000000) * total;
    let pick = 0;
    for (let n = 1; n <= 45; n++) {
      if (chosen.includes(n)) continue;
      pick = n;
      r -= weights[n];
      if (r < 0) break;
    }
    chosen.push(pick);
  }
  return sortNums(chosen);
}

function computeStats(draws) {
  const count = new Array(46).fill(0);
  const last = new Array(46).fill(0);
  let latest = 0;
  for (const d of draws) {
    latest = Math.max(latest, d.round);
    for (const n of d.numbers) {
      count[n]++;
      if (d.round > last[n]) last[n] = d.round;
    }
  }
  const gap = new Array(46).fill(0);
  for (let n = 1; n <= 45; n++) gap[n] = last[n] ? latest - last[n] : draws.length;
  return { count, gap, latest, total: draws.length };
}

function isBalanced(nums) {
  const odd = nums.filter((n) => n % 2 === 1).length;
  const sum = nums.reduce((a, b) => a + b, 0);
  const buckets = new Set(nums.map((n) => Math.floor(n / 10)));
  return odd >= 2 && odd <= 4 && sum >= 100 && sum <= 170 && buckets.size >= 3;
}

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 재미 방식: 입력한 말 + 회차로 만든 시드로 고정된 결과
function genFun(keyword, round) {
  const rng = mulberry32(hashStr(`${keyword}|${round}`));
  const rand = (n) => Math.floor(rng() * n);
  return sortNums(shuffled(ALL, rand).slice(0, 6));
}

function parseFixed(text) {
  const nums = (String(text).match(/\d+/g) || []).map(Number).filter((n) => n >= 1 && n <= 45);
  return [...new Set(nums)].slice(0, 5);
}

// 'YYYY-MM-DD' -> 월, 일, 연도 끝 두 자리를 1~45 범위로
function dateNumbers(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!m) return [];
  const yy = Number(m[1]) % 100;
  const list = [Number(m[2]), Number(m[3]), yy % 45 || 45];
  return [...new Set(list.filter((n) => n >= 1 && n <= 45))];
}

// 취향 방식: 고정 번호 + 날짜 후보 최대 2개 + 무작위
function genTaste(fixed, dateNums) {
  const chosen = [...fixed];
  const limit = Math.min(6, fixed.length + 2);
  for (const c of shuffled(dateNums.filter((n) => !chosen.includes(n)))) {
    if (chosen.length >= limit) break;
    chosen.push(c);
  }
  for (const n of shuffled(ALL.filter((n) => !chosen.includes(n)))) {
    if (chosen.length >= 6) break;
    chosen.push(n);
  }
  return sortNums(chosen);
}

// 균형 조건: 조건을 만족할 때까지 다시 뽑고, 끝내 못 맞추면 마지막 결과를 그대로 사용
function withBalance(gen, tries = 3000) {
  let last = gen();
  if (isBalanced(last)) return { numbers: last, balanced: true };
  for (let i = 0; i < tries; i++) {
    last = gen();
    if (isBalanced(last)) return { numbers: last, balanced: true };
  }
  return { numbers: last, balanced: false };
}

const METHODS = {
  random: '랜덤',
  freq: '자주 나온 번호',
  gap: '오래 안 나온 번호',
  taste: '취향(고정 번호·날짜)',
  fun: '재미(꿈·이름·띠)',
};

// ctx: { stats, fixed, dateNums, keyword, round, balance }
function makeGame(method, ctx) {
  let note = '';
  let used = method;
  if ((method === 'freq' || method === 'gap') && !ctx.stats) {
    used = 'random';
    note = '당첨번호 데이터가 없어 랜덤으로 뽑았어요';
  }
  if (method === 'fun' && !ctx.keyword) {
    used = 'random';
    note = '입력한 말이 없어 랜덤으로 뽑았어요';
  }
  let gen;
  if (used === 'freq') gen = () => weightedPick(ctx.stats.count.map((c) => c + 1), 6);
  else if (used === 'gap') gen = () => weightedPick(ctx.stats.gap.map((g) => g + 1), 6);
  else if (used === 'taste') gen = () => genTaste(ctx.fixed, ctx.dateNums);
  else if (used === 'fun') gen = () => genFun(ctx.keyword, ctx.round);
  else gen = pickSix;

  let numbers;
  let balancedOk = null;
  if (ctx.balance && used !== 'fun') {
    const r = withBalance(gen);
    numbers = r.numbers;
    balancedOk = r.balanced;
    if (!r.balanced) note = (note ? note + ' · ' : '') + '균형 조건을 맞추지 못해 그대로 표시했어요';
  } else {
    numbers = gen();
    if (ctx.balance && used === 'fun') note = (note ? note + ' · ' : '') + '재미 방식은 균형 조건을 적용하지 않아요';
  }
  let label = METHODS[used];
  if (balancedOk) label += ' + 균형';
  return { numbers, method: label, note };
}

// 줄 단위 "회차 번호6개 보너스" 파싱 (날짜는 무시)
function parseDraws(text) {
  const draws = [];
  const bad = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const stripped = line.replace(/\d{4}\s*[-./]\s*\d{1,2}\s*[-./]\s*\d{1,2}/g, ' ');
    const ints = (stripped.match(/\d+/g) || []).map(Number);
    if (ints.length !== 8) {
      bad.push(line);
      continue;
    }
    const [round, ...rest] = ints;
    const nums = rest.slice(0, 6);
    const bonus = rest[6];
    const all = [...nums, bonus];
    if (round < 1 || all.some((n) => !(n >= 1 && n <= 45)) || new Set(all).size !== 7) {
      bad.push(line);
      continue;
    }
    draws.push({ round, numbers: sortNums(nums), bonus });
  }
  return { draws, bad };
}

// 등수 판정: 1등 6개, 2등 5개+보너스, 3등 5개, 4등 4개, 5등 3개
function rankOf(numbers, draw) {
  const hits = numbers.filter((n) => draw.numbers.includes(n));
  const bonus = numbers.includes(draw.bonus);
  let rank = 0;
  if (hits.length === 6) rank = 1;
  else if (hits.length === 5 && bonus) rank = 2;
  else if (hits.length === 5) rank = 3;
  else if (hits.length === 4) rank = 4;
  else if (hits.length === 3) rank = 5;
  return { rank, hits, bonus };
}
// 동행복권 JSON 응답에서 회차 정보를 찾아냄. 필드 이름이 바뀌어도 견디도록
// (ltEpsd/tm1WnNo~tm6WnNo/bnsWnNo, drwNo/drwtNo1~6/bnusNo) 중첩된 어디에 있든 찾는다.
function pickField(o, names) {
  for (const n of names) if (o[n] !== undefined && o[n] !== null && o[n] !== '') return o[n];
  return undefined;
}

function extractDraws(json) {
  const found = new Map();
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === 'object') {
      const round = Number(pickField(node, ['ltEpsd', 'drwNo', 'round']));
      const nums = [1, 2, 3, 4, 5, 6].map((i) => Number(pickField(node, [`tm${i}WnNo`, `drwtNo${i}`])));
      const bonus = Number(pickField(node, ['bnsWnNo', 'bnusNo', 'bonus']));
      const all = [...nums, bonus];
      if (Number.isInteger(round) && round >= 1 && all.every((n) => Number.isInteger(n) && n >= 1 && n <= 45) && new Set(all).size === 7) {
        found.set(round, { round, numbers: sortNums(nums), bonus });
      }
      Object.values(node).forEach(visit);
    }
  };
  visit(json);
  return [...found.values()].sort((a, b) => a.round - b.round);
}

// 진단용: 응답 JSON의 최상위 키와 첫 배열 원소의 키
function sampleKeys(json) {
  const top = json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json).slice(0, 12) : [];
  let inner = [];
  const find = (node, depth) => {
    if (inner.length || depth > 4 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      const first = node.find((x) => x && typeof x === 'object' && !Array.isArray(x));
      if (first) {
        inner = Object.keys(first).slice(0, 16);
        return;
      }
    }
    Object.values(node).forEach((v) => find(v, depth + 1));
  };
  find(json, 0);
  return { top, inner };
}
// 회차별 요약: 게임마다 맞은 번호·틀린 번호·등수
function summarizeRound(tickets, draw) {
  const games = tickets.map((t) => {
    const res = rankOf(t.numbers, draw);
    const miss = t.numbers.filter((n) => !res.hits.includes(n));
    return { ticket: t, rank: res.rank, hits: res.hits, miss, bonusHit: res.bonus && !res.hits.includes(draw.bonus) && t.numbers.includes(draw.bonus) };
  });
  const ranks = games.map((g) => g.rank).filter((x) => x > 0);
  return { games, wins: ranks.length, best: ranks.length ? Math.min(...ranks) : 0 };
}

// 다양한 통계: 홀짝·합계·구간·연속·직전 회차 겹침·보너스·최근 N회
function extraStats(draws) {
  const sorted = [...draws].sort((a, b) => a.round - b.round);
  const total = sorted.length;
  const odd = new Array(7).fill(0);
  const sumLabels = ['99 이하', '100~119', '120~139', '140~159', '160~179', '180 이상'];
  const sumBins = new Array(6).fill(0);
  const decLabels = ['1~10', '11~20', '21~30', '31~40', '41~45'];
  const dec = new Array(5).fill(0);
  const bonus = new Array(46).fill(0);
  let consec = 0;
  let overlapSum = 0;
  let overlapN = 0;
  const byRound = new Map(sorted.map((d) => [d.round, d]));
  for (const d of sorted) {
    odd[d.numbers.filter((n) => n % 2 === 1).length]++;
    const sum = d.numbers.reduce((a, b) => a + b, 0);
    sumBins[sum < 100 ? 0 : Math.min(5, Math.floor((sum - 100) / 20) + 1)]++;
    for (const n of d.numbers) dec[Math.min(4, Math.floor((n - 1) / 10))]++;
    bonus[d.bonus]++;
    const ns = d.numbers;
    if (ns.some((n, i) => i > 0 && n - ns[i - 1] === 1)) consec++;
    const prev = byRound.get(d.round - 1);
    if (prev) {
      overlapSum += d.numbers.filter((n) => prev.numbers.includes(n)).length;
      overlapN++;
    }
  }
  return { total, odd, sumLabels, sumBins, decLabels, dec, bonus, consec, overlapAvg: overlapN ? overlapSum / overlapN : 0, overlapN };
}

// 최근 n회차의 번호별 출현 횟수
function recentCounts(draws, n) {
  const top = [...draws].sort((a, b) => b.round - a.round).slice(0, n);
  const count = new Array(46).fill(0);
  for (const d of top) for (const x of d.numbers) count[x]++;
  return { count, used: top.length };
}
// ===== LOGIC END =====

// ---------- 저장소 (IndexedDB) ----------
const DB_NAME = 'lotto-app';
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tickets')) db.createObjectStore('tickets', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('draws')) db.createObjectStore('draws', { keyPath: 'round' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dbPromise = openDB();

async function run(store, mode, fn) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const request = fn(t.objectStore(store));
    t.oncomplete = () => resolve(request ? request.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const getSetting = async (key) => {
  const row = await run('settings', 'readonly', (s) => s.get(key));
  return row ? row.value : undefined;
};
const setSetting = (key, value) => run('settings', 'readwrite', (s) => s.put({ key, value }));
const addTicket = (ticket) => run('tickets', 'readwrite', (s) => s.add(ticket));
const allTickets = () => run('tickets', 'readonly', (s) => s.getAll());
const deleteTicket = (id) => run('tickets', 'readwrite', (s) => s.delete(id));
const clearTickets = () => run('tickets', 'readwrite', (s) => s.clear());
const putDraw = (draw) => run('draws', 'readwrite', (s) => s.put(draw));
const allDraws = () => run('draws', 'readonly', (s) => s.getAll());

// ---------- 화면 공통 ----------
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ballClass(n) {
  if (n <= 10) return 'c1';
  if (n <= 20) return 'c2';
  if (n <= 30) return 'c3';
  if (n <= 40) return 'c4';
  return 'c5';
}

function ballsHtml(numbers, hits = [], bonus = null) {
  const main = numbers.map((n) => `<span class="ball ${ballClass(n)}${hits.includes(n) ? ' hit' : ''}">${n}</span>`).join('');
  const extra = bonus ? `<span class="plus">+</span><span class="ball ${ballClass(bonus)} bonus">${bonus}</span>` : '';
  return main + extra;
}

// ---------- 추천 탭 ----------
const MARK = 'ABCDE';
let current = [];

function renderMethodSelects() {
  const count = Number($('#game-count').value);
  const box = $('#game-methods');
  const prev = [...box.querySelectorAll('select')].map((s) => s.value);
  box.innerHTML = Array.from({ length: count }, (_, i) => {
    const opts = Object.entries(METHODS)
      .map(([v, l]) => `<option value="${v}"${prev[i] === v ? ' selected' : ''}>${l}</option>`)
      .join('');
    return `<div class="method-row"><span class="label">${MARK[i]}</span><select id="method-${i}">${opts}</select></div>`;
  }).join('');
}

function renderResults() {
  $('#results').innerHTML = current
    .map(
      (g, i) => `
      <div class="game-block">
        <div class="game">
          <span class="label">${MARK[i]}</span>
          <div class="balls">${ballsHtml(g.numbers)}</div>
          <button class="small" data-save="${i}" ${g.saved ? 'disabled' : ''}>${g.saved ? '저장됨' : '저장'}</button>
        </div>
        <p class="method-tag">${esc(g.method)}${g.note ? ' · ' + esc(g.note) : ''}</p>
      </div>`
    )
    .join('');
  $('#save-all-btn').hidden = current.length === 0;
}

async function draw() {
  const count = Number($('#game-count').value);
  const draws = await allDraws();
  const ctx = {
    stats: draws.length ? computeStats(draws) : null,
    fixed: parseFixed($('#fixed-input').value),
    dateNums: dateNumbers($('#date-input').value),
    keyword: $('#fun-input').value.trim(),
    round: nextRound(),
    balance: $('#balance').checked,
  };
  current = Array.from({ length: count }, (_, i) => {
    const g = makeGame($(`#method-${i}`).value, ctx);
    g.saved = false;
    return g;
  });
  renderResults();
}

async function saveGame(i) {
  const g = current[i];
  if (!g || g.saved) return;
  await addTicket({ round: nextRound(), numbers: g.numbers, method: g.method, savedAt: Date.now() });
  g.saved = true;
  renderResults();
}

// ---------- 보관함 탭 ----------
let vaultRound = null; // null이면 회차 목록, 숫자면 그 회차의 상세 화면

const nlist = (a) => (a.length ? a.join(', ') : '없음');

async function renderVault() {
  const list = $('#vault-list');
  const banner = $('#vault-banner');
  const [tickets, draws] = await Promise.all([allTickets(), allDraws()]);
  const drawMap = new Map(draws.map((d) => [d.round, d]));
  if (tickets.length === 0) {
    vaultRound = null;
    banner.innerHTML = '';
    list.innerHTML = '<p class="empty">저장한 번호가 없습니다.<br>추천 탭에서 번호를 뽑아 저장해 보세요.</p>';
    return;
  }
  const expectedLatest = nextRound() - 1;
  const byRound = new Map();
  for (const t of tickets) {
    if (!byRound.has(t.round)) byRound.set(t.round, []);
    byRound.get(t.round).push(t);
  }
  for (const arr of byRound.values()) arr.sort((a, b) => a.savedAt - b.savedAt);
  if (vaultRound !== null && !byRound.has(vaultRound)) vaultRound = null;

  if (vaultRound === null) {
    const waiting = tickets.some((t) => t.round <= expectedLatest && !drawMap.has(t.round));
    banner.innerHTML = waiting
      ? '<p class="banner">당첨번호가 없는 회차가 있어요. 설정 화면에서 "지금 새 회차 확인"을 누르면 자동으로 비교합니다.</p>'
      : '';
    const rounds = [...byRound.keys()].sort((a, b) => b - a);
    list.innerHTML = rounds
      .map((r) => {
        const ts = byRound.get(r);
        const d = drawMap.get(r);
        let balls = '';
        let badge;
        if (d) {
          const sum = summarizeRound(ts, d);
          balls = `<div class="win-line">당첨번호 ${ballsHtml(d.numbers, [], d.bonus)}</div>`;
          badge = sum.wins ? `<span class="rank r${sum.best}">${sum.best}등 (${sum.wins}게임 당첨)</span>` : '<span class="rank r0">낙첨</span>';
        } else if (r > expectedLatest) {
          badge = '<span class="rank r0">추첨 전</span>';
        } else {
          badge = '<span class="rank r0">당첨번호 없음</span>';
        }
        return `<button class="round-item" data-round="${r}">
          <span class="ri-head"><b>제 ${r}회</b> <span class="ri-date">${roundDateLabel(r)} 추첨</span><span class="ri-go">›</span></span>
          ${balls}
          <span class="ri-foot">저장 ${ts.length}게임 ${badge}</span>
        </button>`;
      })
      .join('');
    return;
  }

  // 상세 화면
  banner.innerHTML = '';
  const r = vaultRound;
  const ts = byRound.get(r);
  const d = drawMap.get(r);
  let head;
  let sumLine = '';
  let games;
  if (d) {
    const sum = summarizeRound(ts, d);
    head = `<div class="win-line">당첨번호 ${ballsHtml(d.numbers, [], d.bonus)}</div>`;
    sumLine = `<p class="hint">${ts.length}게임 중 ${sum.wins ? `${sum.wins}게임 당첨 (최고 ${sum.best}등)` : '당첨 없음'}</p>`;
    games = sum.games
      .map((g, i) => {
        const balls = g.ticket.numbers
          .map((n) => {
            const cls = g.hits.includes(n) ? ' hit' : n === d.bonus ? ' bhit' : ' miss';
            return `<span class="ball ${ballClass(n)}${cls}">${n}</span>`;
          })
          .join('');
        const badge = g.rank ? `<span class="rank r${g.rank}">${g.rank}등</span>` : '<span class="rank r0">낙첨</span>';
        return `
        <div class="game-block">
          <div class="game"><span class="label">${MARK[i] || i + 1}</span><div class="balls">${balls}</div>${badge}</div>
          <p class="match-line"><b>맞은 번호 ${g.hits.length}개</b>: ${nlist(g.hits)}<br><b>틀린 번호 ${g.miss.length}개</b>: ${nlist(g.miss)}${g.bonusHit ? `<br>보너스 번호 ${d.bonus} 일치` : ''}</p>
          <p class="method-tag">${esc(g.ticket.method || '')} <button class="small" data-del="${g.ticket.id}">삭제</button></p>
        </div>`;
      })
      .join('');
  } else {
    head = r > expectedLatest ? '<p class="hint">아직 추첨 전입니다. 추첨 뒤 설정에서 "지금 새 회차 확인"을 누르면 결과가 표시돼요.</p>' : '<p class="hint">이 회차 당첨번호가 아직 없어요. 설정에서 "지금 새 회차 확인"을 눌러 보세요.</p>';
    games = ts
      .map(
        (t, i) => `
        <div class="game-block">
          <div class="game"><span class="label">${MARK[i] || i + 1}</span><div class="balls">${ballsHtml(t.numbers)}</div></div>
          <p class="method-tag">${esc(t.method || '')} <button class="small" data-del="${t.id}">삭제</button></p>
        </div>`
      )
      .join('');
  }
  list.innerHTML = `<button class="small" data-back="1">← 회차 목록</button>
    <h3 class="detail-h">제 ${r}회 (${roundDateLabel(r)} 추첨)</h3>${head}${sumLine}${games}`;
}

// ---------- 당첨 통계 탭 ----------
const barRow = (label, value, max, text) =>
  `<tr><td class="bl">${label}</td><td class="bb"><span class="bar" style="width:${max ? Math.round((value / max) * 100) : 0}%"></span></td><td class="bv">${text}</td></tr>`;

async function renderStats() {
  const body = $('#stats-body');
  const draws = await allDraws();
  if (draws.length === 0) {
    body.innerHTML = `<div class="card"><h2>당첨 통계</h2>
      <p>저장된 당첨번호가 없습니다. 설정 화면에서 당첨번호를 가져오면 최신 결과와 번호별 통계를 볼 수 있어요.</p></div>`;
    return;
  }
  const stats = computeStats(draws);
  const ex = extraStats(draws);
  const latest = draws.find((d) => d.round === stats.latest);
  const missing = stats.latest < nextRound() - 1;
  const minRound = Math.min(...draws.map((d) => d.round));
  const holes = stats.latest - minRound + 1 - stats.total;
  const idx = Array.from({ length: 45 }, (_, i) => i + 1);
  const topFreq = [...idx].sort((a, b) => stats.count[b] - stats.count[a] || a - b).slice(0, 10);
  const topGap = [...idx].sort((a, b) => stats.gap[b] - stats.gap[a] || a - b).slice(0, 10);
  const small = (n) => `<span class="ball small-ball ${ballClass(n)}">${n}</span>`;
  const rowsFreq = topFreq.map((n) => `<tr><td>${small(n)}</td><td>${stats.count[n]}회</td></tr>`).join('');
  const rowsGap = topGap.map((n) => `<tr><td>${small(n)}</td><td>${stats.gap[n]}회차째 안 나옴</td></tr>`).join('');

  const maxC = Math.max(...stats.count.slice(1));
  const grid = idx.map((n) => `<div class="cell" style="--h:${maxC ? stats.count[n] / maxC : 0}">${small(n)}<span>${stats.count[n]}</span></div>`).join('');

  const rec = recentCounts(draws, 10);
  const recTop = [...idx].sort((a, b) => rec.count[b] - rec.count[a] || a - b).filter((n) => rec.count[n] > 0).slice(0, 8);
  const recHtml = recTop.map((n) => `<tr><td>${small(n)}</td><td>${rec.count[n]}회</td></tr>`).join('');

  const t = ex.total;
  const pct = (v) => `${v}회 (${Math.round((v / t) * 100)}%)`;
  const maxOdd = Math.max(...ex.odd);
  const oddRows = ex.odd.map((v, k) => barRow(`홀${k}:짝${6 - k}`, v, maxOdd, pct(v))).reverse().join('');
  const maxSum = Math.max(...ex.sumBins);
  const sumRows = ex.sumBins.map((v, k) => barRow(ex.sumLabels[k], v, maxSum, pct(v))).join('');
  const maxDec = Math.max(...ex.dec);
  const decRows = ex.dec.map((v, k) => barRow(ex.decLabels[k], v, maxDec, `${Math.round((v / (t * 6)) * 100)}%`)).join('');
  const topBonus = [...idx].sort((a, b) => ex.bonus[b] - ex.bonus[a] || a - b).filter((n) => ex.bonus[n] > 0).slice(0, 5);
  const bonusHtml = topBonus.map((n) => `<tr><td>${small(n)}</td><td>${ex.bonus[n]}회</td></tr>`).join('');

  body.innerHTML = `
    ${holes > 0 ? `<p class="banner">저장된 회차 중간에 빠진 회차가 ${holes}개 있어요. 통계가 정확하지 않을 수 있으니 설정에서 자동 가져오기를 다시 눌러 주세요.</p>` : ''}
    ${missing ? `<p class="banner">제 ${nextRound() - 1}회 당첨번호가 아직 없어요. 설정 화면에서 "지금 새 회차 확인"을 눌러 주세요.</p>` : ''}
    <div class="card">
      <h2>최신 저장 회차: 제 ${stats.latest}회</h2>
      <div class="win-line">${ballsHtml(latest.numbers, [], latest.bonus)}</div>
      <p class="hint">저장된 ${stats.total}개 회차(제 ${minRound}~${stats.latest}회) 기준 통계입니다. 보너스 번호는 제외하고 집계하며, 별도 표시한 항목만 예외예요.</p>
    </div>
    <div class="card"><h2>번호별 출현 횟수 (1~45)</h2><div class="grid45">${grid}</div></div>
    <div class="card"><h2>많이 나온 번호 TOP 10</h2><table class="stat">${rowsFreq}</table></div>
    <div class="card"><h2>오래 안 나온 번호 TOP 10</h2><table class="stat">${rowsGap}</table></div>
    <div class="card"><h2>최근 ${rec.used}회 자주 나온 번호</h2><table class="stat">${recHtml}</table></div>
    <div class="card"><h2>홀짝 비율</h2><table class="bars">${oddRows}</table></div>
    <div class="card"><h2>번호 합계 구간</h2><table class="bars">${sumRows}</table></div>
    <div class="card"><h2>번호 구간별 비율</h2><table class="bars">${decRows}</table></div>
    <div class="card"><h2>이어진 번호와 직전 회차 겹침</h2>
      <table class="stat">
        <tr><td>연속 번호(예: 14, 15)가 있던 회차</td><td>${pct(ex.consec)}</td></tr>
        <tr><td>직전 회차와 겹친 번호 평균</td><td>${ex.overlapN ? ex.overlapAvg.toFixed(2) + '개' : '계산 불가'}</td></tr>
      </table>
    </div>
    <div class="card"><h2>보너스 번호 많이 나온 번호 TOP 5</h2><table class="stat">${bonusHtml}</table></div>
    <p class="notice">과거 통계는 다음 추첨 결과와 무관합니다. 참고용으로만 보세요.</p>`;
}

// ---------- 설정 탭 ----------
async function refreshDrawStatus() {
  const draws = await allDraws();
  const el = $('#draw-status');
  if (draws.length === 0) {
    el.textContent = '저장된 당첨번호가 없습니다.';
    return;
  }
  const latest = Math.max(...draws.map((d) => d.round));
  el.textContent = `저장된 회차 ${draws.length}개, 최신 제 ${latest}회 (현재 마지막 추첨 회차는 제 ${nextRound() - 1}회)`;
}

async function importDraws() {
  const out = $('#import-out');
  const { draws, bad } = parseDraws($('#import-text').value);
  for (const d of draws) await putDraw(d);
  let msg = `${draws.length}개 회차를 저장했어요.`;
  if (bad.length) msg += `\n형식이 맞지 않아 건너뛴 줄 ${bad.length}개. 첫 줄: ${bad[0].slice(0, 60)}`;
  out.textContent = msg;
  if (draws.length) $('#import-text').value = '';
  refreshDrawStatus();
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportBackup() {
  const [tickets, draws] = await Promise.all([allTickets(), allDraws()]);
  const data = { app: 'lotto-app', version: 1, exportedAt: new Date().toISOString(), tickets, draws };
  download(`lotto-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data));
  $('#backup-out').textContent = `보관함 ${tickets.length}개, 당첨번호 ${draws.length}개를 파일로 내려받았어요.`;
}

async function restoreBackup(file) {
  const out = $('#backup-out');
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'lotto-app' || !Array.isArray(data.tickets) || !Array.isArray(data.draws)) throw new Error('이 앱의 백업 파일이 아닙니다.');
    let t = 0;
    let d = 0;
    for (const x of data.tickets) {
      if (Array.isArray(x.numbers) && x.numbers.length === 6 && x.numbers.every((n) => n >= 1 && n <= 45) && x.round >= 1) {
        await addTicket({ round: x.round, numbers: sortNums(x.numbers), method: String(x.method || ''), savedAt: Number(x.savedAt) || Date.now() });
        t++;
      }
    }
    for (const x of data.draws) {
      const { draws, bad } = parseDraws(`${x.round} ${(x.numbers || []).join(' ')} ${x.bonus}`);
      if (draws.length && !bad.length) {
        await putDraw(draws[0]);
        d++;
      }
    }
    out.textContent = `보관함 ${t}개, 당첨번호 ${d}개를 불러왔어요. (같은 번호가 이미 있으면 중복될 수 있어요)`;
    refreshDrawStatus();
  } catch (err) {
    out.textContent = `불러오지 못했어요: ${err.message || err}`;
  }
}

// 동행복권 개편 후 결과 페이지가 쓰는 JSON 주소 (공식 공개 API가 아니라 바뀔 수 있음)
const apiUrl = (round) => `https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd=${round}`;

async function fetchOne(round) {
  const res = await fetch(apiUrl(round), { cache: 'no-store' });
  const type = res.headers.get('content-type') || '';
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    json = null;
  }
  return { status: res.status, type, text, json };
}

// 자동 가져오기(시험): 한 번에 10회차 안팎만 오므로, 최근 100회차 중 빠진 곳을 찾아 이어서 요청한다.
// 빈 회차가 남으면 "오래 안 나온 번호" 통계가 틀어지기 때문에 빈 곳이 없을 때까지 반복한다.
async function autoFetch() {
  const out = $('#auto-out');
  const latest = nextRound() - 1;
  const TARGET = 100;
  const BUDGET = 24;
  const lo = Math.max(1, latest - TARGET + 1);
  const have = new Set();
  const lines = [`제 ${lo}~${latest}회를 가져옵니다. (최대 ${BUDGET}번 요청)`];
  out.textContent = lines.join('\n');
  const topRound = () => (have.size ? Math.max(...have) : latest);
  const firstMissing = () => {
    for (let r = topRound(); r >= lo; r--) if (!have.has(r)) return r;
    return 0;
  };
  let center = latest;
  let requests = 0;
  let failed = false;
  while (center && requests < BUDGET) {
    requests++;
    try {
      const r = await fetchOne(center);
      if (!r.json) {
        const title = (/<title[^>]*>([^<]*)/i.exec(r.text) || [])[1];
        lines.push(`[실패] 중심 ${center}회: 응답 코드 ${r.status}, 형식 ${r.type || '알 수 없음'}, JSON이 아님${title ? ', 페이지 제목: ' + title.trim().slice(0, 60) : ''}\n앞부분: ${r.text.slice(0, 160).replace(/\s+/g, ' ')}`);
        failed = true;
        break;
      }
      const draws = extractDraws(r.json);
      if (!draws.length) {
        const k = sampleKeys(r.json);
        lines.push(`[실패] 중심 ${center}회: JSON은 왔지만 회차 번호를 찾지 못했어요.\n최상위 키: ${k.top.join(', ') || '(없음)'}\n목록 항목 키: ${k.inner.join(', ') || '(없음)'}`);
        failed = true;
        break;
      }
      const before = have.size;
      for (const d of draws) {
        await putDraw(d);
        if (d.round >= lo && d.round <= latest) have.add(d.round);
      }
      lines.push(`[성공] 중심 ${center}회: ${draws.length}개 (${draws[0].round}~${draws[draws.length - 1].round}회)`);
      if (have.size === before) {
        lines.push('새로 받은 회차가 없어 여기서 멈춥니다.');
        break;
      }
    } catch (err) {
      lines.push(`[실패] 중심 ${center}회: ${String(err)}\n브라우저 보안 정책(CORS)이나 네트워크 문제로 막혔을 수 있어요.`);
      failed = true;
      break;
    }
    center = firstMissing();
    out.textContent = lines.join('\n');
    await new Promise((res) => setTimeout(res, 300));
  }
  const missing = [];
  for (let r = topRound(); r >= lo; r--) if (!have.has(r)) missing.push(r);
  lines.push('');
  if (have.size === 0) lines.push('자동 가져오기에 실패했어요. 위의 붙여넣기 방식을 쓰고, 이 화면을 캡처해 알려 주세요.');
  else {
    lines.push(`${have.size}개 회차를 저장했어요 (최신 ${topRound()}회, 요청 ${requests}번). 겹치는 회차는 덮어써서 중복되지 않아요.`);
    if (topRound() < latest) lines.push(`제 ${latest}회 결과는 아직 올라오지 않았을 수 있어요.`);
    if (missing.length) lines.push(`빠진 회차 ${missing.length}개가 남았어요 (예: ${missing.slice(0, 5).join(', ')}회). 다시 눌러 보세요.`);
    if (failed) lines.push('중간에 실패해 일부만 저장됐어요. 다시 눌러 보세요.');
  }
  out.textContent = lines.join('\n');
  refreshDrawStatus();
}

// 앱을 열 때 새 회차가 있는지 조용히 확인한다. (10분 안에는 다시 시도하지 않음, 실패해도 화면은 그대로)
async function autoSync(force = false) {
  const el = $('#sync-status');
  if (force) el.textContent = '동행복권에서 새 당첨번호를 확인하는 중…';
  const say = async (body) => {
    const t = new Date();
    const msg = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} 확인 · ${body}`;
    el.textContent = msg;
    try {
      await setSetting('lastSyncMsg', msg);
    } catch (e) {
      /* 저장 실패는 무시 */
    }
  };
  try {
    const last = await getSetting('lastSyncAt');
    if (!force && last && Date.now() - last < 10 * 60 * 1000) {
      el.textContent = (await getSetting('lastSyncMsg')) || '';
      return;
    }
    const latest = nextRound() - 1;
    const have = new Set((await allDraws()).map((d) => d.round));
    if (have.has(latest)) {
      await say(`최신 제 ${latest}회 당첨번호가 이미 저장되어 있어요. 새로 가져올 회차가 없습니다. (다음 추첨: 제 ${nextRound()}회, ${roundDateLabel(nextRound())})`);
      return;
    }
    await setSetting('lastSyncAt', Date.now());
    const lo = have.size ? Math.max(...have) : Math.max(1, latest - 9);
    let center = latest;
    let requests = 0;
    let added = 0;
    while (center && requests < 8) {
      requests++;
      const r = await fetchOne(center);
      const draws = r.json ? extractDraws(r.json) : [];
      if (!draws.length) throw new Error(r.json ? '회차 정보를 찾지 못했어요' : `JSON이 아닌 응답(${r.status})`);
      let now = 0;
      for (const d of draws) {
        if (!have.has(d.round)) {
          now++;
          have.add(d.round);
        }
        await putDraw(d);
      }
      added += now;
      if (!now) break;
      center = 0;
      for (let x = Math.max(...have); x > lo; x--) {
        if (!have.has(x)) {
          center = x;
          break;
        }
      }
    }
    const top = have.size ? Math.max(...have) : 0;
    let msg = added ? `새 당첨번호 ${added}개 회차를 가져왔어요. 지금 최신은 제 ${top}회입니다.` : `새 당첨번호가 아직 없어요. 지금 최신은 제 ${top}회입니다.`;
    if (top < latest) msg += ` 제 ${latest}회 결과는 동행복권에 아직 올라오지 않았을 수 있어요. 잠시 뒤 다시 눌러 보세요.`;
    await say(msg);
    if (added) {
      const active = document.querySelector('.tab.active');
      if (active && (active.id === 'tab-vault' || active.id === 'tab-stats')) showTab(active.id);
      refreshDrawStatus();
    }
  } catch (err) {
    await say(`확인하지 못했어요 (${err && err.message ? err.message : err}). 인터넷 연결을 확인하고 다시 눌러 보세요. 계속 안 되면 아래 자동 가져오기나 붙여넣기를 쓰세요.`);
  }
}

// ---------- 탭 전환과 시작 ----------
function showTab(id) {
  document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.id === id));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
  if (id === 'tab-vault') {
    vaultRound = null;
    renderVault();
  }
  if (id === 'tab-stats') renderStats();
  if (id === 'tab-settings') refreshDrawStatus();
}

async function showVersion() {
  $('#ver').textContent = APP_VERSION;
  let cache = '확인 불가';
  try {
    if (typeof caches !== 'undefined') {
      const keys = (await caches.keys()).filter((k) => k.startsWith('lotto-app-'));
      cache = keys.length ? keys.map((k) => k.replace('lotto-app-', '')).join(', ') : '없음';
    }
  } catch (e) {
    cache = '확인 불가';
  }
  const note = cache === APP_VERSION || cache === '확인 불가' || cache === '없음' ? '' : '\n저장된 앱 파일이 옛 버전일 수 있어요. 앱을 완전히 닫았다가 다시 열어 보세요.';
  $('#about').textContent = `앱 버전: ${APP_VERSION} (${APP_DATE})\n저장된 앱 파일 버전: ${cache}${note}`;
}

function init() {
  showVersion();
  autoSync();
  $('#round-label').textContent = `다음 추첨: 제 ${nextRound()}회 (${roundDateLabel(nextRound())})`;
  renderMethodSelects();

  $('#game-count').addEventListener('change', renderMethodSelects);
  $('#draw-btn').addEventListener('click', draw);
  $('#save-all-btn').addEventListener('click', async () => {
    for (let i = 0; i < current.length; i++) await saveGame(i);
  });
  $('#results').addEventListener('click', (e) => {
    const i = e.target.dataset && e.target.dataset.save;
    if (i !== undefined) saveGame(Number(i));
  });
  $('#vault-list').addEventListener('click', async (e) => {
    const el = e.target.closest ? e.target.closest('[data-round],[data-back],[data-del]') : null;
    if (!el) return;
    if (el.dataset.del !== undefined) {
      await deleteTicket(Number(el.dataset.del));
    } else if (el.dataset.back !== undefined) {
      vaultRound = null;
    } else {
      vaultRound = Number(el.dataset.round);
    }
    await renderVault();
    window.scrollTo && window.scrollTo(0, 0);
  });
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const tab = e.target.dataset && e.target.dataset.tab;
    if (tab) showTab(tab);
  });
  $('#import-btn').addEventListener('click', importDraws);
  $('#export-btn').addEventListener('click', exportBackup);
  $('#restore-btn').addEventListener('click', () => $('#restore-file').click());
  $('#restore-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) restoreBackup(f);
    e.target.value = '';
  });
  $('#auto-btn').addEventListener('click', autoFetch);
  $('#sync-btn').addEventListener('click', () => autoSync(true));
  $('#reset-btn').addEventListener('click', async () => {
    if (confirm('보관함의 저장된 번호를 모두 삭제할까요? 되돌릴 수 없습니다.')) {
      await clearTickets();
      renderVault();
    }
  });

  getSetting('introSeen').then((seen) => {
    if (!seen) {
      const dlg = $('#intro');
      dlg.showModal();
      $('#intro-ok').addEventListener('click', async () => {
        await setSetting('introSeen', true);
        dlg.close();
      });
    }
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

// 브라우저에서만 실행 (시험 환경에서는 건너뜀)
if (typeof document !== 'undefined') init();
