// ===== Config =====
const DATA_URL = 'data/icd9.json';   // place this file in data directory
const DB_NAME  = 'icd9-cache';
const STORE    = 'dataset';
const KEY      = 'icd9-rich';
const MAX_RESULTS = 100;
const FAV_STORAGE_KEY = 'icd9:favs'; // localStorage string[] of codes
const FAV_LRU_KEY     = 'icd9:favs:lru'; // recency map {code: timestamp}
const CUSTOM_STORAGE_KEY = 'icd9:customizations'; // code -> partial record overrides

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

// ===== Customizations (localStorage overlay) =====
function safeParse(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

let CUSTOMIZATIONS = safeParse(CUSTOM_STORAGE_KEY, {});

function saveCustomizations() {
  localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(CUSTOMIZATIONS));
}

function applyCustomizations(data) {
  if (!Object.keys(CUSTOMIZATIONS).length) return data;
  return data.map(rec => {
    const custom = CUSTOMIZATIONS[rec.code];
    if (!custom) return rec;
    return Object.assign({}, rec, custom);
  });
}

function getCustomizationsForCode(code) {
  return CUSTOMIZATIONS[code] || null;
}

function setCustomizationsForCode(code, overrides) {
  if (overrides === null) {
    delete CUSTOMIZATIONS[code];
  } else {
    CUSTOMIZATIONS[code] = overrides;
  }
  saveCustomizations();
}

// ===== State =====
let FUSE = null;
let DATA = null;
let DATA_MAP = new Map(); // O(1) code -> record lookup
let BASE_DATA = null; // raw data before customizations
let FAVS = new Set(safeParse(FAV_STORAGE_KEY, []));
let FAV_LRU = safeParse(FAV_LRU_KEY, {}); // code -> ts

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
  editModal: document.getElementById('edit-modal'),
  editModalOverlay: document.getElementById('edit-modal-overlay'),
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
  const tagsHtml = Array.isArray(rec.tags) && rec.tags.length
    ? `<div class="tags">${rec.tags.map(t=>`<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';
  return `
    <button class="star" title="${fav?'Unfavourite':'Favourite'}" aria-pressed="${fav?'true':'false'}" data-code="${escapeHtml(rec.code)}" aria-label="Favourite ${escapeHtml(rec.code)}">${fav?'★':'☆'}</button>
    <div style="min-width:86px">
      <div class="code">${rec.code}</div>
      <div class="kind">${escapeHtml(rec.kind || '')}</div>
    </div>
    <div>
      <div class="name">${escapeHtml(rec.name || '')}</div>
      ${rec.short ? `<div class="muted">${escapeHtml(rec.short)}</div>` : ''}
      ${Array.isArray(rec.syn) && rec.syn.length ? `<div class="syn">${rec.syn.slice(0,6).map(s=>`<code>${escapeHtml(s)}</code>`).join('')}</div>` : ''}
      ${tagsHtml}
    </div>
  `;
}

function renderSection(container, list){
  container.innerHTML = '';
  const frag = document.createDocumentFragment();
  list.forEach(rec => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.code = rec.code;
    card.innerHTML = cardHTML(rec);
    frag.appendChild(card);
  });
  container.appendChild(frag);
}

// ===== Favourites (pinned) =====
function getFavRecords(){
  return [...FAVS]
    .map(code => DATA_MAP.get(code))
    .filter(Boolean)
    // sort by recent first, then code
    .sort((a,b) => (FAV_LRU[b.code]||0) - (FAV_LRU[a.code]||0) || a.code.localeCompare(b.code));
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
  DATA_MAP = new Map(data.map(r => [r.code, r]));
  FUSE = new Fuse(data, {
    includeScore: true,
    threshold: 0.28,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: 'code',  weight: 0.40 },
      { name: 'name',  weight: 0.40 },
      { name: 'syn',   weight: 0.10 },
      { name: 'tags',  weight: 0.10 },
    ]
  });
}

// ===== Load/cache dataset =====
async function loadFromCache() {
  const cached = await idbGet(KEY);
  if (cached && cached.data && Array.isArray(cached.data)) {
    BASE_DATA = cached.data;
    DATA = applyCustomizations(BASE_DATA);
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

  BASE_DATA = json;
  DATA = applyCustomizations(BASE_DATA);
  buildFuse(DATA);
  setMeta({
    count: DATA.length,
    source: 'network',
    version,
    updated: new Date().toLocaleString(),
    cacheState: 'updated'
  });
}

// ===== Edit Modal =====

// Pill list widget state
let editState = {
  code: null,
  syn: [],
  tags: [],
};

function createPillInput(containerId, items, placeholder) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const pillsEl = document.createElement('div');
  pillsEl.className = 'pill-list';

  function renderPills() {
    pillsEl.innerHTML = '';
    items.forEach((item, idx) => {
      const pill = document.createElement('span');
      pill.className = 'edit-pill';
      pill.innerHTML = `${escapeHtml(item)} <button type="button" class="pill-remove" data-idx="${idx}" aria-label="Remove ${escapeHtml(item)}">×</button>`;
      pillsEl.appendChild(pill);
    });
  }

  const inputRow = document.createElement('div');
  inputRow.className = 'pill-input-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.className = 'pill-text-input';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = 'Add';
  addBtn.className = 'pill-add-btn';

  function addItem() {
    const val = input.value.trim();
    if (val && !items.includes(val)) {
      items.push(val);
      renderPills();
      input.value = '';
      input.focus();
    }
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addItem(); }
  });
  addBtn.addEventListener('click', addItem);

  pillsEl.addEventListener('click', e => {
    const btn = e.target.closest('.pill-remove');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    items.splice(idx, 1);
    renderPills();
  });

  renderPills();
  container.appendChild(pillsEl);
  inputRow.appendChild(input);
  inputRow.appendChild(addBtn);
  container.appendChild(inputRow);
}

function getRecordByCode(code) {
  return DATA_MAP.get(code) ?? null;
}

function openEditModal(code) {
  const rec = getRecordByCode(code);
  if (!rec) return;

  editState.code = code;
  editState.syn = Array.isArray(rec.syn) ? [...rec.syn] : [];
  editState.tags = Array.isArray(rec.tags) ? [...rec.tags] : [];

  document.getElementById('edit-code').textContent = rec.code;
  document.getElementById('edit-kind').value = rec.kind || '';
  document.getElementById('edit-name').value = rec.name || '';
  document.getElementById('edit-short').value = rec.short || '';

  createPillInput('edit-syn-container', editState.syn, 'Add synonym…');
  createPillInput('edit-tags-container', editState.tags, 'Add tag…');

  // Show/hide reset button based on whether customizations exist
  const hasCustom = !!getCustomizationsForCode(code);
  document.getElementById('edit-reset-btn').style.display = hasCustom ? 'inline-flex' : 'none';

  els.editModalOverlay.classList.add('show');
  els.editModal.classList.add('show');
  // Focus first field
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('edit-name').focus()));
  // Trap focus within modal
  els.editModal._focusTrap = function(e) {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(els.editModal.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', els.editModal._focusTrap);
}

function closeEditModal() {
  els.editModalOverlay.classList.remove('show');
  els.editModal.classList.remove('show');
  editState.code = null;
  if (els.editModal._focusTrap) {
    document.removeEventListener('keydown', els.editModal._focusTrap);
    els.editModal._focusTrap = null;
  }
}

function saveEdit() {
  const code = editState.code;
  if (!code) return;

  const name = document.getElementById('edit-name').value.trim();
  const short = document.getElementById('edit-short').value.trim();
  const kind = document.getElementById('edit-kind').value.trim();
  const syn = [...editState.syn];
  const tags = [...editState.tags];

  // Find the base (un-customized) record
  const baseRec = BASE_DATA ? BASE_DATA.find(r => r.code === code) : null;

  // Build overrides — only store what differs from base or is new
  const overrides = {};
  if (baseRec) {
    if (name !== (baseRec.name || '')) overrides.name = name;
    if (short !== (baseRec.short || '')) overrides.short = short;
    if (kind !== (baseRec.kind || '')) overrides.kind = kind;
    const baseSyn = Array.isArray(baseRec.syn) ? baseRec.syn : [];
    if (JSON.stringify(syn) !== JSON.stringify(baseSyn)) overrides.syn = syn;
  } else {
    overrides.name = name;
    overrides.short = short;
    overrides.kind = kind;
    overrides.syn = syn;
  }
  // tags always stored if non-empty (new field not in base)
  if (tags.length) overrides.tags = tags;

  if (Object.keys(overrides).length) {
    setCustomizationsForCode(code, overrides);
  } else {
    // No changes from base, remove any stored customization
    setCustomizationsForCode(code, null);
  }

  // Rebuild merged DATA and Fuse
  if (BASE_DATA) {
    DATA = applyCustomizations(BASE_DATA);
    buildFuse(DATA);
  }

  closeEditModal();
  renderSearch();
}

function resetToDefault() {
  const code = editState.code;
  if (!code) return;
  if (!confirm(`Reset "${code}" to default? All edits and tags will be removed.`)) return;
  setCustomizationsForCode(code, null);

  if (BASE_DATA) {
    DATA = applyCustomizations(BASE_DATA);
    buildFuse(DATA);
  }

  closeEditModal();
  renderSearch();
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

// card click to open edit modal (event delegation)
function onCardClick(e) {
  // Don't open edit if clicking the star button
  if (e.target.closest('button.star')) return;
  const card = e.target.closest('.card');
  if (!card || !card.dataset.code) return;
  openEditModal(card.dataset.code);
}

els.results.addEventListener('click', e => { onStarClick(e); onCardClick(e); });
els.favs.addEventListener('click', e => { onStarClick(e); onCardClick(e); });

// Edit modal buttons
document.getElementById('edit-save-btn').addEventListener('click', saveEdit);
document.getElementById('edit-cancel-btn').addEventListener('click', closeEditModal);
document.getElementById('edit-cancel-btn-footer').addEventListener('click', closeEditModal);
document.getElementById('edit-reset-btn').addEventListener('click', resetToDefault);
els.editModalOverlay.addEventListener('click', closeEditModal);

// Close modal on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && els.editModal.classList.contains('show')) closeEditModal();
});

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
  DATA = null; BASE_DATA = null; FUSE = null;
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

// ===== Billing Codes =====
const BILLING_URL = 'data/billing-codes.json';

// Global billing codes array — time-calc-widget.js reads this via window.BILLING_CODES
window.BILLING_CODES = null;

async function loadBillingCodes() {
  try {
    const resp = await fetch(BILLING_URL);
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
    window.BILLING_CODES = await resp.json();
    // Notify time-calc widget that codes are ready
    window.dispatchEvent(new CustomEvent('billingCodesLoaded'));
  } catch (e) {
    console.warn('Billing codes unavailable:', e.message);
    window.BILLING_CODES = [];
  }
}

// ===== Boot =====
(async function boot(){
  try {
    const [, hadCache] = await Promise.all([
      loadBillingCodes(),
      loadFromCache(),
    ]);
    if (!hadCache) await fetchAndCache();
    renderSearch();           // initial paint (favs pinned)
    els.q.focus();            // focus search
  } catch (e) {
    console.error(e);
    setMeta({ cacheState: 'error' });
    alert('Failed to initialize: ' + e.message + '\nPlace icd9.json next to this HTML.');
  }
})();
