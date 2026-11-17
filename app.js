'use strict';
/* ============================================================
   Hotel Revenue - dashboard publik + input revenue (wajib login)
   Backend: Supabase (Postgres + Auth + RLS)
   ============================================================ */
const cfg = window.APP_CONFIG || {};
const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_URL.includes('YOUR_'));
const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

const COLORS = { espresso:'#2C221E', taupe:'#8C6D53', taupeLight:'#A68A72', amberSoft:'#C4A484', forestGreen:'#4E775A', terracotta:'#A85A5A', goldAccent:'#D4AF37', border:'#EAE6E1' };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CAT_LABEL = { resto:'Resto & Bar', event:'Events' };
const state = { userId:null, email:null, outlets:[], charts:{}, inputBuilt:false };

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const rp = n => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
const rpShort = n => {
  const a = Math.abs(n || 0);
  if (a >= 1e9) return 'Rp ' + (n/1e9).toLocaleString('id-ID', {maximumFractionDigits:2}) + ' M';
  if (a >= 1e6) return 'Rp ' + (n/1e6).toLocaleString('id-ID', {maximumFractionDigits:1}) + ' Jt';
  return rp(n);
};
const pct = (n, d = 1) => (n || 0).toLocaleString('id-ID', {minimumFractionDigits:d, maximumFractionDigits:d}) + '%';
const chg = (c, p) => (p > 0 ? (c - p) / p * 100 : null);
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();

function toast(msg, type = 'ok') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg text-xs font-medium shadow-lg text-white ' + (type === 'err' ? 'bg-terracotta' : 'bg-forestGreen');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.add('hidden'), 3800);
}
const icons = () => { if (window.lucide) lucide.createIcons(); };

// Supabase membatasi 1000 baris per request -> ambil bertahap.
async function fetchAll(makeQuery) {
  const size = 1000; let from = 0, all = [];
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + size - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < size) break;
    from += size;
  }
  return all;
}

async function loadOutlets() {
  if (state.outlets.length) return;
  const { data, error } = await sb.from('outlets').select('*').eq('active', true).order('sort_order');
  if (error) throw error;
  state.outlets = data;
}

/* ---------- auth & routing ---------- */
function setUser(session) {
  state.userId = session?.user?.id || null;
  state.email = session?.user?.email || null;
}

function renderNav(view) {
  const link = (href, label, active) => `<a href="${href}" class="btn ${active ? 'btn-primary' : 'btn-ghost'}">${label}</a>`;
  let html = link('#/', 'Dashboard', view === 'dashboard');
  if (state.userId) {
    html += link('#/input', 'Input Revenue', view === 'input');
    html += `<button id="btn-logout" class="btn btn-ghost"><i data-lucide="log-out" class="w-3.5 h-3.5"></i>Logout</button>`;
  } else {
    html += link('#/login', 'Login', view === 'login');
  }
  $('nav').innerHTML = html;
  const lo = $('btn-logout');
  if (lo) lo.onclick = async () => { await sb.auth.signOut(); setUser(null); location.hash = '#/'; route(); };
  icons();
}

function route() {
  const h = location.hash || '#/';
  let view = 'dashboard';
  if (h.startsWith('#/input') || h.startsWith('#/login')) view = state.userId ? 'input' : 'login';
  const want = view === 'dashboard' ? '#/' : '#/' + view;
  if (!h.startsWith(want) && !(view === 'dashboard' && (h === '#/' || h === '#' || h === ''))) history.replaceState(null, '', want);
  ['dashboard', 'login', 'input'].forEach(v => $('view-' + v).classList.toggle('hidden', v !== view));
  renderNav(view);
  if (!sb) return;
  if (view === 'dashboard') loadDashboard();
  if (view === 'input') initInput();
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function buildPeriodSelect() {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  const last = new Date(y, m - 1, 1);
  $('period').innerHTML = `
    <option value="mtd">Month to Date (${MONTHS[m]} ${y})</option>
    <option value="yesterday">Yesterday</option>
    <option value="last">Last Month (${MONTHS[last.getMonth()]} ${last.getFullYear()})</option>
    <option value="ytd">Year to Date (${y})</option>
    <option value="custom">Custom Range...</option>`;
  const f = $('range-from'), t = $('range-to');
  f.value = iso(new Date(y, m, 1)); t.value = iso(n);
}

function getRange(key) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  let start, end, prevStart, prevEnd, vs;
  if (key === 'yesterday') {
    start = new Date(y, m, n.getDate() - 1); end = start;
    prevStart = new Date(y, m, n.getDate() - 2); prevEnd = prevStart;
    vs = 'day before';
  } else if (key === 'mtd') {
    start = new Date(y, m, 1); end = n;
    prevStart = new Date(y, m - 1, 1); prevEnd = new Date(y, m - 1, Math.min(n.getDate(), daysIn(y, m - 1)));
    vs = 'last month';
  } else if (key === 'last') {
    start = new Date(y, m - 1, 1); end = new Date(y, m, 0);
    prevStart = new Date(y, m - 2, 1); prevEnd = new Date(y, m - 1, 0);
    vs = 'prior month';
  } else if (key === 'ytd') {
    start = new Date(y, 0, 1); end = n;
    prevStart = new Date(y - 1, 0, 1); prevEnd = new Date(y - 1, m, Math.min(n.getDate(), daysIn(y - 1, m)));
    vs = 'last year';
  } else {
    start = parseISO($('range-from').value); end = parseISO($('range-to').value);
    const len = Math.round((end - start) / 86400000) + 1;
    prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
    prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - (len - 1));
    vs = 'prev period';
  }
  return { start, end, prevStart, prevEnd, vs };
}

function aggregate(rev, from, to) {
  const catOf = {}; state.outlets.forEach(o => catOf[o.id] = o.category);
  const r = { byOutlet:{}, byCat:{ resto:0, event:0 }, total:0, daily:{} };
  for (const x of rev) {
    if (x.rev_date < from || x.rev_date > to) continue;
    const c = catOf[x.outlet_id]; if (!c) continue;
    const a = Number(x.amount) || 0;
    r.byOutlet[x.outlet_id] = (r.byOutlet[x.outlet_id] || 0) + a;
    r.byCat[c] += a; r.total += a;
    const d = r.daily[x.rev_date] = r.daily[x.rev_date] || { resto:0, event:0 };
    d[c] += a;
  }
  r.activeDays = Object.values(r.daily).filter(d => d.resto + d.event > 0).length;
  r.avgDaily = r.activeDays ? r.total / r.activeDays : 0;
  return r;
}

async function loadDashboard() {
  $('loading').classList.remove('hidden');
  try {
    await loadOutlets();
    const key = $('period').value;
    $('custom-range').classList.toggle('hidden', key !== 'custom');
    const { start, end, prevStart, prevEnd, vs } = getRange(key);
    if (!(start <= end)) { toast('Rentang tanggal tidak valid', 'err'); return; }
    const minD = iso(prevStart), maxD = iso(end);
    const [rev, bud] = await Promise.all([
      fetchAll(() => sb.from('daily_revenue').select('rev_date,outlet_id,amount').gte('rev_date', minD).lte('rev_date', maxD).order('rev_date').order('outlet_id')),
      fetchAll(() => sb.from('budgets').select('month,outlet_id,amount').gte('month', iso(new Date(start.getFullYear(), start.getMonth(), 1))).lte('month', iso(end)).order('month').order('outlet_id'))
    ]);
    const cur = aggregate(rev, iso(start), iso(end));
    const prev = aggregate(rev, iso(prevStart), iso(prevEnd));
    const budget = {}; let budgetTotal = 0;
    const div = key === 'yesterday' ? daysIn(start.getFullYear(), start.getMonth()) : 1;
    bud.forEach(b => { const a = (Number(b.amount) || 0) / div; budget[b.outlet_id] = (budget[b.outlet_id] || 0) + a; budgetTotal += a; });
    renderKPIs(cur, prev, budgetTotal, vs);
    renderTrend(cur);
    renderDonut(cur);
    renderBar(cur);
    renderTable(cur, budget, budgetTotal);
  } catch (e) {
    console.error(e);
    toast('Gagal memuat data: ' + (e.message || e), 'err');
  } finally {
    $('loading').classList.add('hidden');
    icons();
  }
}

function kpiCard(o) {
  const has = o.change !== null && o.change !== undefined;
  const up = has && o.change >= 0;
  const cls = !has ? 'text-taupe' : up ? 'text-forestGreen' : 'text-terracotta';
  const ic = !has ? 'minus' : up ? 'trending-up' : 'trending-down';
  const txt = !has ? 'Belum ada pembanding' : `${up ? '+' : ''}${o.change.toFixed(1)}${o.unit || '%'} vs ${o.vs}`;
  return `
  <div class="white-card rounded-xl p-5 hover:border-taupe/40 transition-all duration-300">
    <div class="flex items-center justify-between">
      <span class="text-[11px] font-semibold uppercase tracking-wider text-taupe">${o.title}</span>
      <div class="w-8 h-8 rounded-lg bg-amberLight flex items-center justify-center text-taupe"><i data-lucide="${o.icon}" class="w-4 h-4"></i></div>
    </div>
    <div class="mt-3">
      <h3 class="text-2xl font-sans font-bold">${o.value}</h3>
      <div class="flex items-center text-xs mt-1.5 space-x-1 font-medium ${cls}"><i data-lucide="${ic}" class="w-3.5 h-3.5"></i><span>${txt}</span></div>
    </div>
    <div class="mt-3 pt-3 border-t border-borderSubtle text-[11px] text-taupe flex justify-between">
      <span>${o.subL}</span><span class="font-semibold text-espresso">${o.subR}</span>
    </div>
  </div>`;
}

function renderKPIs(cur, prev, budgetTotal, vs) {
  const ach = budgetTotal > 0 ? cur.total / budgetTotal * 100 : null;
  const share = c => cur.total ? pct(cur.byCat[c] / cur.total * 100) : '-';
  $('kpi-grid').innerHTML = [
    kpiCard({ title:'Total F&B Revenue', icon:'banknote', value: rp(cur.total), change: chg(cur.total, prev.total), vs,
      subL: budgetTotal > 0 ? 'Target: ' + rpShort(budgetTotal) : 'Budget belum diisi', subR: ach === null ? '-' : pct(ach) + ' Achieved' }),
    kpiCard({ title:'Resto & Bar', icon:'utensils', value: rp(cur.byCat.resto), change: chg(cur.byCat.resto, prev.byCat.resto), vs,
      subL: 'Share of Total', subR: share('resto') }),
    kpiCard({ title:'Events', icon:'calendar-days', value: rp(cur.byCat.event), change: chg(cur.byCat.event, prev.byCat.event), vs,
      subL: 'Share of Total', subR: share('event') }),
    kpiCard({ title:'Avg Daily Revenue', icon:'trending-up', value: rp(cur.avgDaily), change: chg(cur.avgDaily, prev.avgDaily), vs,
      subL: 'Days with Revenue', subR: cur.activeDays + ' Days' })
  ].join('');
}

const TT = { backgroundColor:'#2C221E', titleFont:{ family:'Poppins', size:13, weight:'600' }, bodyFont:{ family:'Poppins', size:12 }, padding:12, cornerRadius:8, borderColor:'#C4A484', borderWidth:1 };
const AX = { font:{ family:'Poppins', size:10 }, color: COLORS.taupe };
function mk(id, cfgObj) {
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart($(id).getContext('2d'), cfgObj);
}

function renderTrend(cur) {
  const dates = Object.keys(cur.daily).sort();
  const monthly = dates.length > 1 && (parseISO(dates.at(-1)) - parseISO(dates[0])) / 86400000 > 62;
  const buckets = new Map();
  for (const d of dates) {
    const k = monthly ? d.slice(0, 7) : d;
    const b = buckets.get(k) || { resto:0, event:0 };
    b.resto += cur.daily[d].resto; b.event += cur.daily[d].event;
    buckets.set(k, b);
  }
  const keys = [...buckets.keys()];
  const labels = keys.map(k => monthly ? `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}` : `${+k.slice(8)} ${MONTHS[+k.slice(5, 7) - 1]}`);
  const vals = keys.map(k => buckets.get(k));
  $('trend-sub').textContent = (monthly ? 'Monthly' : 'Daily') + ' Resto & Bar vs Events Revenue (Juta Rp)';
  mk('trendComboChart', {
    type:'bar',
    data:{ labels, datasets:[
      { label:'Resto & Bar', data: vals.map(b => b.resto / 1e6), backgroundColor:COLORS.taupe, borderRadius:4 },
      { label:'Events', data: vals.map(b => b.event / 1e6), backgroundColor:COLORS.amberSoft, borderRadius:4 }
    ] },
    options:{
      responsive:true, maintainAspectRatio:false, interaction:{ mode:'index', intersect:false },
      plugins:{ legend:{ display:false }, tooltip:{ ...TT, callbacks:{ label: c => `${c.dataset.label}: Rp ${c.parsed.y.toLocaleString('id-ID', { maximumFractionDigits:1 })} Jt` } } },
      scales:{
        x:{ stacked:true, grid:{ display:false }, ticks:AX },
        y:{ stacked:true, grid:{ color:COLORS.border }, ticks:AX, title:{ display:true, text:'Revenue (Juta IDR)', color:COLORS.taupe, font:{ family:'Poppins', size:10 } } }
      }
    }
  });
  let best = null;
  for (const d of dates) { const t = cur.daily[d].resto + cur.daily[d].event; if (!best || t > best.t) best = { d, t }; }
  $('trend-peak').textContent = best ? `${parseISO(best.d).toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'short' })} (${rpShort(best.t)})` : '-';
  $('trend-avg').textContent = cur.activeDays ? rpShort(cur.avgDaily) : '-';
}

function renderDonut(cur) {
  const v = [cur.byCat.resto, cur.byCat.event];
  mk('mainCategoryDoughnutChart', {
    type:'doughnut',
    data:{ labels:['Resto & Bar', 'Events'], datasets:[{ data:v, backgroundColor:[COLORS.taupe, COLORS.amberSoft], borderColor:'#fff', borderWidth:3, hoverOffset:6 }] },
    options:{ responsive:true, maintainAspectRatio:false, cutout:'68%',
      plugins:{ legend:{ position:'bottom', labels:{ font:{ family:'Poppins', size:11 }, color:COLORS.espresso, usePointStyle:true, padding:14 } }, tooltip:{ ...TT, callbacks:{ label: c => `${c.label}: ${rp(c.parsed)}` } } } }
  });
  const t = cur.total || 0;
  $('share-resto').textContent = t ? pct(v[0] / t * 100) : '-';
  $('share-event').textContent = t ? pct(v[1] / t * 100) : '-';
}

// format label sumbu Y yang menyesuaikan skala (Rb / Jt / M) agar tidak muncul "Rp 0 Jt" berulang
function axisFmt(v) {
  const a = Math.abs(v);
  const f = x => x.toLocaleString('id-ID', { maximumFractionDigits: 1 });
  if (a >= 1e9) return 'Rp ' + f(v / 1e9) + ' M';
  if (a >= 1e6) return 'Rp ' + f(v / 1e6) + ' Jt';
  if (a >= 1e3) return 'Rp ' + f(v / 1e3) + ' Rb';
  return 'Rp ' + f(v);
}

// Dua grafik terpisah (Resto & Bar, Events) agar skala masing-masing proporsional
function renderBar(cur) {
  $('sub-desc').textContent = state.outlets.map(o => o.name).join(', ');
  $('sub-badge').textContent = `${state.outlets.length} Outlet Sub-Categories`;
  const draw = (canvasId, cat) => {
    const subs = state.outlets.filter(o => o.category === cat);
    mk(canvasId, {
      type:'bar',
      data:{ labels: subs.map(o => o.name), datasets:[{ label:'Revenue (Rp)', data: subs.map(o => cur.byOutlet[o.id] || 0), backgroundColor: subs.map(o => o.color), borderRadius:6 }] },
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ display:false }, tooltip:{ ...TT, callbacks:{ label: c => 'Revenue: ' + rp(c.parsed.y) } } },
        scales:{ x:{ grid:{ display:false }, ticks:{ ...AX, color:COLORS.espresso } }, y:{ beginAtZero:true, grid:{ color:COLORS.border }, ticks:{ ...AX, callback: v => axisFmt(v) } } } }
    });
  };
  draw('subRestoChart', 'resto');
  draw('subEventChart', 'event');
}

function renderTable(cur, budget, budgetTotal) {
  const t = cur.total || 0;
  const rows = state.outlets.map(o => {
    const a = cur.byOutlet[o.id] || 0, b = budget[o.id] || 0;
    const ach = b > 0 ? a / b * 100 : null;
    const col = ach !== null && ach >= 100 ? 'forestGreen' : 'taupe';
    return `<tr class="hover:bg-amberLight/30 transition-colors">
      <td class="py-3 px-3 font-semibold"><span class="inline-block w-2 h-2 rounded-full mr-2" style="background:${esc(o.color)}"></span>${esc(o.name)}</td>
      <td class="py-3 px-3 text-right font-bold">${rp(a)}</td>
      <td class="py-3 px-3 text-right text-taupe">${b > 0 ? rp(b) : '-'}</td>
      <td class="py-3 px-3"><div class="flex items-center gap-2">
        <div class="flex-1 bg-canvasBg rounded-full h-2 overflow-hidden border border-borderSubtle"><div class="bg-${col} h-full rounded-full" style="width:${Math.min(ach || 0, 100)}%"></div></div>
        <span class="text-[11px] font-bold text-${col} w-12 text-right">${ach === null ? '-' : pct(ach)}</span></div></td>
      <td class="py-3 px-3 text-right font-bold text-taupe">${t ? pct(a / t * 100) : '-'}</td></tr>`;
  });
  $('perf-body').innerHTML = rows.join('');
  const totAch = budgetTotal > 0 ? t / budgetTotal * 100 : null;
  $('overall-ach').textContent = totAch === null ? '-' : pct(totAch);
  $('perf-foot').innerHTML = `<tr class="bg-espresso text-white font-bold text-xs border-t-2 border-amberSoft">
    <td class="py-3.5 px-3 rounded-l-lg uppercase tracking-wider text-[11px]">Total Revenue</td>
    <td class="py-3.5 px-3 text-right text-goldAccent font-sans text-sm">${rp(t)}</td>
    <td class="py-3.5 px-3 text-right">${budgetTotal > 0 ? rp(budgetTotal) : '-'}</td>
    <td class="py-3.5 px-3 text-center">${totAch === null ? '-' : `<span class="px-2.5 py-0.5 rounded bg-goldAccent/20 text-goldAccent font-semibold border border-goldAccent/30">${pct(totAch)} Achieved</span>`}</td>
    <td class="py-3.5 px-3 text-right rounded-r-lg text-goldAccent font-sans text-sm">${t ? '100.0%' : '-'}</td></tr>`;
  // insight otomatis
  const top = state.outlets.map(o => ({ o, a: cur.byOutlet[o.id] || 0 })).filter(x => x.a > 0).sort((x, y) => y.a - x.a);
  if (!top.length) { $('insight').innerHTML = 'Belum ada data revenue pada periode ini.'; return; }
  const first = top[0], b1 = budget[first.o.id] || 0;
  let s = `<strong class="font-bold text-taupe">Revenue Insight:</strong> <strong>${esc(first.o.name)}</strong> merupakan kontributor terbesar yaitu <strong>${pct(first.a / t * 100)}</strong> (${rpShort(first.a)})` + (b1 > 0 ? ` dengan pencapaian budget ${pct(first.a / b1 * 100)}` : '');
  if (top.length > 1) s += `, diikuti <strong>${esc(top[1].o.name)} (${pct(top[1].a / t * 100)})</strong>` + (top[2] ? ` dan <strong>${esc(top[2].o.name)} (${pct(top[2].a / t * 100)})</strong>` : '');
  $('insight').innerHTML = s + '.';
}

/* ============================================================
   INPUT (wajib login) - keamanan sebenarnya ada di RLS Supabase
   ============================================================ */
const fld = (id, label, ph = '0') => `<div><label class="lbl" for="${id}">${esc(label)}</label><input id="${id}" type="number" min="0" step="any" inputmode="decimal" placeholder="${ph}" class="inp"></div>`;

async function initInput() {
  $('user-email').textContent = state.email || '';
  try { await loadOutlets(); } catch (e) { toast('Gagal memuat outlet: ' + e.message, 'err'); return; }
  if (!state.inputBuilt) {
    buildInputForms();
    state.inputBuilt = true;
    const n = new Date();
    $('in-date').value = iso(n);
    $('bud-month').value = `${n.getFullYear()}-${pad(n.getMonth() + 1)}`;
  }
  loadDay(); loadBudget();
}

function buildInputForms() {
  let html = '';
  for (const cat of ['resto', 'event']) {
    const os = state.outlets.filter(o => o.category === cat);
    if (!os.length) continue;
    html += `<div class="white-card rounded-xl p-5 space-y-3"><h3 class="font-serif-heading font-bold text-sm">${CAT_LABEL[cat]}</h3>`;
    html += os.map(o => fld('rev-' + o.id, 'Revenue ' + o.name + ' (Rp)')).join('') + '</div>';
  }
  $('daily-fields').innerHTML = html;
  $('budget-fields').innerHTML = state.outlets.map(o => `<div class="white-card rounded-xl p-4">${fld('bud-' + o.id, 'Budget ' + o.name + ' (Rp)')}</div>`).join('');

  $('daily-fields').addEventListener('input', updateDayTotal);
  $('budget-fields').addEventListener('input', updateBudTotal);
  $('in-date').addEventListener('change', loadDay);
  $('bud-month').addEventListener('change', loadBudget);
  $('btn-save-day').addEventListener('click', saveDay);
  $('btn-del-day').addEventListener('click', deleteDay);
  $('btn-save-bud').addEventListener('click', saveBudget);
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('history-body').addEventListener('click', e => {
    const b = e.target.closest('[data-edit]'); if (!b) return;
    $('in-date').value = b.dataset.edit; showTab('daily'); loadDay();
  });
}

function showTab(t) {
  ['daily', 'budget', 'history'].forEach(x => $('tab-' + x).classList.toggle('hidden', x !== t));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  if (t === 'history') loadHistory();
}

function updateDayTotal() { $('day-total').textContent = rp(state.outlets.reduce((s, o) => s + num($('rev-' + o.id).value), 0)); }
function updateBudTotal() { $('bud-total').textContent = rp(state.outlets.reduce((s, o) => s + num($('bud-' + o.id).value), 0)); }

async function loadDay() {
  const d = $('in-date').value; if (!d) return;
  const r = await sb.from('daily_revenue').select('outlet_id,amount').eq('rev_date', d);
  if (r.error) { toast('Gagal memuat data tanggal ini', 'err'); return; }
  state.outlets.forEach(o => $('rev-' + o.id).value = '');
  r.data.forEach(x => { const el = $('rev-' + x.outlet_id); if (el) el.value = Number(x.amount); });
  $('day-status').textContent = r.data.length ? 'Data sudah ada - mode edit (simpan akan menimpa).' : 'Data baru untuk tanggal ini.';
  updateDayTotal();
}

async function saveDay() {
  const d = $('in-date').value;
  if (!d) return toast('Pilih tanggal dulu', 'err');
  if (state.outlets.some(o => num($('rev-' + o.id).value) < 0)) return toast('Revenue tidak boleh negatif', 'err');
  const btn = $('btn-save-day'); btn.disabled = true;
  try {
    const rows = state.outlets.map(o => ({ rev_date: d, outlet_id: o.id, amount: num($('rev-' + o.id).value) }));
    const { error } = await sb.from('daily_revenue').upsert(rows, { onConflict: 'rev_date,outlet_id' });
    if (error) throw error;
    toast('Data ' + d + ' tersimpan');
    $('day-status').textContent = 'Data sudah ada - mode edit (simpan akan menimpa).';
  } catch (e) { toast('Gagal menyimpan: ' + (e.message || e), 'err'); }
  finally { btn.disabled = false; }
}

async function deleteDay() {
  const d = $('in-date').value; if (!d) return;
  if (!confirm('Hapus semua data revenue tanggal ' + d + '?')) return;
  const { error } = await sb.from('daily_revenue').delete().eq('rev_date', d);
  if (error) return toast('Gagal menghapus: ' + error.message, 'err');
  toast('Data ' + d + ' dihapus'); loadDay();
}

async function loadBudget() {
  const m = $('bud-month').value; if (!m) return;
  const { data, error } = await sb.from('budgets').select('outlet_id,amount').eq('month', m + '-01');
  if (error) return toast('Gagal memuat budget', 'err');
  state.outlets.forEach(o => $('bud-' + o.id).value = '');
  data.forEach(x => { const el = $('bud-' + x.outlet_id); if (el) el.value = Number(x.amount); });
  updateBudTotal();
}

async function saveBudget() {
  const m = $('bud-month').value; if (!m) return toast('Pilih bulan dulu', 'err');
  const btn = $('btn-save-bud'); btn.disabled = true;
  try {
    const rows = state.outlets.map(o => ({ month: m + '-01', outlet_id: o.id, amount: num($('bud-' + o.id).value) }));
    const { error } = await sb.from('budgets').upsert(rows, { onConflict: 'month,outlet_id' });
    if (error) throw error;
    toast('Budget ' + m + ' tersimpan');
  } catch (e) { toast('Gagal menyimpan: ' + (e.message || e), 'err'); }
  finally { btn.disabled = false; }
}

async function loadHistory() {
  const { data, error } = await sb.from('daily_revenue').select('rev_date,amount').order('rev_date', { ascending: false }).limit(900);
  if (error) return toast('Gagal memuat riwayat', 'err');
  const m = new Map();
  data.forEach(x => m.set(x.rev_date, (m.get(x.rev_date) || 0) + Number(x.amount)));
  const rows = [...m.entries()].slice(0, 31);
  $('history-body').innerHTML = rows.length
    ? rows.map(([d, t]) => `<tr><td class="py-2.5 px-2 font-medium">${parseISO(d).toLocaleDateString('id-ID', { weekday:'short', day:'numeric', month:'short', year:'numeric' })}</td><td class="py-2.5 px-2 text-right font-bold">${rp(t)}</td><td class="py-2.5 px-2 text-right"><button class="btn btn-ghost !py-1" data-edit="${d}">Edit</button></td></tr>`).join('')
    : '<tr><td colspan="3" class="py-6 text-center text-taupe">Belum ada data.</td></tr>';
}

/* ============================================================
   INIT
   ============================================================ */
function bindLogin() {
  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('login-btn'), err = $('login-error');
    err.classList.add('hidden'); btn.disabled = true; btn.textContent = 'Memproses…';
    const { data, error } = await sb.auth.signInWithPassword({ email: $('login-email').value.trim(), password: $('login-pass').value });
    btn.disabled = false; btn.textContent = 'Masuk';
    if (error) { err.textContent = 'Login gagal: email atau password salah.'; err.classList.remove('hidden'); return; }
    $('login-pass').value = '';
    setUser(data.session);
    location.hash = '#/input';
    route();
  });
}

async function init() {
  buildPeriodSelect();
  $('period').addEventListener('change', loadDashboard);
  $('range-from').addEventListener('change', () => $('period').value === 'custom' && loadDashboard());
  $('range-to').addEventListener('change', () => $('period').value === 'custom' && loadDashboard());
  $('btn-refresh').addEventListener('click', loadDashboard);
  window.addEventListener('hashchange', route);
  if (!configured) { $('config-warning').classList.remove('hidden'); renderNav('dashboard'); return; }
  bindLogin();
  const { data } = await sb.auth.getSession();
  setUser(data.session);
  // dipakai hanya jika user berubah (mis. sesi habis / logout di tab lain)
  sb.auth.onAuthStateChange((_ev, session) => {
    const id = session?.user?.id || null;
    if (id !== state.userId) { setUser(session); setTimeout(route, 0); }
  });
  route();
}
document.addEventListener('DOMContentLoaded', init);
