/**
 * time-calc.js — Pure time parsing and math utilities.
 * No DOM, no dependencies. Importable as ES module.
 */

/**
 * Parse a time string into minutes since midnight.
 *
 * Supported formats:
 *   - "1104"      → 4-digit military (HHMM)
 *   - "11:04"     → colon-separated 24h
 *   - "1:04 PM"   → 12-hour with AM/PM (case-insensitive)
 *
 * Returns null for invalid input.
 *
 * @param {string} input
 * @returns {number|null} minutes since midnight, or null if invalid
 */
export function parseTime(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();

  // 12-hour with AM/PM: "1:04 PM", "12:00 am", etc.
  const ampmMatch = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = parseInt(ampmMatch[2], 10);
    const meridiem = ampmMatch[3].toUpperCase();

    if (minutes > 59) return null;
    if (hours < 1 || hours > 12) return null;

    // 12-hour conversion:
    // 12 AM → 0, 12 PM → 12, 1-11 AM → 1-11, 1-11 PM → 13-23
    if (meridiem === 'AM') {
      hours = hours === 12 ? 0 : hours;
    } else {
      hours = hours === 12 ? 12 : hours + 12;
    }

    return hours * 60 + minutes;
  }

  // Colon-separated 24h: "11:04", "23:59"
  const colonMatch = s.match(/^(\d{1,2}):(\d{2})$/);
  if (colonMatch) {
    const hours = parseInt(colonMatch[1], 10);
    const minutes = parseInt(colonMatch[2], 10);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  // 4-digit military: "1104", "0000", "2359"
  const militaryMatch = s.match(/^(\d{4})$/);
  if (militaryMatch) {
    const hours = parseInt(s.slice(0, 2), 10);
    const minutes = parseInt(s.slice(2, 4), 10);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  return null;
}

/**
 * Calculate duration in minutes between two times.
 * Overnight-aware: if end < start, wraps forward across midnight.
 *
 * @param {number} startMins — start time in minutes since midnight
 * @param {number} endMins   — end time in minutes since midnight
 * @returns {number} duration in minutes (always positive)
 */
export function duration(startMins, endMins) {
  if (endMins >= startMins) {
    return endMins - startMins;
  }
  // Overnight wrap: add 1440 (24h)
  return 1440 - startMins + endMins;
}

/**
 * Calculate end time given a start time and duration.
 *
 * @param {number} startMins    — start time in minutes since midnight
 * @param {number} durationMins — duration in minutes
 * @returns {number} end time in minutes since midnight (mod 1440)
 */
export function endTime(startMins, durationMins) {
  return (startMins + durationMins) % 1440;
}

/**
 * Calculate start time given an end time and duration.
 *
 * @param {number} endMins      — end time in minutes since midnight
 * @param {number} durationMins — duration in minutes
 * @returns {number} start time in minutes since midnight (mod 1440)
 */
export function startTime(endMins, durationMins) {
  return ((endMins - durationMins) % 1440 + 1440) % 1440;
}

/**
 * Format minutes since midnight as a 24h time string "HH:MM".
 *
 * @param {number} totalMins
 * @returns {string} e.g. "13:13", "00:00"
 */
export function formatTime(totalMins) {
  const h = Math.floor(totalMins / 60) % 24;
  const m = totalMins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Format a duration in minutes as a human-readable string "Xh Ym".
 *
 * @param {number} totalMins
 * @returns {string} e.g. "2h 30m", "0h 45m"
 */
export function formatDuration(totalMins) {
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${h}h ${m}m`;
}
