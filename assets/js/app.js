// ===== Config =====
const DATA_URL = 'data/icd9.json';   // place this file in data directory
const DB_NAME  = 'icd9-cache';
const STORE    = 'dataset';
const KEY      = 'icd9-rich';
const MAX_RESULTS = 100;
const FAV_STORAGE_KEY = 'icd9:favs'; // localStorage string[] of codes
const FAV_LRU_KEY     = 'icd9:favs:lru'; // recency map {code: timestamp}

// ===== IndexedDB (dataset cache) =====
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const getReq = tx.objectStore(STORE).get(key);
    getReq.onsuccess = () => resolve(getReq.result);
    getReq.onerror = () => reject(getReq.error);
  });
}
async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDel(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ===== Hash util (for versioning) =====
async function sha256Hex(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  const arr = Array.from(new Uint8Array(hash));
  return arr.map(b => b.toString(16).padStart(2,'0')).join('');
}

// ===== State =====
let FUSE = null;
let DATA = null;
let FAVS = new Set(JSON.parse(localStorage.getItem(FAV_STORAGE_KEY) || '[]'));
let FAV_LRU = JSON.parse(localStorage.getItem(FAV_LRU_KEY) || '{}'); // code -> ts

const els = {
  q: document.getElementById('q'),
  results: document.getElementById('results'),
  favs: document.getElementById('favs'),
  favWrap: document.getElementById('favWrap'),
  favCount: document.getElementById('favCount'),
  pillCount: document.getElementById('pill-count'),
  pillSource: document.getElementById('pill-source'),
  cacheState: document.getElementById('cache-state'),
  cacheVersion: document.getElementById('cache-version'),
  cacheUpdated: document.getElementById('cache-updated'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnClear: document.getElementById('btn-clear'),
  btnExport: document.getElementById('btn-export'),
  resTitle: document.getElementById('resTitle'),
  adminCheckbox: document.getElementById('admin-checkbox'),
};

// ===== Helpers =====
function escapeHtml(s){ return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function setMeta({count, source, version, updated, cacheState}) {
  if (typeof count === 'number') els.pillCount.textContent = `${count.toLocaleString()} codes`;
  if (source) els.pillSource.textContent = `source: ${source}`;
  if (version !== undefined) els.cacheVersion.textContent = version || '—';
  if (updated !== undefined) els.cacheUpdated.textContent = updated || '—';
  if (cacheState) els.cacheState.textContent = cacheState;
}
function saveFavs() {
  localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify([...FAVS]));
  localStorage.setItem(FAV_LRU_KEY, JSON.stringify(FAV_LRU));
}
function isFav(code){ return FAVS.has(code); }
function touchFav(code){ FAV_LRU[code] = Date.now(); }

// ===== Cards =====
function cardHTML(rec){
  const fav = isFav(rec.code);
  return `
    <button class="star" title="${fav?'Unfavourite':'Favourite'}" aria-pressed="${fav?'true':'false'}" data-code="${rec.code}" aria-label="Favourite ${rec.code}">${fav?'★':'☆'}</button>
    <div style="min-width:86px">
      <div class="code">${rec.code}</div>
      <div class="kind">${rec.kind}</div>
    </div>
    <div>
      <div class="name">${escapeHtml(rec.name || '')}</div>
      ${rec.short ? `<div class="muted">${escapeHtml(rec.short)}</div>` : ''}
      ${Array.isArray(rec.syn) && rec.syn.length ? `<div class="syn">${rec.syn.slice(0,6).map(s=>`<code>${escapeHtml(s)}</code>`).join('')}</div>` : ''}
    </div>
  `;
}

function renderSection(container, list){
  container.innerHTML = '';
  const frag = document.createDocumentFragment();
  list.forEach(rec => {
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = cardHTML(rec);
    frag.appendChild(card);
  });
  container.appendChild(frag);
}

// ===== Favourites (pinned) =====
function getFavRecords(all=DATA){
  if (!all) return [];
  const byCode = new Map(all.map(r => [r.code, r]));
  const favList = [...FAVS]
    .map(code => byCode.get(code))
    .filter(Boolean)
    // sort by recent first, then code
    .sort((a,b) => (FAV_LRU[b.code]||0) - (FAV_LRU[a.code]||0) || a.code.localeCompare(b.code));
  return favList;
}
function refreshFavouritesUI(){
  const favList = getFavRecords();
  els.favCount.textContent = `(${favList.length})`;
  els.favWrap.classList.toggle('hidden', favList.length === 0);
  renderSection(els.favs, favList);
}

// ===== Search render (favourites pinned first) =====
function renderSearch(){
  if (!DATA || !FUSE) return;
  const q = els.q.value.trim();
  let hits = q ? FUSE.search(q).map(r => r.item) : DATA.slice(0, MAX_RESULTS*2);

  // Partition: favourites first (preserving search order), then non-favs
  const favSet = new Set([...FAVS]);
  const favHits = [];
  const otherHits = [];
  for (const it of hits) (favSet.has(it.code) ? favHits : otherHits).push(it);

  // Favourites are already pinned at the top section; results section should show:
  // - matching favourites (optional), then others. To avoid duplication, we only show non-favs here.
  renderSection(els.results, otherHits.slice(0, MAX_RESULTS));

  // Update the pinned favourites section (filtered by query if you're searching)
  const allFavs = getFavRecords();
  const favFiltered = q
    ? allFavs.filter(r => favHits.find(x => x.code === r.code))
    : allFavs;
  els.favWrap.classList.toggle('hidden', favFiltered.length === 0);
  renderSection(els.favs, favFiltered);
  els.favCount.textContent = `(${allFavs.length})`;

  els.resTitle.textContent = q ? `Results for "${q}"` : 'Results';
}

// ===== Fuse bootstrap =====
function buildFuse(data) {
  FUSE = new Fuse(data, {
    includeScore: true,
    threshold: 0.28,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: 'code', weight: 0.45 },
      { name: 'name', weight: 0.45 },
      { name: 'syn',  weight: 0.10 },
    ]
  });
}

// ===== Load/cache dataset =====
async function loadFromCache() {
  const cached = await idbGet(KEY);
  if (cached && cached.data && Array.isArray(cached.data)) {
    DATA = cached.data;
    buildFuse(DATA);
    setMeta({
      count: DATA.length,
      source: 'IndexedDB',
      version: cached.version,
      updated: new Date(cached.updated).toLocaleString(),
      cacheState: 'hit'
    });
    return true;
  }
  setMeta({ cacheState: 'miss' });
  return false;
}
async function fetchAndCache() {
  setMeta({ cacheState: 'fetching…' });
  const resp = await fetch(DATA_URL, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const version = await sha256Hex(buf);
  const text = new TextDecoder('utf-8').decode(buf);
  const json = JSON.parse(text);

  await idbSet(KEY, { version, updated: Date.now(), data: json });

  DATA = json;
  buildFuse(DATA);
  setMeta({
    count: DATA.length,
    source: 'network',
    version,
    updated: new Date().toLocaleString(),
    cacheState: 'updated'
  });
}

// ===== Events =====
function debounce(fn, ms=120){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
const onSearch = debounce(renderSearch, 80);

els.q.addEventListener('input', () => { if (FUSE) onSearch(); });

// star clicks (event delegation on both sections)
function onStarClick(e){
  const btn = e.target.closest('button.star'); if (!btn) return;
  const code = btn.dataset.code;
  if (!code) return;
  if (FAVS.has(code)) {
    FAVS.delete(code);
    delete FAV_LRU[code];
  } else {
    FAVS.add(code);
    touchFav(code);
  }
  saveFavs();
  renderSearch(); // re-render both sections (pins)
}
els.results.addEventListener('click', onStarClick);
els.favs.addEventListener('click', onStarClick);

// Admin toggle functionality
function toggleAdminElements() {
  const isAdminEnabled = els.adminCheckbox.checked;
  document.body.classList.toggle('admin-enabled', isAdminEnabled);
}

els.adminCheckbox.addEventListener('change', toggleAdminElements);

els.btnRefresh.addEventListener('click', async () => {
  els.btnRefresh.disabled = true;
  try {
    await fetchAndCache();
    renderSearch();
  } catch (e) {
    alert('Refresh failed: ' + e.message);
    setMeta({ cacheState: 'error' });
  } finally {
    els.btnRefresh.disabled = false;
  }
});

els.btnClear.addEventListener('click', async () => {
  await idbDel(KEY);
  DATA = null; FUSE = null;
  setMeta({ count: 0, source:'—', version:'—', updated:'—', cacheState:'cleared' });
  els.results.innerHTML = '';
  // Keep favourites when clearing dataset cache
});

els.btnExport.addEventListener('click', async () => {
  const cached = await idbGet(KEY);
  if (!cached) return alert('Nothing in cache.');
  const blob = new Blob([JSON.stringify(cached.data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href:url, download:'icd9.json' });
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

// ===== Offline Detection & PWA =====
let isOnline = navigator.onLine;
let deferredPrompt = null;

// Offline indicator elements
const offlineIndicator = document.getElementById('offline-indicator');
const offlineText = document.getElementById('offline-text');
const installPrompt = document.getElementById('install-prompt');
const installBtn = document.getElementById('install-btn');
const installClose = document.getElementById('install-close');

// Update offline indicator
function updateOfflineStatus() {
  if (isOnline) {
    offlineIndicator.classList.remove('show');
    offlineText.textContent = 'You\'re online - data will sync';
  } else {
    offlineIndicator.classList.add('show');
    offlineText.textContent = 'You\'re offline - using cached data';
  }
}

// Online/offline event listeners
window.addEventListener('online', () => {
  isOnline = true;
  updateOfflineStatus();
  // Try to refresh data when back online
  if (!DATA) {
    fetchAndCache().catch(console.error);
  }
});

window.addEventListener('offline', () => {
  isOnline = false;
  updateOfflineStatus();
});

// PWA Install prompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installPrompt.classList.add('show');
});

installBtn.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('Install prompt outcome:', outcome);
    deferredPrompt = null;
    installPrompt.classList.remove('show');
  }
});

installClose.addEventListener('click', () => {
  installPrompt.classList.remove('show');
});

// Service Worker registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      console.log('Service Worker registered:', registration);
      
      // Handle updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version available
            if (confirm('New version available. Reload to update?')) {
              window.location.reload();
            }
          }
        });
      });
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  });
}

// Update initial offline status
updateOfflineStatus();

// ===== Boot =====
(async function boot(){
  try {
    const hadCache = await loadFromCache();
    if (!hadCache) await fetchAndCache();
    renderSearch();           // initial paint (favs pinned)
    els.q.focus();            // focus search
  } catch (e) {
    console.error(e);
    setMeta({ cacheState: 'error' });
    alert('Failed to initialize: ' + e.message + '\nPlace icd9.json next to this HTML.');
  }
})();
