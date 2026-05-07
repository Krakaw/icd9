/**
 * time-calc-widget.js — Time calculator widget for the ICD-9 header.
 * Imports pure utilities from time-calc.js (ES module).
 */
import { parseTime, duration, endTime, startTime, formatTime, formatDuration, daysAgo } from './time-calc.js';

// ===== Bracket Logic =====
const MAX_SUGGESTIONS = 5;

// Short-session visit codes billed when the session is too short for a
// time-bracketed psychotherapy code.
const SHORT_VISIT_CODES = new Set(['00607', '00608', '00609', '60607', '60608']);

// Maps a duration in minutes to the durationMin bracket used in billing codes.
// Returns null when the session is shorter than the 30-min bracket threshold
// (< 25 min) — visit codes apply in that case.
function getBillingBracket(durationMins) {
  if (durationMins < 25)  return null;  // below therapy bracket → visit code
  if (durationMins < 38)  return 30;    // 1/2 hr  (midpoint 30↔45)
  if (durationMins < 53)  return 45;    // 3/4 hr  (midpoint 45↔60)
  if (durationMins < 68)  return 60;    // 1 hr
  if (durationMins < 75)  return 68;    // extended psychiatry >68 min
  if (durationMins < 90)  return 75;    // 1 1/4 hr
  return 90;                            // 1 1/2 hr (max)
}

// True for family/conjoint therapy codes. Excludes "family member" interview
// codes (eval interviews are individual work, not family therapy).
function isFamilyCode(code) {
  const desc = (code.description || '').toLowerCase();
  return /family|conjoint/.test(desc) && !desc.includes('family member');
}

function rankByFee(a, b) {
  if (b.fee !== a.fee) return b.fee - a.fee;
  return a.telehealth === b.telehealth ? 0 : a.telehealth ? 1 : -1;
}

// ===== Billing Suggestions =====
// Returns { individual, family } — each an array of up to MAX_SUGGESTIONS codes
// whose duration bracket applies, sorted by fee descending.
// For sub-bracket sessions (< 25 min) returns short-visit codes in individual.
function getSuggestedCodes(durationMins) {
  const codes = window.BILLING_CODES;
  if (!Array.isArray(codes) || codes.length === 0) return null;

  const bracket = getBillingBracket(durationMins);

  if (bracket === null) {
    const visits = codes
      .filter(c => SHORT_VISIT_CODES.has(c.code) && c.fee != null)
      .sort(rankByFee)
      .slice(0, MAX_SUGGESTIONS);
    return { individual: visits, family: [] };
  }

  const applicable = codes.filter(
    c => c.durationMin != null && c.durationMin <= bracket && c.fee != null
  );

  return {
    individual: applicable.filter(c => !isFamilyCode(c)).sort(rankByFee).slice(0, MAX_SUGGESTIONS),
    family:     applicable.filter(isFamilyCode).sort(rankByFee).slice(0, MAX_SUGGESTIONS),
  };
}

function formatFee(fee) {
  if (fee == null) return '';
  return '$' + Number(fee).toFixed(2);
}

function renderSuggestions(container, durationMins) {
  container.innerHTML = '';

  // Billing codes not loaded yet — hide section
  if (!Array.isArray(window.BILLING_CODES)) {
    container.classList.add('hidden');
    return;
  }

  const suggestions = getSuggestedCodes(durationMins);

  if (!suggestions || (suggestions.individual.length === 0 && suggestions.family.length === 0)) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');

  const header = document.createElement('div');
  header.className = 'billing-suggest-header';

  const headerTitle = document.createElement('span');
  headerTitle.textContent = 'Suggested Billing Codes';
  header.appendChild(headerTitle);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'billing-suggest-close';
  closeBtn.setAttribute('aria-label', 'Hide suggestions');
  closeBtn.title = 'Hide suggestions';
  closeBtn.textContent = '✕';
  header.appendChild(closeBtn);

  container.appendChild(header);

  const columns = document.createElement('div');
  columns.className = 'billing-suggest-columns';

  columns.appendChild(buildColumn('Individual', suggestions.individual));
  columns.appendChild(buildColumn('Family / Conjoint', suggestions.family));

  container.appendChild(columns);
}

function buildColumn(label, codes) {
  const col = document.createElement('div');
  col.className = 'billing-suggest-column';

  const subheader = document.createElement('div');
  subheader.className = 'billing-suggest-column-header';
  subheader.textContent = label;
  col.appendChild(subheader);

  if (codes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'billing-suggest-note';
    empty.textContent = '—';
    col.appendChild(empty);
    return col;
  }

  const list = document.createElement('div');
  list.className = 'billing-suggest-list';
  codes.forEach((code, idx) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = idx === 0 ? 'billing-suggest-item primary' : 'billing-suggest-item';
    item.dataset.code = code.code;
    item.title = `Click to copy code ${code.code}`;

    const codeEl = document.createElement('span');
    codeEl.className = 'billing-code';
    codeEl.textContent = code.code;

    const descEl = document.createElement('span');
    descEl.className = 'billing-desc';
    descEl.textContent = code.description;

    const metaEl = document.createElement('span');
    metaEl.className = 'billing-meta';

    if (code.telehealth) {
      const badge = document.createElement('span');
      badge.className = 'billing-telehealth-badge';
      badge.textContent = 'telehealth';
      metaEl.appendChild(badge);
    }

    if (code.fee != null) {
      const feeEl = document.createElement('span');
      feeEl.className = 'billing-fee';
      feeEl.textContent = formatFee(code.fee);
      metaEl.appendChild(feeEl);
    }

    item.appendChild(codeEl);
    item.appendChild(descEl);
    item.appendChild(metaEl);
    list.appendChild(item);
  });
  col.appendChild(list);
  return col;
}

// Copy code to clipboard and briefly highlight the button
function copyCodeToClipboard(btn, code) {
  navigator.clipboard.writeText(code).then(() => {
    btn.classList.add('copied');
    btn.title = `Copied!`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.title = `Click to copy code ${code}`;
    }, 1500);
  }).catch(() => {
    // Fallback: select search input and populate it
    const q = document.getElementById('q');
    if (q) {
      q.value = code;
      q.dispatchEvent(new Event('input'));
      q.focus();
    }
  });
}

function init() {
  const tcStart     = document.getElementById('tc-start');
  const tcEnd       = document.getElementById('tc-end');
  const tcDur       = document.getElementById('tc-duration');
  const tcResult    = document.getElementById('tc-result');
  const tcClear     = document.getElementById('tc-clear');
  const tcSuggest   = document.getElementById('tc-billing-suggest');
  const tcDaysAgo   = document.getElementById('tc-days-ago');
  const tcDaysResult = document.getElementById('tc-days-result');
  const tcTimesLog   = document.getElementById('tc-times-log');
  const tcTimesBody  = document.getElementById('tc-times-body');
  const tcTimesClear = document.getElementById('tc-times-clear');

  if (!tcStart || !tcEnd || !tcDur || !tcResult || !tcClear) return;

  const timesLog = [];

  function captureTimes() {
    const startMins = parseTime(tcStart.value.trim());
    const endMins   = parseTime(tcEnd.value.trim());
    const durVal    = tcDur.value.trim();
    const durMins   = durVal !== '' ? parseInt(durVal, 10) : null;

    const hasStart = startMins !== null;
    const hasEnd   = endMins !== null;
    const hasDur   = durMins !== null && !isNaN(durMins) && durMins >= 0;

    try {
      if (hasStart && hasEnd) return { start: startMins, end: endMins, duration: duration(startMins, endMins) };
      if (hasStart && hasDur) return { start: startMins, end: endTime(startMins, durMins), duration: durMins };
      if (hasEnd && hasDur)   return { start: startTime(endMins, durMins), end: endMins, duration: durMins };
    } catch { /* noop */ }
    return null;
  }

  function renderTimesLog() {
    if (!tcTimesLog || !tcTimesBody) return;
    tcTimesBody.innerHTML = '';
    if (timesLog.length === 0) {
      tcTimesLog.classList.add('hidden');
      return;
    }
    tcTimesLog.classList.remove('hidden');
    timesLog.forEach(entry => {
      const tr = document.createElement('tr');
      [formatTime(entry.start), formatTime(entry.end), String(entry.duration)].forEach(text => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      tcTimesBody.appendChild(tr);
    });
  }

  // Track the last calculated duration (start+end → duration result)
  let lastDurationMins = null;
  // Duration at which the user dismissed the suggestions popover. While the
  // calculated duration matches this, keep the popover hidden so they can
  // close it without clearing the times.
  let dismissedAtDuration = null;

  function compute() {
    const startVal = tcStart.value.trim();
    const endVal   = tcEnd.value.trim();
    const durVal   = tcDur.value.trim();

    const startMins = parseTime(startVal);
    const endMins   = parseTime(endVal);
    const durMins   = durVal !== '' ? parseInt(durVal, 10) : null;

    const hasStart = startMins !== null;
    const hasEnd   = endMins !== null;
    const hasDur   = durMins !== null && !isNaN(durMins) && durMins >= 0;

    // Need exactly 2 filled fields
    const filledCount = [hasStart, hasEnd, hasDur].filter(Boolean).length;
    if (filledCount < 2) {
      tcResult.textContent = '';
      tcResult.className = 'time-calc-result';
      // Clear suggestions when incomplete
      if (tcSuggest) {
        tcSuggest.innerHTML = '';
        tcSuggest.classList.add('hidden');
      }
      lastDurationMins = null;
      return;
    }

    try {
      let calculatedDuration = null;

      if (hasStart && hasEnd && !hasDur) {
        // Start + End → duration
        const d = duration(startMins, endMins);
        tcResult.textContent = `${formatDuration(d)} (${d} min)`;
        tcResult.className = 'time-calc-result ok';
        calculatedDuration = d;
      } else if (hasStart && hasDur && !hasEnd) {
        // Start + Duration → end time
        const e = endTime(startMins, durMins);
        tcResult.textContent = formatTime(e);
        tcResult.className = 'time-calc-result ok';
        calculatedDuration = durMins;
      } else if (hasEnd && hasDur && !hasStart) {
        // End + Duration → start time
        const s = startTime(endMins, durMins);
        tcResult.textContent = formatTime(s);
        tcResult.className = 'time-calc-result ok';
        calculatedDuration = durMins;
      } else if (filledCount === 3) {
        // All three filled — prefer Start+End→duration
        const d = duration(startMins, endMins);
        tcResult.textContent = `${formatDuration(d)} (${d} min)`;
        tcResult.className = 'time-calc-result ok';
        calculatedDuration = d;
      }

      lastDurationMins = calculatedDuration;
      // Reset the dismissed flag whenever the duration changes so a new
      // duration re-opens the popover.
      if (calculatedDuration !== dismissedAtDuration) dismissedAtDuration = null;
      // Show billing suggestions only when a duration is known and the user
      // hasn't dismissed them at this duration.
      if (tcSuggest && calculatedDuration !== null && calculatedDuration !== dismissedAtDuration) {
        renderSuggestions(tcSuggest, calculatedDuration);
      }
    } catch {
      tcResult.textContent = 'err';
      tcResult.className = 'time-calc-result err';
    }
  }

  [tcStart, tcEnd, tcDur].forEach(el => {
    el.addEventListener('input', compute);
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const captured = captureTimes();
      if (!captured) return;
      e.preventDefault();
      timesLog.push(captured);
      renderTimesLog();
      tcStart.value = formatTime(captured.end);
      tcEnd.value   = '';
      tcDur.value   = '';
      tcResult.textContent = '';
      tcResult.className = 'time-calc-result';
      lastDurationMins = null;
      dismissedAtDuration = null;
      if (tcSuggest) {
        tcSuggest.innerHTML = '';
        tcSuggest.classList.add('hidden');
      }
      tcEnd.focus();
    });
  });

  if (tcTimesClear) {
    tcTimesClear.addEventListener('click', () => {
      timesLog.length = 0;
      renderTimesLog();
    });
  }

  // ===== Days Ago Calculator =====
  function computeDaysAgo() {
    if (!tcDaysAgo || !tcDaysResult) return;
    const val = tcDaysAgo.value.trim();
    if (val === '') {
      tcDaysResult.textContent = '';
      tcDaysResult.className = 'time-calc-days-result';
      return;
    }
    const days = parseInt(val, 10);
    const result = daysAgo(days);
    if (result === null) {
      tcDaysResult.textContent = '—';
      tcDaysResult.className = 'time-calc-days-result err';
    } else {
      tcDaysResult.textContent = result;
      tcDaysResult.className = 'time-calc-days-result ok';
    }
  }

  if (tcDaysAgo) {
    tcDaysAgo.addEventListener('input', computeDaysAgo);
  }

  tcClear.addEventListener('click', () => {
    tcStart.value = '';
    tcEnd.value   = '';
    tcDur.value   = '';
    tcResult.textContent = '';
    tcResult.className = 'time-calc-result';
    lastDurationMins = null;
    dismissedAtDuration = null;
    if (tcSuggest) {
      tcSuggest.innerHTML = '';
      tcSuggest.classList.add('hidden');
    }
    if (tcDaysAgo)   { tcDaysAgo.value = ''; }
    if (tcDaysResult) { tcDaysResult.textContent = ''; tcDaysResult.className = 'time-calc-days-result'; }
    tcStart.focus();
  });

  // Delegation for copy-on-click on billing suggestions and dismiss button
  if (tcSuggest) {
    tcSuggest.addEventListener('click', e => {
      if (e.target.closest('.billing-suggest-close')) {
        dismissedAtDuration = lastDurationMins;
        tcSuggest.classList.add('hidden');
        return;
      }
      const btn = e.target.closest('.billing-suggest-item');
      if (!btn || !btn.dataset.code) return;
      copyCodeToClipboard(btn, btn.dataset.code);
    });

    // Re-render if billing codes load after compute ran
    window.addEventListener('billingCodesLoaded', () => {
      if (lastDurationMins !== null && lastDurationMins !== dismissedAtDuration) {
        renderSuggestions(tcSuggest, lastDurationMins);
      }
    });

    // Dismiss the popover on any click outside it.
    document.addEventListener('click', e => {
      if (tcSuggest.classList.contains('hidden')) return;
      if (tcSuggest.contains(e.target)) return;
      dismissedAtDuration = lastDurationMins;
      tcSuggest.classList.add('hidden');
    });

    // Dismiss the popover on Escape.
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (tcSuggest.classList.contains('hidden')) return;
      dismissedAtDuration = lastDurationMins;
      tcSuggest.classList.add('hidden');
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
