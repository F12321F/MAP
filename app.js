/* 旅行足跡地圖 — 以 GPS 記錄走過的路線、顯示軌跡、飛行段、停留站點並匯出 PDF */
(() => {
  'use strict';

  // ---------- 設定 ----------
  // 城市／地區：bounds = [[南緯, 西經], [北緯, 東經]]，airport = 主要機場座標（用於飛行段）
  // 要新增城市只要在這裡加一行
  const CITY_GROUPS = [
    { country: '日本', cities: {
      tokyo:    { name: '東京',   bounds: [[35.53, 139.56], [35.82, 139.92]], airport: [35.5494, 139.7798] },
      osaka:    { name: '大阪',   bounds: [[34.58, 135.38], [34.78, 135.60]], airport: [34.4320, 135.2304] },
      kyoto:    { name: '京都',   bounds: [[34.93, 135.66], [35.08, 135.83]], airport: [34.4320, 135.2304] },
      nagoya:   { name: '名古屋', bounds: [[35.08, 136.82], [35.25, 137.00]], airport: [34.8584, 136.8054] },
      hokkaido: { name: '北海道', bounds: [[41.35, 139.30], [45.60, 145.90]], airport: [42.7752, 141.6923] },
      sapporo:  { name: '札幌',   bounds: [[42.95, 141.20], [43.15, 141.50]], airport: [42.7752, 141.6923] },
      fukuoka:  { name: '福岡',   bounds: [[33.53, 130.30], [33.68, 130.50]], airport: [33.5859, 130.4507] },
      okinawa:  { name: '沖繩',   bounds: [[26.05, 127.60], [26.90, 128.35]], airport: [26.1958, 127.6459] },
    } },
    { country: '韓國', cities: {
      seoul:    { name: '首爾',   bounds: [[37.42, 126.80], [37.70, 127.18]], airport: [37.4602, 126.4407] },
      busan:    { name: '釜山',   bounds: [[35.03, 128.85], [35.30, 129.25]], airport: [35.1795, 128.9382],
                  demo: [[35.1151, 129.0415], [35.1579, 129.0592], [35.1553, 129.0646], [35.1587, 129.1604]] },
      jeju:     { name: '濟州島', bounds: [[33.10, 126.10], [33.60, 127.00]], airport: [33.5113, 126.4930] },
      gyeongju: { name: '慶州',   bounds: [[35.75, 129.15], [35.90, 129.35]], airport: [35.1795, 128.9382] },
    } },
    { country: '台灣', cities: {
      taipei:   { name: '台北',   bounds: [[24.96, 121.45], [25.21, 121.67]], airport: [25.0777, 121.2328] },
      taichung: { name: '台中',   bounds: [[24.07, 120.55], [24.27, 120.78]], airport: [24.2647, 120.6206] },
      tainan:   { name: '台南',   bounds: [[22.90, 120.10], [23.10, 120.30]], airport: [22.9504, 120.2057] },
      kaohsiung:{ name: '高雄',   bounds: [[22.55, 120.25], [22.75, 120.40]], airport: [22.5771, 120.3500] },
      hualien:  { name: '花蓮',   bounds: [[23.85, 121.50], [24.20, 121.65]], airport: [24.0231, 121.6178] },
    } },
    { country: '其他', cities: {
      hongkong: { name: '香港',   bounds: [[22.15, 113.83], [22.56, 114.43]], airport: [22.3080, 113.9185] },
      macau:    { name: '澳門',   bounds: [[22.10, 113.52], [22.22, 113.60]], airport: [22.1496, 113.5925] },
      bangkok:  { name: '曼谷',   bounds: [[13.60, 100.40], [13.90, 100.70]], airport: [13.6900, 100.7501] },
      chiangmai:{ name: '清邁',   bounds: [[18.72, 98.92], [18.85, 99.05]], airport: [18.7668, 98.9626] },
      singapore:{ name: '新加坡', bounds: [[1.20, 103.60], [1.48, 104.05]], airport: [1.3644, 103.9915] },
      hanoi:    { name: '河內',   bounds: [[20.95, 105.75], [21.10, 105.90]], airport: [21.2212, 105.8072] },
      hcmc:     { name: '胡志明市', bounds: [[10.70, 106.60], [10.85, 106.80]], airport: [10.8188, 106.6519] },
    } },
  ];
  const CITIES = Object.assign({}, ...CITY_GROUPS.map((g) => g.cities));
  const DEFAULT_CITY = 'tokyo';

  const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';
  const TILE_SUBDOMAINS = ['a', 'b', 'c', 'd'];
  const ATTRIBUTION = '© OpenStreetMap contributors © CARTO';
  const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
  const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
  const COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
  const MIN_STEP_M = 5;           // 移動小於此距離不記錄（過濾 GPS 抖動）
  const HEARTBEAT_MS = 60000;     // 原地不動時，每分鐘仍記一點，用來計算停留時間
  const MAX_ACCURACY_M = 60;      // 精度差於此值的定位點略過
  const FLIGHT_MIN_M = 100000;    // 相鄰兩點超過 100 公里 → 視為飛行
  const GAP_MIN_MS = 10 * 60000;  // 超過 10 分鐘沒記錄且移動 2 公里以上 → 未記錄段（虛線）
  const GAP_MIN_M = 2000;
  const STAY_RADIUS_M = 120;      // 停留判定半徑
  const STATION_RADIUS_M = 400;   // 停留點附近多遠內的車站算數
  const STORAGE_KEY = 'travel-trace-trips-v1';
  const SETTINGS_KEY = 'travel-trace-settings';
  const PLACES_KEY = 'travel-trace-places';
  const DEFAULT_AVATAR = { type: 'emoji', value: '📍' };
  // Material「flight」圖示，機頭朝上（北），24×24
  const PLANE_PATH = 'M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z';

  // ---------- 狀態 ----------
  let trips = loadJSON(STORAGE_KEY, []);
  const settings = Object.assign({ avatar: DEFAULT_AVATAR, minStay: 15 }, loadJSON(SETTINGS_KEY, {}));
  const placeCache = loadJSON(PLACES_KEY, {});
  let recording = null;   // { trip, watchId, startedAt, timer, wakeLock }
  let demoTimer = null;
  let demoTrip = null;
  let resolveChain = Promise.resolve();
  const layers = new Map(); // trip.id -> L.FeatureGroup

  // ---------- 地圖 ----------
  const map = L.map('map', { zoomControl: false, worldCopyJump: true, minZoom: 2 });
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  L.tileLayer(TILE_URL, { subdomains: TILE_SUBDOMAINS, attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
  const meMarker = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16] }), zIndexOffset: 1000 });

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const btnRecord = $('btnRecord');
  const citySelect = $('citySelect');

  let currentCity = DEFAULT_CITY;

  function fillCitySelect(sel, airportsOnly) {
    CITY_GROUPS.forEach((g) => {
      const og = document.createElement('optgroup');
      og.label = g.country;
      Object.entries(g.cities).forEach(([key, c]) => { if (!airportsOnly || c.airport) og.appendChild(new Option(c.name, key)); });
      sel.appendChild(og);
    });
  }

  // ---------- 城市 ----------
  function setCity(key, animate) {
    currentCity = key;
    localStorage.setItem('travel-trace-city', key);
    citySelect.value = key;
    $('flightTo').value = key;
    $('pdfCityOpt').textContent = `目前城市（${CITIES[key].name}）`;
    map.fitBounds(CITIES[key].bounds, { animate });
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
      finishTrip(trip);
      toast(`已儲存「${trip.name}」，移動 ${tripKm(trip).ground.toFixed(2)} 公里`);
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
    if (last && haversine(last[0], last[1], lat, lng) < MIN_STEP_M && t - last[2] < HEARTBEAT_MS) return false;
    trip.points.push([+lat.toFixed(6), +lng.toFixed(6), t]);
    drawTrip(trip);
    if (trip.points.length % 5 === 0) save();
    updateStats();
    renderTripList();
    return true;
  }

  // 旅程結束：計算停留點並查詢地名
  function finishTrip(trip) {
    computeStays(trip);
    drawTrip(trip);
    save();
    queueResolve(trip);
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

  // ---------- 飛行段 ----------
  function addManualFlight() {
    const from = $('flightFrom').value, to = $('flightTo').value;
    if (from === to) return toast('出發與抵達不能相同');
    const a = CITIES[from].airport, b = CITIES[to].airport;
    const t0 = Date.parse($('flightTime').value) || Date.now();
    const durMs = (haversine(a[0], a[1], b[0], b[1]) / 1000 / 750 + 0.5) * 3600000; // 約 750 km/h + 起降
    const trip = newTrip(`✈ ${CITIES[from].name} → ${CITIES[to].name}`, { flight: true });
    trip.points.push([a[0], a[1], t0], [b[0], b[1], Math.round(t0 + durMs)]);
    trip.stays = [];
    drawTrip(trip);
    save(); renderTripList(); updateStats();
    map.fitBounds(layers.get(trip.id).getBounds().pad(0.2));
    $('flightForm').open = false;
    toast(`已新增飛行段：${CITIES[from].name} → ${CITIES[to].name}`);
  }

  // 把旅程切成：地面軌跡、飛行段、未記錄段
  function segmentsOf(trip) {
    const ground = [], flights = [], gaps = [];
    let cur = [];
    trip.points.forEach((p, i) => {
      if (i === 0) { cur.push(p); return; }
      const prev = trip.points[i - 1];
      const d = haversine(prev[0], prev[1], p[0], p[1]);
      const dt = p[2] - prev[2];
      if (trip.flight || d > FLIGHT_MIN_M) { flights.push([prev, p]); flush(); cur = [p]; return; }
      if (dt > GAP_MIN_MS && d > GAP_MIN_M) { gaps.push([prev, p]); flush(); cur = [p]; return; }
      cur.push(p);
    });
    flush();
    return { ground, flights, gaps };
    function flush() { if (cur.length > 1) ground.push(cur); }
  }

  // 飛行弧線（在麥卡托平面上以二次貝茲曲線往北彎）
  function flightArc(a, b, n = 48) {
    const [ax, ay] = project(a[0], a[1], 0), [bx, by] = project(b[0], b[1], 0);
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    let px = -dy / len, py = dx / len;
    if (py > 0) { px = -px; py = -py; }
    const cx = (ax + bx) / 2 + px * len * 0.2, cy = (ay + by) / 2 + py * len * 0.2;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push(unproject(u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by, 0));
    }
    return { pts, mid: pts[Math.floor(n / 2)], angle: Math.atan2(dx, -dy) };
  }

  // ---------- 停留點 ----------
  function detectStays(points, minMs) {
    const stays = [];
    let i = 0;
    while (i < points.length) {
      let sLat = points[i][0], sLng = points[i][1], n = 1, j = i + 1;
      while (j < points.length && haversine(sLat / n, sLng / n, points[j][0], points[j][1]) <= STAY_RADIUS_M) {
        sLat += points[j][0]; sLng += points[j][1]; n++; j++;
      }
      const lat = sLat / n, lng = sLng / n;
      let end = points[j - 1][2];
      // 原地不動時 GPS 不一定有新點，用「離開後的第一點」時間當結束時間（距離不遠才算）
      if (j < points.length && haversine(lat, lng, points[j][0], points[j][1]) < 1000) end = points[j][2];
      if (end - points[i][2] >= minMs) {
        stays.push({ lat: +lat.toFixed(6), lng: +lng.toFixed(6), start: points[i][2], end });
        i = j;
      } else i++;
    }
    return stays;
  }

  function computeStays(trip) {
    if (trip.flight) { trip.stays = []; return; }
    const old = trip.stays || [];
    trip.stays = detectStays(trip.points, settings.minStay * 60000).map((s) => {
      const prev = old.find((o) => o.name && haversine(o.lat, o.lng, s.lat, s.lng) < 60);
      return prev ? { ...s, name: prev.name, local: prev.local, kind: prev.kind } : s;
    });
  }

  function queueResolve(trip) {
    if (!trip.stays?.some((s) => !s.name)) return;
    resolveChain = resolveChain.then(() => resolveStays(trip)).catch(() => {});
  }

  async function resolveStays(trip) {
    for (const s of trip.stays || []) {
      if (s.name || !trips.includes(trip)) continue;
      const place = await resolvePlace(s.lat, s.lng);
      if (place) Object.assign(s, place, { failed: false });
      else s.failed = true;
      save(); drawTrip(trip); renderTripList();
    }
  }

  async function resolvePlace(lat, lng) {
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (placeCache[key]) return placeCache[key];
    try {
      const place = (await findStation(lat, lng)) || (await reverseGeocode(lat, lng));
      if (place) {
        placeCache[key] = place;
        try { localStorage.setItem(PLACES_KEY, JSON.stringify(placeCache)); } catch { /* 忽略 */ }
      }
      return place;
    } catch (err) {
      console.warn('地名查詢失敗', err);
      return null;
    } finally {
      await sleep(1100); // 遵守 OpenStreetMap 免費服務的頻率限制
    }
  }

  // 用 OpenStreetMap Overpass 找附近的鐵路／地鐵站
  async function findStation(lat, lng) {
    const q = `[out:json][timeout:15];nwr(around:${STATION_RADIUS_M},${lat},${lng})[~"^(railway|public_transport)$"~"^(station|halt)$"];out tags center;`;
    const res = await fetch(OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: q }) });
    if (!res.ok) throw new Error('Overpass ' + res.status);
    const els = (await res.json()).elements.filter((e) => e.tags?.name && e.tags.amenity !== 'bus_station' && !(e.tags.bus === 'yes' && !e.tags.railway));
    if (!els.length) return null;
    const pos = (e) => [e.lat ?? e.center?.lat, e.lon ?? e.center?.lon];
    els.sort((a, b) => haversine(lat, lng, ...pos(a)) - haversine(lat, lng, ...pos(b)));
    // 有鐵道標記的優先
    const best = els.find((e) => e.tags.railway) || els[0];
    return { ...pickName(best.tags, true), kind: 'station' };
  }

  // 附近沒有車站 → 用 Nominatim 反查地名（優先繁體中文）
  async function reverseGeocode(lat, lng) {
    const url = `${NOMINATIM_URL}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&namedetails=1&accept-language=zh-TW,zh,en`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Nominatim ' + res.status);
    const j = await res.json();
    if (j.namedetails?.name) return { ...pickName(j.namedetails, false), kind: 'place' };
    const a = j.address || {};
    const name = a.tourism || a.attraction || a.amenity || a.shop || a.leisure || a.building || a.neighbourhood || a.quarter || a.suburb || a.road || j.display_name?.split(',')[0];
    return name ? { name: toTrad(name), local: null, kind: 'area' } : null;
  }

  // 從 OSM 名稱標籤中挑出最適合的中文名稱
  function pickName(tags, isStation) {
    const HANGUL = /[가-힯]/, CJK = /[一-鿿]/, KANA = /[぀-ヿ]/;
    const first = (v) => v && v.split(';')[0].trim();
    let local = first(tags.name);
    let zh = first(tags['name:zh-Hant'] || tags['name:zh-TW'] || tags['name:zh_TW'] || tags['name:zh-HK'])
      || first(tags['name:ko-Hani'])
      || toTrad(first(tags['name:zh'] || tags['name:zh-Hans']));
    const ja = first(tags['name:ja']);
    if (!zh && ja && CJK.test(ja) && !KANA.test(ja)) zh = ja;
    if (!zh && local && CJK.test(local) && !HANGUL.test(local) && !KANA.test(local)) zh = local;
    if (!zh) zh = first(tags['name:en']) || local;
    if (isStation) {
      if (CJK.test(zh)) { zh = zh.replace(/[駅驛驿]$/, '站'); if (!/站$/.test(zh)) zh += '站'; }
      if (local && HANGUL.test(local) && !/역$/.test(local)) local += '역';
    }
    return { name: zh, local: local && local !== zh ? local : null };
  }

  // 簡體 → 繁體（常見地名用字）
  const S2T = Object.fromEntries('云雲 东東 车車 馆館 场場 国國 门門 桥橋 广廣 汉漢 区區 湾灣 岛島 龙龍 庆慶 会會 长長 乐樂 华華 寿壽 冈岡 宫宮 涩澀 浅淺 驿驛 铁鐵 线線 机機 园園 关關 万萬 丰豐 叶葉 历歷 圣聖 钟鐘 阳陽 阴陰 凤鳳 盘盤 滨濱 罗羅 兰蘭 宁寧 爱愛 义義 马馬 鱼魚 鸟鳥 鹤鶴 尔爾 济濟 镇鎮 坛壇 应應 达達 汤湯 温溫 滩灘 冲沖 绳繩 纳納 览覽 观觀 湿濕 泽澤 荣榮 仓倉 条條 县縣 厅廳 楼樓 场場 剧劇 艺藝 术術 馆館 书書 图圖 际際 机機 场場 码碼 头頭 东東 鸭鴨 绿綠 红紅 滨濱 辽遼 显顯 宝寶 庙廟 层層 宾賓 饭飯 购購 广廣 场場 学學 医醫 运運 动動 体體 竞競 赛賽 莲蓮 兴興 开開 发發 东東 岭嶺 峡峽 纪紀 农農 渔漁 蓝藍 黄黃 边邊 过過 远遠 进進 连連 还還 这這 环環 现現 电電 话話 号號'
    .split(' ').map((p) => [p[0], p[1]]));
  function toTrad(s) { return s ? [...s].map((c) => S2T[c] || c).join('') : s; }

  // ---------- 頭像 ----------
  function avatarHtml(cls = 'avatar-pin') {
    const a = settings.avatar;
    return a.type === 'image'
      ? `<div class="${cls}"><img src="${a.value}" alt=""></div>`
      : `<div class="${cls}"><span>${escapeHtml(a.value)}</span></div>`;
  }
  function renderAvatarPreview() {
    $('avatarPreview').innerHTML = avatarHtml('avatar-pin big');
    $('avatarEmoji').value = settings.avatar.type === 'emoji' ? settings.avatar.value : '';
  }
  function setAvatar(a) {
    settings.avatar = a;
    saveSettings();
    renderAvatarPreview();
    trips.forEach(drawTrip);
    toast('頭像已更新');
  }
  function onAvatarEmoji() {
    const v = [...$('avatarEmoji').value.trim()].slice(0, 2).join('');
    if (v) setAvatar({ type: 'emoji', value: v });
  }
  function onAvatarFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const S = 128, c = document.createElement('canvas');
      c.width = c.height = S;
      const side = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
      URL.revokeObjectURL(img.src);
      setAvatar({ type: 'image', value: c.toDataURL('image/jpeg', 0.85) });
    };
    img.onerror = () => toast('圖片無法讀取');
    img.src = URL.createObjectURL(file);
    e.target.value = '';
  }

  // ---------- 模擬旅程（展示用） ----------
  function runDemo() {
    if (recording) return toast('請先停止記錄');
    if (demoTimer) return stopDemo();
    const city = CITIES[currentCity];
    const [[s0, w0], [n0, e0]] = city.bounds;
    const span = Math.min(n0 - s0, e0 - w0);
    // 目的地路線：有預設景點就用，否則在城市內繞一圈
    let route = city.demo;
    if (!route) {
      const cLat = (s0 + n0) / 2, cLng = (w0 + e0) / 2, rLat = (n0 - s0) * 0.32, rLng = (e0 - w0) * 0.32;
      route = [0, 1, 2, 3, 4, 5, 6].map((k) => {
        const a = (k / 6) * Math.PI * 1.7 - Math.PI / 2, f = 0.55 + 0.45 * Math.abs(Math.sin(k * 1.3));
        return [cLat + Math.sin(a) * rLat * f, cLng + Math.cos(a) * rLng * f];
      });
    }
    // 從另一個城市搭飛機過來，在第 2、4 個景點停留 25 分鐘
    const origin = currentCity.match(/^(taipei|taichung|tainan|kaohsiung|hualien)$/) ? CITIES.tokyo : CITIES.taipei;
    const plan = []; // [lat, lng, dtMs]
    const jitter = () => (Math.random() - 0.5) * 0.0002;
    if (city.airport && origin !== city) {
      plan.push([origin.airport[0], origin.airport[1], 0], [origin.airport[0] + 0.001, origin.airport[1] + 0.001, 60000]);
      plan.push([city.airport[0], city.airport[1], 2.5 * 3600000]);
      densify([city.airport, route[0]], 25, span * 0.01).slice(1).forEach((p) => plan.push([p[0], p[1], 60000]));
    }
    for (let k = 0; k < route.length - 1; k++) {
      if (k === 1 || k === 3) for (let m = 0; m < 25; m++) plan.push([route[k][0] + jitter(), route[k][1] + jitter(), 60000]);
      densify([route[k], route[k + 1]], 25, span * 0.01).slice(1).forEach((p) => plan.push([p[0], p[1], 60000]));
    }
    for (let m = 0; m < 25; m++) plan.push([route[route.length - 1][0] + jitter(), route[route.length - 1][1] + jitter(), 60000]);

    const trip = newTrip(`模擬旅程・${city.name}`);
    map.fitBounds(city.bounds);
    let i = 0;
    let t = Date.now() - plan.reduce((s, p) => s + p[2], 0);
    $('btnDemo').textContent = '■ 停止模擬';
    demoTimer = setInterval(() => {
      if (i >= plan.length) return stopDemo();
      t += plan[i][2];
      addPoint(trip, plan[i][0], plan[i][1], t);
      meMarker.setLatLng([plan[i][0], plan[i][1]]).addTo(map);
      i++;
    }, 25);
    demoTrip = trip;
  }
  function stopDemo() {
    if (!demoTimer) return;
    clearInterval(demoTimer);
    const trip = demoTrip;
    demoTimer = null;
    demoTrip = null;
    $('btnDemo').textContent = '✈ 模擬旅程';
    finishTrip(trip);
    renderTripList();
  }
  function densify(route, stepsPerLeg, amp) {
    const out = [];
    for (let k = 0; k < route.length - 1; k++) {
      const [a, b] = [route[k], route[k + 1]];
      for (let s = 0; s < stepsPerLeg; s++) {
        const f = s / stepsPerLeg;
        const wiggle = Math.sin(f * Math.PI * 3) * amp;
        out.push([a[0] + (b[0] - a[0]) * f + wiggle, a[1] + (b[1] - a[1]) * f - wiggle]);
      }
    }
    out.push(route[route.length - 1]);
    return out;
  }

  // ---------- 旅程管理 ----------
  function newTrip(name, extra = {}) {
    const trip = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, color: COLORS[trips.length % COLORS.length], visible: true, points: [], stays: [], ...extra };
    trips.push(trip);
    drawTrip(trip);
    renderTripList();
    return trip;
  }

  function drawTrip(trip) {
    const old = layers.get(trip.id);
    if (old) map.removeLayer(old);
    const g = L.featureGroup();
    const ll = (p) => [p[0], p[1]];
    const { ground, flights, gaps } = segmentsOf(trip);
    if (ground.length) L.polyline(ground.map((seg) => seg.map(ll)), { color: trip.color, weight: 5, opacity: 0.85, lineJoin: 'round' }).addTo(g);
    if (trip.points.length === 1) L.circleMarker(ll(trip.points[0]), { radius: 5, color: trip.color }).addTo(g);
    gaps.forEach(([a, b]) => L.polyline([ll(a), ll(b)], { color: '#6b7280', weight: 3, dashArray: '2 8', opacity: 0.8 }).bindTooltip('未記錄的移動').addTo(g));
    flights.forEach(([a, b]) => {
      const arc = flightArc(a, b);
      const km = haversine(a[0], a[1], b[0], b[1]) / 1000;
      L.polyline(arc.pts, { color: trip.color, weight: 3, dashArray: '10 8', opacity: 0.9 }).addTo(g);
      L.marker(arc.mid, {
        icon: L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14],
          html: `<svg class="plane-icon" viewBox="0 0 24 24" style="transform:rotate(${arc.angle}rad);color:${trip.color}"><path d="${PLANE_PATH}"/></svg>` }),
      }).bindTooltip(`✈ 飛行 約 ${Math.round(km)} 公里`).addTo(g);
    });
    (trip.stays || []).forEach((s) => {
      L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: avatarHtml(), iconSize: [36, 36], iconAnchor: [18, 18] }), zIndexOffset: 500 })
        .bindTooltip(stayTooltip(s), { permanent: true, direction: 'top', offset: [0, -18], className: 'stay-tip' })
        .addTo(g);
    });
    layers.set(trip.id, g);
    if (trip.visible) g.addTo(map);
  }

  function stayTooltip(s) {
    const local = s.local ? `<small>${escapeHtml(s.local)}</small>` : '';
    return `<b>${escapeHtml(stayName(s))}</b>${local}<span>${formatTime(s.start)} · 停留 ${formatDur(s.end - s.start)}</span>`;
  }
  function stayName(s) { return s.name || (s.failed ? '停留點（地名查詢失敗）' : '查詢地名中…'); }

  function removeTrip(id) {
    const g = layers.get(id);
    if (g) map.removeLayer(g);
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
      const km = tripKm(trip);
      const parts = [];
      if (km.ground > 0 || !km.flight) parts.push(`${km.ground.toFixed(2)} 公里`);
      if (km.flight) parts.push(`✈ ${Math.round(km.flight)} 公里`);
      if (trip.stays?.length) parts.push(`停留 ${trip.stays.length} 處`);
      li.innerHTML = `
        <div class="row">
          <span class="swatch" style="background:${trip.color}"></span>
          <div class="info">
            <div class="name"></div>
            <div class="meta">${parts.join('・')}${live}</div>
          </div>
          <button data-act="toggle" title="顯示/隱藏">${trip.visible ? '👁' : '◌'}</button>
          <button data-act="zoom" title="縮放至此旅程">🔍</button>
          <button data-act="gpx" title="下載 GPX">GPX</button>
          <button data-act="del" title="刪除">🗑</button>
        </div>`;
      li.querySelector('.name').textContent = trip.name;
      if (trip.stays?.length) {
        const ol = document.createElement('ol');
        ol.className = 'stays';
        trip.stays.forEach((s, i) => {
          const item = document.createElement('li');
          item.innerHTML = `<span class="t">${formatTime(s.start)}</span><span class="n"></span><span class="d">${formatDur(s.end - s.start)}</span>`;
          item.querySelector('.n').textContent = stayName(s) + (s.local ? `（${s.local}）` : '');
          item.title = '在地圖上顯示';
          item.addEventListener('click', () => map.setView([s.lat, s.lng], 17));
          ol.appendChild(item);
        });
        li.appendChild(ol);
      }
      li.querySelector('.row').addEventListener('click', (e) => {
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
    $('statDistance').textContent = vis.reduce((s, t) => s + tripKm(t).ground, 0).toFixed(2);
    $('statPoints').textContent = vis.reduce((s, t) => s + t.points.length, 0);
    const ms = recording ? Date.now() - recording.startedAt : 0;
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
    $('statTime').textContent = h ? `${h}:${String(m % 60).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  }

  // ---------- GPX ----------
  function downloadGpx(trip) {
    const pts = trip.points.map((p) => `<trkpt lat="${p[0]}" lon="${p[1]}"><time>${new Date(p[2]).toISOString()}</time></trkpt>`).join('\n');
    const wpts = (trip.stays || []).map((s) => `<wpt lat="${s.lat}" lon="${s.lng}"><time>${new Date(s.start).toISOString()}</time><name>${escapeXml(stayName(s))}</name><desc>停留 ${formatDur(s.end - s.start)}</desc></wpt>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="旅行足跡地圖" xmlns="http://www.topografix.com/GPX/1/1">\n${wpts}\n<trk><name>${escapeXml(trip.name)}</name><trkseg>\n${pts}\n</trkseg></trk>\n</gpx>`;
    downloadBlob(new Blob([xml], { type: 'application/gpx+xml' }), `trip_${fileStamp(trip.points[0]?.[2] || Date.now())}_${trip.id}.gpx`);
  }
  function importGpx(e) {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((txt) => {
      const doc = new DOMParser().parseFromString(txt, 'application/xml');
      let nodes = [...doc.querySelectorAll('trkpt')];
      if (!nodes.length) nodes = [...doc.querySelectorAll('rtept, wpt')];
      if (!nodes.length) throw new Error('empty');
      const name = doc.querySelector('trk > name, metadata > name')?.textContent || file.name.replace(/\.gpx$/i, '');
      const trip = newTrip(name);
      nodes.forEach((n) => {
        const t = Date.parse(n.querySelector('time')?.textContent || '') || Date.now();
        trip.points.push([+n.getAttribute('lat'), +n.getAttribute('lon'), t]);
      });
      finishTrip(trip);
      renderTripList(); updateStats();
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
        const all = L.latLngBounds(vis.flatMap((t) => {
          const { flights } = segmentsOf(t);
          return [...t.points.map((p) => [p[0], p[1]]), ...flights.flatMap(([a, b]) => flightArc(a, b, 12).pts)];
        }));
        bounds = padBounds(all, 0.15);
      } else if (range === 'view') {
        bounds = map.getBounds();
      } else {
        bounds = L.latLngBounds(CITIES[currentCity].bounds);
      }
      const avatarImg = settings.avatar.type === 'image' ? await loadImage(settings.avatar.value).catch(() => null) : null;
      const mapCanvas = await renderMapCanvas(bounds, vis, 17, avatarImg);
      const page = composePage(mapCanvas, vis, range, bounds);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: page.width >= page.height ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
      const s = Math.min(pw / page.width, ph / page.height);
      const w = page.width * s, h = page.height * s;
      pdf.addImage(page.toDataURL('image/jpeg', 0.92), 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h);
      pdf.setProperties({ title: $('pdfTitle').value || '旅行足跡', creator: 'Travel Trace Map' });
      pdf.save(`travel-trace_${range === 'city' ? currentCity : range}_${fileStamp(Date.now())}.pdf`);
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

  // Web Mercator 投影：經緯度 ↔ 世界像素座標
  function project(lat, lng, z) {
    const scale = 256 * 2 ** z;
    const s = Math.sin((Math.max(Math.min(lat, 85.0511), -85.0511) * Math.PI) / 180);
    return [((lng + 180) / 360) * scale, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale];
  }
  function unproject(x, y, z) {
    const scale = 256 * 2 ** z;
    return [(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI, (x / scale) * 360 - 180];
  }

  // 自行拼接圖磚並畫上軌跡，確保輸出清晰且不受畫面大小影響
  async function renderMapCanvas(bounds, visTrips, maxZoom, avatarImg) {
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

    const P = (lat, lng) => { const [x, y] = project(lat, lng, z); return [x - x0, y - y0]; };
    const lw = Math.max(3, Math.min(W, H) / 250);
    const font = (size, weight = 400) => `${weight} ${size}px system-ui, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const strokePath = (pts, color, width, dash = []) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.setLineDash(dash);
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = width + 3; ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
      ctx.setLineDash([]);
    };
    const plane = new Path2D(PLANE_PATH);

    for (const t of visTrips) {
      const { ground, flights, gaps } = segmentsOf(t);
      ground.forEach((seg) => strokePath(seg.map((p) => P(p[0], p[1])), t.color, lw));
      gaps.forEach(([a, b]) => strokePath([P(a[0], a[1]), P(b[0], b[1])], '#6b7280', lw * 0.6, [lw * 0.5, lw * 2]));
      flights.forEach(([a, b]) => {
        const arc = flightArc(a, b);
        strokePath(arc.pts.map((p) => P(p[0], p[1])), t.color, lw * 0.7, [lw * 2.5, lw * 2]);
        const [mx, my] = P(arc.mid[0], arc.mid[1]);
        const s = Math.max(30, lw * 6) / 24;
        ctx.save();
        ctx.translate(mx, my); ctx.rotate(arc.angle); ctx.scale(s, s); ctx.translate(-12, -12);
        ctx.lineWidth = 4 / s; ctx.strokeStyle = '#fff'; ctx.stroke(plane);
        ctx.fillStyle = t.color; ctx.fill(plane);
        ctx.restore();
      });
      // 起點 / 終點（飛行段不畫）
      if (!t.flight && t.points.length) {
        const dot = ([x, y], fill) => { ctx.beginPath(); ctx.arc(x, y, lw * 1.6, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw * 0.7; ctx.strokeStyle = '#fff'; ctx.stroke(); };
        const first = t.points[0], last = t.points[t.points.length - 1];
        dot(P(first[0], first[1]), '#16a34a'); dot(P(last[0], last[1]), '#dc2626');
      }
    }

    // 停留點：頭像 + 名稱
    const r = Math.max(18, lw * 4);
    const fs = Math.max(22, lw * 4.5);
    let no = 0;
    for (const t of visTrips) {
      for (const st of t.stays || []) {
        no++;
        if (!bounds.contains([st.lat, st.lng])) continue;
        const [x, y] = P(st.lat, st.lng);
        ctx.save();
        ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#f0fdfa'; ctx.fill(); ctx.clip();
        if (avatarImg) ctx.drawImage(avatarImg, x - r, y - r, r * 2, r * 2);
        else { ctx.font = font(r * 1.3); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000'; ctx.fillText(settings.avatar.value, x, y + r * 0.08); }
        ctx.restore();
        ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = t.color; ctx.stroke();
        const label = `${no}. ${stayName(st)}`;
        ctx.font = font(fs, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.lineWidth = 5; ctx.strokeStyle = '#fff'; ctx.strokeText(label, x, y - r - 6);
        ctx.fillStyle = '#111827'; ctx.fillText(label, x, y - r - 6);
      }
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

  // 組合頁面：標題、資訊、地圖、圖例、停留點清單（文字畫在 canvas 上以支援中文）
  function composePage(mapCanvas, visTrips, range, bounds) {
    const W = Math.max(mapCanvas.width + 80, 1400);
    const k = W / 1400; // 依頁面寬度等比放大文字
    const PAD = 40 * k, HEAD = 120 * k, LEG_ROW = 34 * k, STAY_ROW = 30 * k;
    const stays = visTrips.flatMap((t) => (t.stays || []).map((s) => ({ ...s, color: t.color })));
    stays.forEach((s, i) => { s.no = i + 1; });
    const listed = stays.slice(0, 40);
    const legendRows = Math.ceil(visTrips.length / 3);
    const stayRows = Math.ceil(listed.length / 2);
    const FOOT = 40 * k + legendRows * LEG_ROW + (listed.length ? 50 * k + stayRows * STAY_ROW : 0);
    const scale = Math.min(1, (W - PAD * 2) / mapCanvas.width);
    const mw = mapCanvas.width * scale, mh = mapCanvas.height * scale;
    const H = HEAD + mh + FOOT + PAD;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const font = (size, weight = 400) => `${weight} ${size * k}px system-ui, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#0f766e'; ctx.fillRect(0, 0, W, 10 * k);
    ctx.fillStyle = '#111827'; ctx.font = font(40, 700); ctx.textBaseline = 'top';
    ctx.fillText($('pdfTitle').value || '我的旅行足跡', PAD, 32 * k);

    const times = visTrips.flatMap((t) => t.points.map((p) => p[2])).filter(Boolean);
    const km = visTrips.reduce((acc, t) => { const k = tripKm(t); acc.ground += k.ground; acc.flight += k.flight; return acc; }, { ground: 0, flight: 0 });
    const rangeName = { track: '依軌跡範圍', view: '自訂畫面' }[range] || CITIES[currentCity].name;
    const dateStr = times.length ? `${formatDate(Math.min(...times))} – ${formatDate(Math.max(...times))}` : '—';
    const info = [`範圍：${rangeName}`, `移動距離：${km.ground.toFixed(2)} 公里`];
    if (km.flight) info.push(`飛行：${Math.round(km.flight)} 公里`);
    if (stays.length) info.push(`停留點：${stays.length} 處`);
    info.push(`期間：${dateStr}`);
    ctx.font = font(20); ctx.fillStyle = '#4b5563';
    ctx.fillText(info.join('　｜　'), PAD, 84 * k);

    const mx = (W - mw) / 2;
    ctx.drawImage(mapCanvas, mx, HEAD, mw, mh);
    ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 2 * k; ctx.strokeRect(mx, HEAD, mw, mh);

    // 圖例
    let y = HEAD + mh + 20 * k;
    ctx.font = font(18);
    const colW = (W - PAD * 2) / 3;
    visTrips.forEach((t, i) => {
      const x = PAD + (i % 3) * colW, yy = y + Math.floor(i / 3) * LEG_ROW;
      ctx.fillStyle = t.color; ctx.fillRect(x, yy + 6 * k, 28 * k, 8 * k);
      ctx.fillStyle = '#374151';
      const km1 = tripKm(t);
      ctx.fillText(`${t.name}（${t.flight ? '✈ ' + Math.round(km1.flight) : km1.ground.toFixed(1)} km）`, x + 38 * k, yy);
    });
    y += legendRows * LEG_ROW + 10 * k;

    // 停留點清單
    if (listed.length) {
      ctx.fillStyle = '#111827'; ctx.font = font(22, 700);
      ctx.fillText('停留點', PAD, y);
      y += 40 * k;
      const half = (W - PAD * 2) / 2;
      listed.forEach((s, i) => {
        const x = PAD + (i % 2) * half, yy = y + Math.floor(i / 2) * STAY_ROW;
        ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x + 8 * k, yy + 10 * k, 6 * k, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#374151'; ctx.font = font(18);
        const local = s.local ? `（${s.local}）` : '';
        ctx.fillText(`${s.no}. ${formatDateTime(s.start)}　${stayName(s)}${local}　停留 ${formatDur(s.end - s.start)}`, x + 22 * k, yy);
      });
    }
    ctx.font = font(14); ctx.fillStyle = '#9ca3af'; ctx.textAlign = 'right';
    ctx.fillText(`地圖資料 ${ATTRIBUTION}　｜　產生於 ${formatDate(Date.now())}`, W - PAD, H - PAD + 10 * k);
    return c;
  }

  // ---------- 工具 ----------
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000, r = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  // 回傳 { ground: 地面移動公里（含未記錄段）, flight: 飛行公里 }
  function tripKm(t) {
    const { ground, flights, gaps } = segmentsOf(t);
    const len = (a, b) => haversine(a[0], a[1], b[0], b[1]);
    let g = 0;
    ground.forEach((seg) => { for (let i = 1; i < seg.length; i++) g += len(seg[i - 1], seg[i]); });
    gaps.forEach(([a, b]) => { g += len(a, b); });
    return { ground: g / 1000, flight: flights.reduce((s, [a, b]) => s + len(a, b), 0) / 1000 };
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  function formatDate(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  }
  function formatTime(ms) { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
  function formatDateTime(ms) { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${formatTime(ms)}`; }
  function formatDur(ms) {
    const m = Math.round(ms / 60000), h = Math.floor(m / 60);
    return h ? `${h} 小時${m % 60 ? ` ${m % 60} 分` : ''}` : `${m} 分`;
  }
  function toLocalInput(ms) { const d = new Date(ms); return `${formatDate(ms).replace(/\//g, '-')}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
  function fileStamp(ms) { return formatDate(ms).replace(/\//g, ''); }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function escapeXml(s) { return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }
  const escapeHtml = escapeXml;
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
  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trips)); } catch { toast('儲存空間不足，部分軌跡可能未保存'); }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { toast('儲存空間不足，頭像可能未保存'); }
  }
  window.addEventListener('beforeunload', save);

  // ---------- 啟動（放在最後，確保所有常數都已定義） ----------
  function init() {
    fillCitySelect(citySelect, false);
    fillCitySelect($('flightFrom'), true);
    fillCitySelect($('flightTo'), true);
    $('flightFrom').value = 'taipei';

    currentCity = localStorage.getItem('travel-trace-city');
    if (!CITIES[currentCity]) currentCity = DEFAULT_CITY;
    setCity(currentCity, false);
    citySelect.addEventListener('change', () => setCity(citySelect.value, true));
    btnRecord.addEventListener('click', () => (recording ? stopRecording() : startRecording()));
    $('btnLocate').addEventListener('click', locateOnce);
    $('btnDemo').addEventListener('click', runDemo);
    $('btnPdf').addEventListener('click', exportPdf);
    $('gpxInput').addEventListener('change', importGpx);
    $('panelToggle').addEventListener('click', () => $('panel').classList.toggle('collapsed'));
    $('btnAddFlight').addEventListener('click', addManualFlight);
    $('flightForm').addEventListener('toggle', () => { if ($('flightForm').open) $('flightTime').value = toLocalInput(Date.now()); });
    $('avatarFile').addEventListener('change', onAvatarFile);
    $('avatarEmoji').addEventListener('change', onAvatarEmoji);
    $('avatarReset').addEventListener('click', () => setAvatar(DEFAULT_AVATAR));
    $('minStay').value = String(settings.minStay);
    $('minStay').addEventListener('change', () => {
      settings.minStay = +$('minStay').value;
      saveSettings();
      trips.forEach((t) => { computeStays(t); drawTrip(t); queueResolve(t); });
      save(); renderTripList();
      toast(`已重新計算停留點（${settings.minStay} 分鐘以上）`);
    });

    renderAvatarPreview();
    trips.forEach((t) => { if (!t.stays) computeStays(t); drawTrip(t); queueResolve(t); });
    renderTripList();
    updateStats();
  }
  init();
})();

