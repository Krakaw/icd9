/**
 * time-calc-widget.js — Time calculator widget for the ICD-9 header.
 * Imports pure utilities from time-calc.js (ES module).
 */
import { parseTime, duration, endTime, startTime, formatTime, formatDuration } from './time-calc.js';

const STORAGE_KEY = 'icd9:timecalc:open';

function init() {
  const toggle   = document.getElementById('time-calc-toggle');
  const panel    = document.getElementById('time-calc-panel');
  const tcStart  = document.getElementById('tc-start');
  const tcEnd    = document.getElementById('tc-end');
  const tcDur    = document.getElementById('tc-duration');
  const tcResult = document.getElementById('tc-result');
  const tcClear  = document.getElementById('tc-clear');

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
      return;
    }

    try {
      if (hasStart && hasEnd && !hasDur) {
        // Start + End → duration
        const d = duration(startMins, endMins);
        tcResult.textContent = `${formatDuration(d)} (${d} min)`;
        tcResult.className = 'time-calc-result ok';
      } else if (hasStart && hasDur && !hasEnd) {
        // Start + Duration → end time
        const e = endTime(startMins, durMins);
        tcResult.textContent = formatTime(e);
        tcResult.className = 'time-calc-result ok';
      } else if (hasEnd && hasDur && !hasStart) {
        // End + Duration → start time
        const s = startTime(endMins, durMins);
        tcResult.textContent = formatTime(s);
        tcResult.className = 'time-calc-result ok';
      } else if (filledCount === 3) {
        // All three filled — prefer Start+End→duration
        const d = duration(startMins, endMins);
        tcResult.textContent = `${formatDuration(d)} (${d} min)`;
        tcResult.className = 'time-calc-result ok';
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
    tcStart.focus();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
