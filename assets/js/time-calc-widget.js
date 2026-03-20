/**
 * time-calc-widget.js — Time calculator widget for the ICD-9 header.
 * Imports pure utilities from time-calc.js (ES module).
 */
import { parseTime, duration, endTime, startTime, formatTime, formatDuration } from './time-calc.js';

const STORAGE_KEY = 'icd9:timecalc:open';

// ===== Bracket Logic =====
const BRACKETS = [30, 45, 60, 68, 75, 90];
const BRACKET_LABELS = {
  30: '½ hr', 45: '¾ hr', 60: '1 hr', 68: '>68 min', 75: '1¼ hr', 90: '1½ hr'
};

// Maps a duration in minutes to the durationMin bracket used in billing codes.
// Returns null if below minimum (< 30 min).
function getBillingBracket(durationMins) {
  if (durationMins < 30)  return null;  // below minimum
  if (durationMins < 45)  return 30;    // 1/2 hr
  if (durationMins < 60)  return 45;    // 3/4 hr
  if (durationMins < 68)  return 60;    // 1 hr
  if (durationMins < 75)  return 68;    // extended psychiatry >68 min
  if (durationMins < 90)  return 75;    // 1 1/4 hr
  return 90;                            // 1 1/2 hr (max)
}

function getAdjacentBrackets(bracket) {
  const idx = BRACKETS.indexOf(bracket);
  return {
    below: idx > 0 ? BRACKETS[idx - 1] : null,
    above: idx < BRACKETS.length - 1 ? BRACKETS[idx + 1] : null,
  };
}

// ===== Billing Suggestions =====
// Returns codes for a specific bracket, sorted: in-person first, then telehealth.
function getCodesForBracket(bracket) {
  const codes = window.BILLING_CODES;
  if (!Array.isArray(codes) || !bracket) return [];
  return codes
    .filter(c => c.durationMin === bracket)
    .sort((a, b) => (a.telehealth === b.telehealth ? 0 : a.telehealth ? 1 : -1));
}

// Returns codes matching the bracket, sorted: in-person first, then telehealth.
function getSuggestedCodes(durationMins) {
  const codes = window.BILLING_CODES;
  if (!Array.isArray(codes) || codes.length === 0) return null;

  const bracket = getBillingBracket(durationMins);
  if (bracket === null) return [];

  return getCodesForBracket(bracket);
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

  const bracket = getBillingBracket(durationMins);

  if (bracket === null) {
    // Below minimum
    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="billing-suggest-header">Suggested Billing Codes</div>
      <div class="billing-suggest-note">Below minimum billing duration (30 min)</div>
    `;
    return;
  }

  const suggestions = getSuggestedCodes(durationMins);

  if (!suggestions || suggestions.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');

  const header = document.createElement('div');
  header.className = 'billing-suggest-header';
  header.textContent = 'Suggested Billing Codes';
  container.appendChild(header);

  // Helper to build a list of billing-suggest-item buttons
  function buildList(codes, isPrimary) {
    const list = document.createElement('div');
    list.className = 'billing-suggest-list';
    codes.forEach(code => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = isPrimary ? 'billing-suggest-item primary' : 'billing-suggest-item';
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
    return list;
  }

  // Primary section (exact bracket)
  container.appendChild(buildList(suggestions, true));

  // Adjacent sections
  const { below, above } = getAdjacentBrackets(bracket);
  [below, above].forEach(adjBracket => {
    if (!adjBracket) return;
    const adjCodes = getCodesForBracket(adjBracket);
    if (adjCodes.length === 0) return;

    const subheader = document.createElement('div');
    subheader.className = 'billing-suggest-subheader';
    subheader.textContent = `Also consider — ${BRACKET_LABELS[adjBracket] || adjBracket + ' min'}`;
    container.appendChild(subheader);
    container.appendChild(buildList(adjCodes, false));
  });
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
  const toggle   = document.getElementById('time-calc-toggle');
  const panel    = document.getElementById('time-calc-panel');
  const tcStart  = document.getElementById('tc-start');
  const tcEnd    = document.getElementById('tc-end');
  const tcDur    = document.getElementById('tc-duration');
  const tcResult = document.getElementById('tc-result');
  const tcClear  = document.getElementById('tc-clear');
  const tcSuggest = document.getElementById('tc-billing-suggest');

  if (!toggle || !panel || !tcStart || !tcEnd || !tcDur || !tcResult || !tcClear) return;

  // Restore open state
  const savedOpen = localStorage.getItem(STORAGE_KEY) === 'true';
  if (savedOpen) {
    panel.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
  }

  toggle.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    localStorage.setItem(STORAGE_KEY, String(isOpen));
    if (isOpen) tcStart.focus();
  });

  // Track the last calculated duration (start+end → duration result)
  let lastDurationMins = null;

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

      // Show billing suggestions only when a duration is known
      lastDurationMins = calculatedDuration;
      if (tcSuggest && calculatedDuration !== null) {
        renderSuggestions(tcSuggest, calculatedDuration);
      }
    } catch {
      tcResult.textContent = 'err';
      tcResult.className = 'time-calc-result err';
    }
  }

  [tcStart, tcEnd, tcDur].forEach(el => {
    el.addEventListener('input', compute);
  });

  tcClear.addEventListener('click', () => {
    tcStart.value = '';
    tcEnd.value   = '';
    tcDur.value   = '';
    tcResult.textContent = '';
    tcResult.className = 'time-calc-result';
    lastDurationMins = null;
    if (tcSuggest) {
      tcSuggest.innerHTML = '';
      tcSuggest.classList.add('hidden');
    }
    tcStart.focus();
  });

  // Delegation for copy-on-click on billing suggestions
  if (tcSuggest) {
    tcSuggest.addEventListener('click', e => {
      const btn = e.target.closest('.billing-suggest-item');
      if (!btn || !btn.dataset.code) return;
      copyCodeToClipboard(btn, btn.dataset.code);
    });

    // Re-render if billing codes load after compute ran
    window.addEventListener('billingCodesLoaded', () => {
      if (lastDurationMins !== null) {
        renderSuggestions(tcSuggest, lastDurationMins);
      }
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
