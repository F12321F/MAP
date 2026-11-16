/* 旅行足跡地圖 — 以 GPS 記錄走過的路線、顯示軌跡並匯出 PDF */
(() => {
  'use strict';

  // ---------- 設定 ----------
  const REGIONS = {
    asia:     { name: '亞洲', bounds: [[-11, 25], [77, 180]] },
    europe:   { name: '歐洲', bounds: [[34, -25], [72, 45]] },
    americas: { name: '美洲', bounds: [[-56, -170], [72, -30]] },
  };
  const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';
  const TILE_SUBDOMAINS = ['a', 'b', 'c', 'd'];
  const ATTRIBUTION = '© OpenStreetMap contributors © CARTO';
  const COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
  const MIN_STEP_M = 5;        // 移動小於此距離不記錄（過濾 GPS 抖動）
  const MAX_ACCURACY_M = 60;   // 精度差於此值的定位點略過
  const STORAGE_KEY = 'travel-trace-trips-v1';

  // ---------- 狀態 ----------
  let trips = load();
  let recording = null;   // { trip, watchId, startedAt, timer, wakeLock }
  let demoTimer = null;
  const layers = new Map(); // trip.id -> L.Polyline

  // ---------- 地圖 ----------
  const map = L.map('map', { zoomControl: false, worldCopyJump: true, minZoom: 2 });
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  L.tileLayer(TILE_URL, { subdomains: TILE_SUBDOMAINS, attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
  const meMarker = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16] }) });

  let currentRegion = localStorage.getItem('travel-trace-region') || 'asia';
  setRegion(currentRegion, false);

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const btnRecord = $('btnRecord');

  document.querySelectorAll('.region-switch button').forEach((b) =>
    b.addEventListener('click', () => setRegion(b.dataset.region, true)));
  btnRecord.addEventListener('click', () => (recording ? stopRecording() : startRecording()));
  $('btnLocate').addEventListener('click', locateOnce);
  $('btnDemo').addEventListener('click', runDemo);
  $('btnPdf').addEventListener('click', exportPdf);
  $('gpxInput').addEventListener('change', importGpx);
  $('panelToggle').addEventListener('click', () => $('panel').classList.toggle('collapsed'));

  trips.forEach(drawTrip);
  renderTripList();
  updateStats();

  // ---------- 區域 ----------
  function setRegion(key, animate) {
    currentRegion = key;
    localStorage.setItem('travel-trace-region', key);
    document.querySelectorAll('.region-switch button').forEach((b) =>
      b.classList.toggle('active', b.dataset.region === key));
    const sel = document.getElementById('pdfRange');
    if (sel && sel.value !== 'track') sel.value = key;
    map.fitBounds(REGIONS[key].bounds, { animate });
  }

  // ---------- 記錄 ----------
  function startRecording() {
    if (!('geolocation' in navigator)) return toast('此瀏覽器不支援定位功能');
    stopDemo();
    const trip = newTrip(`旅程 ${formatDate(Date.now())}`);
    recording = { trip, startedAt: Date.now(), watchId: null, timer: null, wakeLock: null };
    recording.watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
      enableHighAccuracy: true, maximumAge: 2000, timeout: 20000,
    });
    recording.timer = setInterval(updateStats, 1000);
    requestWakeLock();
    btnRecord.textContent = '■ 停止記錄';
    btnRecord.classList.add('recording');
    setStatus('記錄中…等待 GPS 訊號', true);
  }

  function stopRecording() {
    if (!recording) return;
    navigator.geolocation.clearWatch(recording.watchId);
    clearInterval(recording.timer);
    if (recording.wakeLock) recording.wakeLock.release().catch(() => {});
    const { trip } = recording;
    recording = null;
    if (trip.points.length < 2) {
      removeTrip(trip.id);
      toast('記錄點太少，已捨棄這段旅程');
    } else {
      save();
      toast(`已儲存「${trip.name}」，共 ${tripDistanceKm(trip).toFixed(2)} 公里`);
    }
    btnRecord.textContent = '▶ 開始記錄';
    btnRecord.classList.remove('recording');
    setStatus('已停止記錄');
    renderTripList();
    updateStats();
  }

  function onPosition(pos) {
    if (!recording) return;
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    meMarker.setLatLng([lat, lng]).addTo(map);
    if (accuracy > MAX_ACCURACY_M) {
      setStatus(`記錄中…GPS 精度不足（±${Math.round(accuracy)} 公尺）`, true);
      return;
    }
    setStatus(`記錄中（精度 ±${Math.round(accuracy)} 公尺）`, true);
    const added = addPoint(recording.trip, lat, lng, pos.timestamp);
    if (added && recording.trip.points.length === 1) map.setView([lat, lng], Math.max(map.getZoom(), 15));
    else if (added && !map.getBounds().pad(-0.1).contains([lat, lng])) map.panTo([lat, lng]);
  }

  function onGeoError(err) {
    const msg = { 1: '定位權限被拒絕，請在瀏覽器設定中允許定位', 2: '無法取得位置', 3: '定位逾時，重試中…' }[err.code] || err.message;
    setStatus(msg, !!recording);
    if (err.code === 1) { toast(msg); stopRecording(); }
  }

  function addPoint(trip, lat, lng, t = Date.now()) {
    const last = trip.points[trip.points.length - 1];
    if (last && haversine(last[0], last[1], lat, lng) < MIN_STEP_M) return false;
    trip.points.push([+lat.toFixed(6), +lng.toFixed(6), t]);
    layers.get(trip.id).addLatLng([lat, lng]);
    if (trip.points.length % 5 === 0) save();
    updateStats();
    renderTripList();
    return true;
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && recording) recording.wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* 不支援時忽略 */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && recording && (!recording.wakeLock || recording.wakeLock.released)) requestWakeLock();
  });

  function locateOnce() {
    if (!('geolocation' in navigator)) return toast('此瀏覽器不支援定位功能');
    toast('定位中…');
    navigator.geolocation.getCurrentPosition(
      (p) => { meMarker.setLatLng([p.coords.latitude, p.coords.longitude]).addTo(map); map.setView([p.coords.latitude, p.coords.longitude], 15); },
      (e) => toast(e.code === 1 ? '定位權限被拒絕' : '無法取得位置'),
      { enableHighAccuracy: true, timeout: 15000 });
  }

  // ---------- 模擬旅程（展示用） ----------
  function runDemo() {
    if (recording) return toast('請先停止記錄');
    if (demoTimer) return stopDemo();
    const routes = {
      asia: [[25.033, 121.565], [24.80, 120.97], [24.147, 120.673], [23.48, 120.45], [22.997, 120.212], [22.627, 120.301]],
      europe: [[48.856, 2.352], [50.85, 4.35], [52.37, 4.90], [52.52, 13.405], [50.075, 14.437], [48.208, 16.373]],
      americas: [[40.713, -74.006], [39.95, -75.165], [38.907, -77.037], [35.227, -80.843], [33.749, -84.388], [25.762, -80.192]],
    };
    const pts = densify(routes[currentRegion], 40);
    const trip = newTrip(`模擬旅程・${REGIONS[currentRegion].name}`);
    map.fitBounds(L.latLngBounds(routes[currentRegion]).pad(0.3));
    let i = 0;
    const t0 = Date.now() - pts.length * 60000;
    $('btnDemo').textContent = '■ 停止模擬';
    demoTimer = setInterval(() => {
      if (i >= pts.length) return stopDemo();
      addPoint(trip, pts[i][0], pts[i][1], t0 + i * 60000);
      meMarker.setLatLng(pts[i]).addTo(map);
      i++;
    }, 40);
  }
  function stopDemo() {
    if (!demoTimer) return;
    clearInterval(demoTimer);
    demoTimer = null;
    save();
    $('btnDemo').textContent = '✈ 模擬旅程';
  }
  function densify(route, stepsPerLeg) {
    const out = [];
    for (let k = 0; k < route.length - 1; k++) {
      const [a, b] = [route[k], route[k + 1]];
      for (let s = 0; s < stepsPerLeg; s++) {
        const f = s / stepsPerLeg;
        const wiggle = Math.sin(f * Math.PI * 3) * 0.04;
        out.push([a[0] + (b[0] - a[0]) * f + wiggle, a[1] + (b[1] - a[1]) * f - wiggle]);
      }
    }
    out.push(route[route.length - 1]);
    return out;
  }

  // ---------- 旅程管理 ----------
  function newTrip(name) {
    const trip = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, color: COLORS[trips.length % COLORS.length], visible: true, points: [] };
    trips.push(trip);
    drawTrip(trip);
    renderTripList();
    return trip;
  }
  function drawTrip(trip) {
    const line = L.polyline(trip.points.map((p) => [p[0], p[1]]), { color: trip.color, weight: 5, opacity: 0.85, lineJoin: 'round' });
    layers.set(trip.id, line);
    if (trip.visible) line.addTo(map);
  }
  function removeTrip(id) {
    const line = layers.get(id);
    if (line) map.removeLayer(line);
    layers.delete(id);
    trips = trips.filter((t) => t.id !== id);
    save();
  }

  function renderTripList() {
    const ul = $('tripList');
    ul.innerHTML = '';
    if (!trips.length) {
      ul.innerHTML = '<li class="empty">還沒有旅程，按「開始記錄」出發吧！</li>';
      return;
    }
    [...trips].reverse().forEach((trip) => {
      const li = document.createElement('li');
      const live = recording?.trip === trip ? ' 🔴' : '';
      li.innerHTML = `
        <span class="swatch" style="background:${trip.color}"></span>
        <div class="info">
          <div class="name"></div>
          <div class="meta">${tripDistanceKm(trip).toFixed(2)} 公里・${trip.points.length} 點${live}</div>
        </div>
        <button data-act="toggle" title="顯示/隱藏">${trip.visible ? '👁' : '◌'}</button>
        <button data-act="zoom" title="縮放至此旅程">🔍</button>
        <button data-act="gpx" title="下載 GPX">GPX</button>
        <button data-act="del" title="刪除">🗑</button>`;
      li.querySelector('.name').textContent = trip.name;
      li.addEventListener('click', (e) => {
        const act = e.target.dataset?.act;
        if (!act) return;
        if (act === 'toggle') {
          trip.visible = !trip.visible;
          trip.visible ? layers.get(trip.id).addTo(map) : map.removeLayer(layers.get(trip.id));
          save(); renderTripList(); updateStats();
        } else if (act === 'zoom' && trip.points.length) {
          map.fitBounds(layers.get(trip.id).getBounds().pad(0.2));
        } else if (act === 'gpx') {
          downloadGpx(trip);
        } else if (act === 'del') {
          if (recording?.trip === trip) return toast('記錄中的旅程無法刪除');
          if (confirm(`確定刪除「${trip.name}」？`)) { removeTrip(trip.id); renderTripList(); updateStats(); }
        }
      });
      ul.appendChild(li);
    });
  }

  function updateStats() {
    const vis = trips.filter((t) => t.visible);
    $('statDistance').textContent = vis.reduce((s, t) => s + tripDistanceKm(t), 0).toFixed(2);
    $('statPoints').textContent = vis.reduce((s, t) => s + t.points.length, 0);
    const ms = recording ? Date.now() - recording.startedAt : 0;
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
    $('statTime').textContent = h ? `${h}:${String(m % 60).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  }

  // ---------- GPX ----------
  function downloadGpx(trip) {
    const pts = trip.points.map((p) => `<trkpt lat="${p[0]}" lon="${p[1]}"><time>${new Date(p[2]).toISOString()}</time></trkpt>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="旅行足跡地圖" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>${escapeXml(trip.name)}</name><trkseg>\n${pts}\n</trkseg></trk>\n</gpx>`;
    downloadBlob(new Blob([xml], { type: 'application/gpx+xml' }), `trip_${fileStamp(trip.points[0]?.[2] || Date.now())}_${trip.id}.gpx`);
  }
  function importGpx(e) {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((txt) => {
      const doc = new DOMParser().parseFromString(txt, 'application/xml');
      const nodes = [...doc.querySelectorAll('trkpt, rtept, wpt')];
      if (!nodes.length) throw new Error('empty');
      const name = doc.querySelector('trk > name, metadata > name')?.textContent || file.name.replace(/\.gpx$/i, '');
      const trip = newTrip(name);
      nodes.forEach((n) => {
        const t = Date.parse(n.querySelector('time')?.textContent || '') || Date.now();
        trip.points.push([+n.getAttribute('lat'), +n.getAttribute('lon'), t]);
      });
      layers.get(trip.id).setLatLngs(trip.points.map((p) => [p[0], p[1]]));
      save(); renderTripList(); updateStats();
      map.fitBounds(layers.get(trip.id).getBounds().pad(0.2));
      toast(`已匯入「${name}」（${trip.points.length} 點）`);
    }).catch(() => toast('GPX 檔案無法解析')).finally(() => { e.target.value = ''; });
  }

  // ---------- PDF 匯出 ----------
  async function exportPdf() {
    const vis = trips.filter((t) => t.visible && t.points.length);
    const range = $('pdfRange').value;
    if (range === 'track' && !vis.length) return toast('沒有可顯示的軌跡');
    const btn = $('btnPdf');
    btn.disabled = true;
    btn.textContent = '產生中…';
    try {
      let bounds;
      if (range === 'track') {
        const all = L.latLngBounds(vis.flatMap((t) => t.points.map((p) => [p[0], p[1]])));
        bounds = padBounds(all, 0.15);
      } else {
        bounds = L.latLngBounds(REGIONS[range].bounds);
      }
      const mapCanvas = await renderMapCanvas(bounds, vis, range === 'track' ? 17 : 7);
      const page = composePage(mapCanvas, vis, range);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: page.width >= page.height ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
      const s = Math.min(pw / page.width, ph / page.height);
      const w = page.width * s, h = page.height * s;
      pdf.addImage(page.toDataURL('image/jpeg', 0.92), 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h);
      pdf.setProperties({ title: $('pdfTitle').value || '旅行足跡', creator: 'Travel Trace Map' });
      pdf.save(`travel-trace_${range}_${fileStamp(Date.now())}.pdf`);
      toast('PDF 已下載');
    } catch (err) {
      console.error(err);
      toast('PDF 產生失敗：' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '⬇ 下載 PDF';
    }
  }

  function padBounds(b, ratio) {
    const sw = b.getSouthWest(), ne = b.getNorthEast();
    const dLat = Math.max(ne.lat - sw.lat, 0.005) * ratio, dLng = Math.max(ne.lng - sw.lng, 0.005) * ratio;
    return L.latLngBounds([Math.max(sw.lat - dLat, -84), sw.lng - dLng], [Math.min(ne.lat + dLat, 84), ne.lng + dLng]);
  }

  // Web Mercator 投影：經緯度 → 世界像素座標
  function project(lat, lng, z) {
    const scale = 256 * 2 ** z;
    const s = Math.sin((Math.max(Math.min(lat, 85.0511), -85.0511) * Math.PI) / 180);
    return [((lng + 180) / 360) * scale, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale];
  }

  // 自行拼接圖磚並畫上軌跡，確保輸出清晰且不受畫面大小影響
  async function renderMapCanvas(bounds, visTrips, maxZoom) {
    const MAX_PX = 2600;
    const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
    let z = maxZoom;
    for (; z > 1; z--) {
      const [x0, y0] = project(ne.lat, sw.lng, z), [x1, y1] = project(sw.lat, ne.lng, z);
      if (x1 - x0 <= MAX_PX && y1 - y0 <= MAX_PX) break;
    }
    const [x0, y0] = project(ne.lat, sw.lng, z);
    const [x1, y1] = project(sw.lat, ne.lng, z);
    const W = Math.round(x1 - x0), H = Math.round(y1 - y0);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#dfe9ee';
    ctx.fillRect(0, 0, W, H);

    const n = 2 ** z;
    const jobs = [];
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x1 - 1) / 256); tx++) {
      for (let ty = Math.max(0, Math.floor(y0 / 256)); ty <= Math.min(n - 1, Math.floor((y1 - 1) / 256)); ty++) {
        const wrapped = ((tx % n) + n) % n;
        const url = TILE_URL.replace('{s}', TILE_SUBDOMAINS[(tx + ty) & 3]).replace('{z}', z).replace('{x}', wrapped).replace('{y}', ty).replace('.png', '@2x.png');
        jobs.push(loadImage(url).then((img) => ctx.drawImage(img, tx * 256 - x0, ty * 256 - y0, 256, 256)).catch(() => {}));
      }
    }
    await Promise.all(jobs);

    // 軌跡
    const lw = Math.max(3, Math.min(W, H) / 250);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const t of visTrips) {
      const pts = t.points.map((p) => { const [x, y] = project(p[0], p[1], z); return [x - x0, y - y0]; });
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = lw + 3; ctx.stroke();
      ctx.strokeStyle = t.color; ctx.lineWidth = lw; ctx.stroke();
      // 起點 / 終點
      const dot = (p, fill) => { ctx.beginPath(); ctx.arc(p[0], p[1], lw * 1.6, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw * 0.7; ctx.strokeStyle = '#fff'; ctx.stroke(); };
      if (pts.length) { dot(pts[0], '#16a34a'); dot(pts[pts.length - 1], '#dc2626'); }
    }
    return canvas;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // 組合頁面：標題、資訊、地圖、圖例（文字畫在 canvas 上以支援中文）
  function composePage(mapCanvas, visTrips, range) {
    const PAD = 40, HEAD = 120, LEG_ROW = 34;
    const W = Math.max(mapCanvas.width + PAD * 2, 1400);
    const legendRows = Math.ceil(visTrips.length / 3);
    const FOOT = 40 + legendRows * LEG_ROW;
    const scale = Math.min(1, (W - PAD * 2) / mapCanvas.width);
    const mw = mapCanvas.width * scale, mh = mapCanvas.height * scale;
    const H = HEAD + mh + FOOT + PAD;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const font = (size, weight = 400) => `${weight} ${size}px system-ui, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#0f766e'; ctx.fillRect(0, 0, W, 10);
    ctx.fillStyle = '#111827'; ctx.font = font(40, 700); ctx.textBaseline = 'top';
    ctx.fillText($('pdfTitle').value || '我的旅行足跡', PAD, 32);

    const allPts = visTrips.flatMap((t) => t.points);
    const times = allPts.map((p) => p[2]).filter(Boolean);
    const km = visTrips.reduce((s, t) => s + tripDistanceKm(t), 0);
    const rangeName = range === 'track' ? '依軌跡範圍' : REGIONS[range].name;
    const dateStr = times.length ? `${formatDate(Math.min(...times))} – ${formatDate(Math.max(...times))}` : '—';
    ctx.font = font(20); ctx.fillStyle = '#4b5563';
    ctx.fillText(`範圍：${rangeName}　｜　總距離：${km.toFixed(2)} 公里　｜　旅程數：${visTrips.length}　｜　期間：${dateStr}`, PAD, 84);

    const mx = (W - mw) / 2;
    ctx.drawImage(mapCanvas, mx, HEAD, mw, mh);
    ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 2; ctx.strokeRect(mx, HEAD, mw, mh);

    // 圖例
    ctx.font = font(18);
    const colW = (W - PAD * 2) / 3;
    visTrips.forEach((t, i) => {
      const x = PAD + (i % 3) * colW, y = HEAD + mh + 20 + Math.floor(i / 3) * LEG_ROW;
      ctx.fillStyle = t.color; ctx.fillRect(x, y + 6, 28, 8);
      ctx.fillStyle = '#374151';
      ctx.fillText(`${t.name}（${tripDistanceKm(t).toFixed(1)} km）`, x + 38, y);
    });
    ctx.font = font(14); ctx.fillStyle = '#9ca3af'; ctx.textAlign = 'right';
    ctx.fillText(`地圖資料 ${ATTRIBUTION}　｜　產生於 ${formatDate(Date.now())}`, W - PAD, H - PAD + 10);
    return c;
  }

  // ---------- 工具 ----------
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000, r = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function tripDistanceKm(t) {
    let d = 0;
    for (let i = 1; i < t.points.length; i++) d += haversine(t.points[i - 1][0], t.points[i - 1][1], t.points[i][0], t.points[i][1]);
    return d / 1000;
  }
  function formatDate(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }
  function fileStamp(ms) { return formatDate(ms).replace(/\//g, ''); }
  function escapeXml(s) { return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }
  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function setStatus(text, live = false) {
    const el = $('status');
    el.textContent = text;
    el.classList.toggle('live', live);
  }
  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3000);
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trips)); } catch { toast('儲存空間不足，部分軌跡可能未保存'); }
  }
  window.addEventListener('beforeunload', save);
})();
