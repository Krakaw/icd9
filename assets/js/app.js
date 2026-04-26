// ===== Config =====
const DATA_URL = 'data/icd9.json';
const BILLING_DATA_URL = 'data/billing-codes.json';
const DB_NAME  = 'icd9-cache';
const STORE    = 'dataset';
const KEY      = 'icd9-rich';
const BILLING_KEY = 'billing-codes';
const MAX_RESULTS = 100;
const FAV_STORAGE_KEY = 'icd9:favs'; // localStorage string[] of ids
const FAV_LRU_KEY     = 'icd9:favs:lru'; // recency map {id: timestamp}
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
let FUSE = null;          // ICD-9 Fuse instance
let DATA = null;          // ICD-9 records (with customizations)
let DATA_MAP = new Map(); // O(1) _id -> record lookup (both ICD-9 and billing)
let BASE_DATA = null;     // raw ICD-9 data before customizations
let BILLING_FUSE = null;  // Billing code Fuse instance
let BILLING_DATA = null;  // Billing code records
let FAVS = new Set(safeParse(FAV_STORAGE_KEY, []));
let FAV_LRU = safeParse(FAV_LRU_KEY, {}); // id -> ts

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
function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
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
function isFav(id){ return FAVS.has(id); }
function touchFav(id){ FAV_LRU[id] = Date.now(); }

// ===== Cards =====
function cardHTML(rec){
  const fav = isFav(rec._id || rec.code);
  const id = rec._id || rec.code;
  const tagsHtml = Array.isArray(rec.tags) && rec.tags.length
    ? `<div class="tags">${rec.tags.map(t=>`<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';
  return `
    <button class="star" title="${fav?'Unfavourite':'Favourite'}" aria-pressed="${fav?'true':'false'}" data-code="${escapeHtml(id)}" aria-label="Favourite ${escapeHtml(rec.code)}">${fav?'★':'☆'}</button>
    <div style="min-width:86px">
      <div class="code">${escapeHtml(rec.code)}</div>
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

function billingCardHTML(rec){
  const fav = isFav(rec._id);
  const fee = rec.fee != null ? `$${Number(rec.fee).toFixed(2)}` : '';
  const duration = rec.durationMin ? `${rec.durationMin} min` : '';
  const telehealthBadge = rec.telehealth
    ? `<span class="badge badge-telehealth" title="Telehealth available">📹 Telehealth</span>`
    : '';
  return `
    <button class="star" title="${fav?'Unfavourite':'Favourite'}" aria-pressed="${fav?'true':'false'}" data-code="${escapeHtml(rec._id)}" aria-label="Favourite ${escapeHtml(rec.code)}">${fav?'★':'☆'}</button>
    <div style="min-width:86px">
      <div class="code billing-code">${escapeHtml(rec.code)}</div>
      <span class="badge badge-msp">MSP</span>
    </div>
    <div style="flex:1;min-width:0">
      <div class="name">${escapeHtml(rec.description || '')}</div>
      ${rec.category ? `<div class="billing-category muted">${escapeHtml(rec.category)}</div>` : ''}
      <div class="billing-meta">
        ${fee ? `<span class="billing-fee">${fee}</span>` : ''}
        ${duration ? `<span class="billing-duration">⏱ ${duration}</span>` : ''}
        ${telehealthBadge}
      </div>
    </div>
  `;
}

function renderSection(container, list){
  container.innerHTML = '';
  const frag = document.createDocumentFragment();
  list.forEach(rec => {
    const card = document.createElement('div');
    if (rec._type === 'billing') {
      card.className = 'card billing-card';
      card.dataset.code = rec._id;
      card.innerHTML = billingCardHTML(rec);
    } else {
      card.className = 'card';
      card.dataset.code = rec._id || rec.code;
      card.innerHTML = cardHTML(rec);
    }
    frag.appendChild(card);
  });
  container.appendChild(frag);
}

// ===== Favourites (pinned) =====
function getFavRecords(){
  return [...FAVS]
    .map(id => DATA_MAP.get(id))
    .filter(Boolean)
    .sort((a,b) => (FAV_LRU[b._id||b.code]||0) - (FAV_LRU[a._id||a.code]||0) || (a._id||a.code).localeCompare(b._id||b.code));
}
function refreshFavouritesUI(){
  const favList = getFavRecords();
  els.favCount.textContent = `(${favList.length})`;
  els.favWrap.classList.toggle('hidden', favList.length === 0);
  renderSection(els.favs, favList);
}

// ===== Search render (favourites pinned first) =====
function renderSearch(){
  if (!DATA && !BILLING_DATA) return;
  const q = els.q.value.trim();

  let hits;
  if (q) {
    const icdHits = FUSE ? FUSE.search(q).map(r => ({ ...r.item, _score: r.score ?? 1 })) : [];
    const billHits = BILLING_FUSE ? BILLING_FUSE.search(q).map(r => ({ ...r.item, _score: r.score ?? 1 })) : [];
    // Interleave by relevance score (lower = more relevant in Fuse)
    hits = [...icdHits, ...billHits].sort((a, b) => (a._score ?? 1) - (b._score ?? 1));
  } else {
    // Cap each source at half MAX_RESULTS so billing codes are always visible
    const perSource = Math.floor(MAX_RESULTS / 2);
    const icdDefault = DATA ? DATA.slice(0, perSource) : [];
    const billDefault = BILLING_DATA ? BILLING_DATA.slice(0, perSource) : [];
    hits = [...icdDefault, ...billDefault];
  }

  // Partition: favourites pinned at top, non-favs in results section
  const favSet = new Set([...FAVS]);
  const favHits = [];
  const otherHits = [];
  for (const it of hits) {
    const id = it._id || it.code;
    (favSet.has(id) ? favHits : otherHits).push(it);
  }

  renderSection(els.results, otherHits.slice(0, MAX_RESULTS));

  // Pinned favourites section (filtered by query if searching)
  const allFavs = getFavRecords();
  const favFiltered = q
    ? allFavs.filter(r => favHits.find(x => (x._id||x.code) === (r._id||r.code)))
    : allFavs;
  els.favWrap.classList.toggle('hidden', favFiltered.length === 0);
  renderSection(els.favs, favFiltered);
  els.favCount.textContent = `(${allFavs.length})`;

  els.resTitle.textContent = q ? `Results for "${q}"` : 'Results';
}

// ===== Fuse bootstrap =====
function buildFuse(data) {
  // Add _id and _type to ICD-9 records
  const enriched = data.map(r => ({ ...r, _id: r.code, _type: 'icd9' }));
  // Merge into DATA_MAP (keep billing entries)
  enriched.forEach(r => DATA_MAP.set(r._id, r));
  FUSE = new Fuse(enriched, {
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
  return enriched;
}

function buildBillingFuse(data) {
  // Add _id and _type to billing records
  const enriched = data.map(r => ({ ...r, _id: `billing:${r.code}`, _type: 'billing' }));
  enriched.forEach(r => DATA_MAP.set(r._id, r));
  BILLING_FUSE = new Fuse(enriched, {
    includeScore: true,
    threshold: 0.30,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: 'code',        weight: 0.35 },
      { name: 'description', weight: 0.40 },
      { name: 'category',    weight: 0.15 },
      { name: 'notes',       weight: 0.10 },
    ]
  });
  return enriched;
}

// ===== Load/cache ICD-9 dataset =====
async function loadFromCache() {
  const cached = await idbGet(KEY);
  if (cached && cached.data && Array.isArray(cached.data)) {
    BASE_DATA = cached.data;
    const enriched = buildFuse(applyCustomizations(BASE_DATA));
    DATA = enriched;
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
  const enriched = buildFuse(applyCustomizations(BASE_DATA));
  DATA = enriched;
  setMeta({
    count: DATA.length,
    source: 'network',
    version,
    updated: new Date().toLocaleString(),
    cacheState: 'updated'
  });
}

// ===== Load/cache Billing dataset =====
async function loadBillingFromCache() {
  const cached = await idbGet(BILLING_KEY);
  if (cached && cached.data && Array.isArray(cached.data)) {
    BILLING_DATA = buildBillingFuse(cached.data);
    window.BILLING_CODES = cached.data;
    window.dispatchEvent(new CustomEvent('billingCodesLoaded'));
    return true;
  }
  return false;
}
async function fetchAndCacheBilling() {
  const resp = await fetch(BILLING_DATA_URL, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Billing fetch failed: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const version = await sha256Hex(buf);
  const text = new TextDecoder('utf-8').decode(buf);
  const json = JSON.parse(text);

  await idbSet(BILLING_KEY, { version, updated: Date.now(), data: json });
  BILLING_DATA = buildBillingFuse(json);
  window.BILLING_CODES = json;
  window.dispatchEvent(new CustomEvent('billingCodesLoaded'));
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

function getRecordById(id) {
  return DATA_MAP.get(id) ?? null;
}

function openEditModal(id) {
  // Billing cards don't support editing
  if (id && id.startsWith('billing:')) return;

  const rec = getRecordById(id);
  if (!rec) return;

  editState.code = rec.code;
  editState.syn = Array.isArray(rec.syn) ? [...rec.syn] : [];
  editState.tags = Array.isArray(rec.tags) ? [...rec.tags] : [];

  document.getElementById('edit-code').textContent = rec.code;
  document.getElementById('edit-kind').value = rec.kind || '';
  document.getElementById('edit-name').value = rec.name || '';
  document.getElementById('edit-short').value = rec.short || '';

  createPillInput('edit-syn-container', editState.syn, 'Add synonym…');
  createPillInput('edit-tags-container', editState.tags, 'Add tag…');

  // Show/hide reset button based on whether customizations exist
  const hasCustom = !!getCustomizationsForCode(rec.code);
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
    const enriched = buildFuse(applyCustomizations(BASE_DATA));
    DATA = enriched;
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
    const enriched = buildFuse(applyCustomizations(BASE_DATA));
    DATA = enriched;
  }

  closeEditModal();
  renderSearch();
}

// ===== Events =====
function debounce(fn, ms=120){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
const onSearch = debounce(renderSearch, 80);

els.q.addEventListener('input', () => { if (FUSE || BILLING_FUSE) onSearch(); });

// star clicks (event delegation on both sections)
function onStarClick(e){
  const btn = e.target.closest('button.star'); if (!btn) return;
  const id = btn.dataset.code;
  if (!id) return;
  if (FAVS.has(id)) {
    FAVS.delete(id);
    delete FAV_LRU[id];
  } else {
    FAVS.add(id);
    touchFav(id);
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
    await fetchAndCacheBilling();
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
  await idbDel(BILLING_KEY);
  DATA = null; BASE_DATA = null; FUSE = null;
  BILLING_DATA = null; BILLING_FUSE = null;
  DATA_MAP = new Map();
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
// Global billing codes array — time-calc-widget.js reads this via window.BILLING_CODES
window.BILLING_CODES = null;

async function loadBillingCodes() {
  try {
    const resp = await fetch(BILLING_DATA_URL);
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
    // Load ICD-9 cache; billing cache is fire-and-forget (failure must not block boot)
    const [hadIcdCache, hadBillingCache] = await Promise.all([
      loadFromCache(),
      loadBillingFromCache().catch(e => { console.warn('Billing cache load failed:', e); return false; }),
      loadBillingCodes(),  // load window.BILLING_CODES for time-calc widget
    ]);

    // ICD-9 fetch is critical — keep on the main boot path
    if (!hadIcdCache) await fetchAndCache();

    // Billing fetch is non-critical — fire-and-forget with its own catch
    if (!hadBillingCache) {
      fetchAndCacheBilling()
        .then(() => renderSearch())
        .catch(e => console.warn('Billing fetch failed (non-fatal):', e));
    }


    renderSearch();           // initial paint (favs pinned)
    els.q.focus();            // focus search
  } catch (e) {
    console.error('Failed to initialize: ' + e.message + '\nPlace icd9.json next to this HTML.', e);
    setMeta({ cacheState: 'error' });
  }
})();
