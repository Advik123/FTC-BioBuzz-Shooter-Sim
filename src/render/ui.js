// DOM side of the UI: data-bind inputs, readouts, target picker, solver
// results and plot. No physics here; main.js passes results in.

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, val) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = val;
}

/** Two-way binding for every [data-bind] element under root. Returns refresh(). */
export function bindInputs(root, state, onChange) {
  const els = [...root.querySelectorAll('[data-bind]')];
  const fmt = (v) => (typeof v === 'number' ? String(+v.toFixed(4)) : v ?? '');
  function refresh(except = null) {
    for (const el of els) {
      if (el === except) continue;
      const v = getPath(state, el.dataset.bind);
      if (el.type === 'radio') el.checked = el.value === v;
      else if (el.type === 'checkbox') el.checked = !!v;
      else if (document.activeElement !== el || el.type === 'range') el.value = fmt(v);
    }
  }
  for (const el of els) {
    const evt = el.type === 'radio' || el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, () => {
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'radio') {
        if (!el.checked) return;
        v = el.value;
      } else if (el.dataset.type === 'number' || el.type === 'number' || el.type === 'range') {
        v = parseFloat(el.value);
        if (!Number.isFinite(v)) return;
      } else v = el.value;
      setPath(state, el.dataset.bind, v);
      refresh(el);
      onChange(el.dataset.bind);
    });
  }
  refresh();
  return refresh;
}

export function fillSelect(sel, entries) {
  sel.innerHTML = '';
  for (const [value, label] of entries) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
  }
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export function fmtLen(inches, units, digits = 1) {
  if (!Number.isFinite(inches)) return '-';
  return units === 'metric' ? `${(inches * 2.54).toFixed(digits)} cm` : `${inches.toFixed(digits)} in`;
}

export function fmtSpeed(ms, units) {
  if (!Number.isFinite(ms)) return '-';
  return units === 'metric' ? `${ms.toFixed(2)} m/s` : `${(ms / 0.3048).toFixed(1)} ft/s`;
}

// ---------------------------------------------------------------------------
// HUD readout
// ---------------------------------------------------------------------------

export function setReadout(sim, units, { preview = false } = {}) {
  const badge = document.getElementById('result');
  const reason = document.getElementById('result-reason');
  const out = (k, v) => {
    document.querySelector(`[data-out="${k}"]`).textContent = v;
  };
  if (!sim) {
    badge.className = 'badge idle';
    badge.textContent = 'READY';
    reason.textContent = '';
    return;
  }
  const make = sim.result.make;
  badge.className = `badge ${make ? 'make' : 'miss'}${preview ? ' preview' : ''}`;
  badge.textContent = `${preview ? 'PREVIEW: ' : ''}${make ? 'MAKE' : 'MISS'}`;
  reason.textContent = sim.result.reason;
  out('exitSpeed', fmtSpeed(sim.stats.exitSpeed, units));
  out('flightTime', `${sim.stats.flightTime.toFixed(3)} s`);
  out('apex', fmtLen(sim.stats.apexZ / 0.0254, units));
  out('wheelRpm', `${sim.launch.wheelRpm.toFixed(0)} rpm`);
  const e = sim.stats.entry;
  out('entry', e ? `${Math.abs(e.descentDeg).toFixed(1)} deg ${e.descentDeg >= 0 ? 'down' : 'up'}` : 'did not reach opening');
  out('clearance', e ? (e.inside ? fmtLen(e.clearanceIn, units, 2) : 'outside opening') : '-');
}

// ---------------------------------------------------------------------------
// Landing-spot picker (top-down view of the cell floor)
// ---------------------------------------------------------------------------

export class TargetPicker {
  constructor(canvas, onPick) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.onPick = onPick;
    this.view = null;
    let dragging = false;
    const pick = (ev) => {
      if (!this.view) return;
      const r = canvas.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * canvas.width;
      const y = ((ev.clientY - r.top) / r.height) * canvas.height;
      const { toU, toS, range } = this.view;
      const u = Math.min(range.uMax, Math.max(range.uMin, toU(x)));
      const s = Math.min(range.sMax, Math.max(range.sMin, toS(y)));
      this.onPick(+u.toFixed(2), +s.toFixed(2));
    };
    canvas.addEventListener('pointerdown', (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); pick(e); });
    canvas.addEventListener('pointermove', (e) => { if (dragging) pick(e); });
    canvas.addEventListener('pointerup', () => { dragging = false; });
  }

  /** floor: { uMin, uMax } of the floor edge; range: allowed ball-centre range. */
  draw({ floor, sBack, sOpen, range, landing, radius, color, label }) {
    const { c, g } = this;
    const W = c.width;
    const H = c.height;
    const pad = 26;
    const uSpan = floor.uMax - floor.uMin;
    const sSpan = sOpen - sBack;
    const k = Math.min((W - 2 * pad) / uSpan, (H - 2 * pad) / sSpan);
    const ox = W / 2;
    const oy = pad + (H - 2 * pad - sSpan * k) / 2;
    const X = (u) => ox + u * k;
    const Y = (s) => oy + (sOpen - s) * k;
    this.view = { toU: (x) => (x - ox) / k, toS: (y) => sOpen - (y - oy) / k, range };
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0d1217';
    g.fillRect(0, 0, W, H);
    g.fillStyle = color + '33';
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.fillRect(X(floor.uMin), Y(sOpen), uSpan * k, sSpan * k);
    g.strokeRect(X(floor.uMin), Y(sOpen), uSpan * k, sSpan * k);
    g.setLineDash([4, 4]);
    g.strokeStyle = '#94a3b8';
    g.lineWidth = 1;
    g.strokeRect(X(range.uMin), Y(range.sMax), (range.uMax - range.uMin) * k, (range.sMax - range.sMin) * k);
    g.setLineDash([]);
    g.fillStyle = '#9aa7b4';
    g.font = '11px system-ui';
    g.textAlign = 'center';
    g.fillText(`OPENING (toward shooter) - ${label}`, W / 2, Y(sOpen) - 8);
    g.fillText('BACK SKIN', W / 2, Y(sBack) + 15);
    g.beginPath();
    g.arc(X(landing.u), Y(landing.s), radius * k, 0, Math.PI * 2);
    g.fillStyle = '#f4d417';
    g.fill();
    g.strokeStyle = '#22d3ee';
    g.lineWidth = 2;
    g.stroke();
  }
}

// ---------------------------------------------------------------------------
// Solver results
// ---------------------------------------------------------------------------

function failureSummary(cands) {
  if (!cands.length) return 'no trajectory reaches the spot';
  const counts = new Map();
  for (const c of cands) {
    const why = c.violations.length
      ? c.violations[0].replace(/[\d.]+/g, '#')
      : !c.make
        ? `does not stay in cell: ${c.reason}`
        : !c.hitsTarget
          ? 'scores but missed the landing dot (exact-landing mode)'
          : 'ok';
    counts.set(why, (counts.get(why) ?? 0) + 1);
  }
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return top[0];
}

export function renderSolverResults(el, res, units, critLabel, onLoad) {
  el.innerHTML = '';
  if (!res) return;
  const cards = document.createElement('div');
  cards.className = 'cards';
  for (const br of ['low', 'high']) {
    const c = res.best[br];
    const card = document.createElement('div');
    card.className = 'card';
    const fam = res.candidates.filter((x) => x.branch === br || (br === 'low' && x.branch === 'min'));
    card.innerHTML = `<h3>${br === 'low' ? 'Low arc' : 'High arc'}</h3>`;
    if (c) {
      card.innerHTML += `<div class="big">${c.rampAngleDeg.toFixed(2)} deg</div>
        <div class="big">${c.motorRpm.toFixed(0)} rpm</div>
        <div class="hint">exit ${fmtSpeed(c.exitSpeed, units)} - apex ${fmtLen(c.apexIn, units)}<br>
        entry ${c.entryDescentDeg.toFixed(1)} deg - rim clr ${fmtLen(c.clearanceIn, units, 2)}<br>
        ${fmtLen(c.sensitivityIn, units, 2)} shift per 1% RPM</div>`;
      const b = document.createElement('button');
      b.textContent = 'Load into simulator';
      b.onclick = () => onLoad(c);
      card.appendChild(b);
    } else {
      card.innerHTML += `<div class="none">No valid solution.<br>Main reason: ${failureSummary(fam)}.</div>`;
    }
    cards.appendChild(card);
  }
  el.appendChild(cards);

  const note = document.createElement('p');
  note.className = 'hint';
  const mode = res.searchMode ?? 'default';
  let split = '';
  if (mode === 'lockRpm') split = `Motor RPM locked at ${res.candidates[0]?.motorRpm?.toFixed(0) ?? '?'} rpm; sweeping ramp angle. `;
  else if (mode === 'lockAngle') split = `Ramp locked at ${res.candidates[0]?.rampAngleDeg?.toFixed(1) ?? '?'} deg; sweeping motor RPM. `;
  else if (mode === 'fixed') split = 'Both RPM and ramp angle locked; single combination checked. ';
  else split = `Minimum-speed angle ${res.minSpeedAngle ?? '-'} deg splits the low and high families. `;
  note.textContent = `${split}${res.ranked.length} valid of ${res.candidates.length} tried, ranked by: ${critLabel}.`;
  el.appendChild(note);

  if (res.ranked.length) {
    const t = document.createElement('table');
    t.className = 'ranked';
    t.innerHTML = '<tr><th>#</th><th>arc</th><th>deg</th><th>rpm</th><th>apex</th><th>entry</th><th>clr</th><th>sens</th></tr>';
    res.ranked.slice(0, 12).forEach((c, i) => {
      const tr = document.createElement('tr');
      tr.title = 'Click to load';
      tr.innerHTML = `<td>${i + 1}</td><td>${c.branch}</td><td>${c.rampAngleDeg.toFixed(2)}</td><td>${c.motorRpm.toFixed(0)}</td>
        <td>${fmtLen(c.apexIn, units, 0)}</td><td>${c.entryDescentDeg.toFixed(0)}</td><td>${c.clearanceIn.toFixed(2)}</td><td>${c.sensitivityIn.toFixed(2)}</td>`;
      tr.onclick = () => onLoad(c);
      t.appendChild(tr);
    });
    el.appendChild(t);
  }
}

/** Required motor RPM vs ramp angle, with constraint bands. */
export function drawSolvePlot(canvas, res, constraints, maxRpm) {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0d1217';
  g.fillRect(0, 0, W, H);
  if (!res || !res.candidates.length) {
    g.fillStyle = '#9aa7b4';
    g.font = '11px system-ui';
    g.fillText('Required RPM vs ramp angle appears here after solving.', 10, H / 2);
    return;
  }
  const L = 42;
  const R = 8;
  const T = 10;
  const B = 24;
  const cands = res.candidates;
  const mode = res.searchMode ?? 'default';
  const xIsRpm = mode === 'lockAngle';
  const aMin = Math.min(...cands.map((c) => c.rampAngleDeg));
  const aMax = Math.max(...cands.map((c) => c.rampAngleDeg));
  const rMin = Math.min(...cands.map((c) => c.motorRpm));
  const rMaxPlot = Math.min(
    Math.max(maxRpm * 1.3, ...cands.filter((c) => c.valid).map((c) => c.motorRpm), ...cands.map((c) => c.motorRpm)),
    Math.max(...cands.map((c) => c.motorRpm)),
  );
  const xMin = xIsRpm ? rMin : aMin;
  const xMax = xIsRpm ? Math.max(...cands.map((c) => c.motorRpm)) : aMax;
  const X = (xVal) => L + ((xVal - xMin) / Math.max(1e-6, xMax - xMin)) * (W - L - R);
  const apexMin = Math.min(...cands.map((c) => (Number.isFinite(c.apexIn) ? c.apexIn : 0)));
  const apexMax = Math.max(...cands.map((c) => (Number.isFinite(c.apexIn) ? c.apexIn : 60)), apexMin + 1);
  const Yrpm = (r) => H - B - (Math.min(r, rMaxPlot) / rMaxPlot) * (H - T - B);
  const Yapex = (aIn) => H - B - ((aIn - apexMin) / Math.max(1e-6, apexMax - apexMin)) * (H - T - B);
  const Yof = (c) => (xIsRpm ? Yapex(c.apexIn) : Yrpm(c.motorRpm));
  const xOf = (c) => (xIsRpm ? c.motorRpm : c.rampAngleDeg);
  g.fillStyle = 'rgba(148,163,184,0.10)';
  if (!xIsRpm) {
    g.fillRect(X(aMin), T, X(constraints.minRampDeg) - X(aMin), H - T - B);
    g.fillRect(X(constraints.maxRampDeg), T, X(aMax) - X(constraints.maxRampDeg), H - T - B);
  }
  g.strokeStyle = '#fb923c';
  g.setLineDash([4, 3]);
  g.beginPath();
  g.moveTo(L, Yrpm(maxRpm));
  g.lineTo(W - R, Yrpm(maxRpm));
  g.stroke();
  g.setLineDash([]);
  g.strokeStyle = '#64748b';
  g.beginPath();
  cands.forEach((c, i) => (i ? g.lineTo(X(xOf(c)), Yof(c)) : g.moveTo(X(xOf(c)), Yof(c))));
  g.stroke();
  for (const c of cands) {
    g.fillStyle = c.valid ? '#22c55e' : c.make && c.violations.length ? '#eab308' : c.make ? '#86efac' : '#475569';
    g.beginPath();
    g.arc(X(xOf(c)), Yof(c), c.valid ? 2.6 : 1.8, 0, Math.PI * 2);
    g.fill();
  }
  const splitX = xIsRpm ? res.minSpeedRpm : res.minSpeedAngle;
  if (splitX != null && xMax > xMin) {
    g.strokeStyle = '#38bdf8';
    g.beginPath();
    g.moveTo(X(splitX), T);
    g.lineTo(X(splitX), H - B);
    g.stroke();
  }
  if (mode === 'lockRpm') {
    g.strokeStyle = '#a78bfa';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(L, Yrpm(cands[0].motorRpm));
    g.lineTo(W - R, Yrpm(cands[0].motorRpm));
    g.stroke();
    g.setLineDash([]);
  }
  g.fillStyle = '#9aa7b4';
  g.font = '10px system-ui';
  g.textAlign = 'center';
  if (xIsRpm) {
    const step = xMax - xMin > 4000 ? 1000 : xMax - xMin > 1500 ? 500 : 250;
    for (let r = Math.ceil(xMin / step) * step; r <= xMax; r += step) g.fillText(`${r}`, X(r), H - 8);
  } else {
    for (let a = Math.ceil(aMin / 10) * 10; a <= aMax; a += 10) g.fillText(`${a}`, X(a), H - 8);
  }
  g.textAlign = 'right';
  if (xIsRpm) {
    for (let a = Math.ceil(apexMin / 10) * 10; a <= apexMax; a += Math.max(10, Math.round((apexMax - apexMin) / 4 / 10) * 10)) {
      g.fillText(`${a}`, L - 4, Yapex(a) + 3);
    }
  } else {
    for (let r = 0; r <= rMaxPlot; r += rMaxPlot > 6000 ? 2000 : 1000) g.fillText(`${r}`, L - 4, Yrpm(r) + 3);
  }
  g.textAlign = 'left';
  const axisHint = xIsRpm ? 'X=motor RPM, Y=apex (in)  ' : '';
  g.fillText(`${axisHint}green=scores in cell  yellow=blocked  orange=max RPM  blue=split`, L, T + 2);
}

export function renderSources(el, rows, labels) {
  const t = document.createElement('table');
  for (const r of rows) {
    const tr = document.createElement('tr');
    const val = Array.isArray(r.value) ? JSON.stringify(r.value) : r.value;
    tr.innerHTML = `<td><code>${r.key}</code><br><span class="tag ${r.source}" title="${labels[r.source]}">${r.source}</span></td><td>${val}<br><span class="hint">${r.ref}</span></td>`;
    t.appendChild(tr);
  }
  el.innerHTML = '';
  el.appendChild(t);
}
