// Minijob monthly tracker

const app = document.getElementById('app');
let currentMonth = app.dataset.month;
let state = null;

// ---------- formatting ----------

function fmtDuration(minutes) {
    if (minutes === null || minutes === undefined) return '';
    const sign = minutes < 0 ? '-' : '';
    const abs = Math.abs(minutes);
    return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

function fmtEuro(value, decimals = 2) {
    if (value === null || value === undefined) return '';
    return `${value.toFixed(decimals)} €`;
}

function fmtDayMonth(iso) {
    const [, m, d] = iso.split('-');
    return `${d}.${m}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}

// Accepts "18", "1800", "18:00", "8:5" -> "HH:MM"; returns null if invalid, '' if empty
function normalizeTime(value) {
    const text = value.trim();
    if (!text) return '';
    let h, m;
    if (text.includes(':')) {
        [h, m] = text.split(':');
    } else if (/^\d{1,2}$/.test(text)) {
        [h, m] = [text, '0'];
    } else if (/^\d{3,4}$/.test(text)) {
        [h, m] = [text.slice(0, -2), text.slice(-2)];
    } else {
        return null;
    }
    h = Number(h);
    m = Number(m);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59 || h < 0 || m < 0) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------- API ----------

async function api(url, options = {}) {
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (response.status === 401) {
        window.location.href = '/login';
        return null;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
}

async function loadMonth(month) {
    try {
        const data = await api(`/api/minijob/${month}`);
        if (data) render(data);
    } catch (err) {
        toast(err.message, true);
    }
}

function toast(message, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2500);
}

// ---------- rendering ----------

function render(data) {
    state = data;
    const s = data.settings;
    const t = data.totals;

    document.getElementById('subtitle').textContent =
        `${data.month_label} · ${s.hourly_wage.toFixed(2)} €/h · Limit ${s.monthly_limit.toFixed(0)} € · Max ${fmtDuration(s.max_minutes)} h`;

    // Settings (don't clobber a field the user is typing in)
    const setIfIdle = (id, value) => {
        const el = document.getElementById(id);
        if (document.activeElement !== el) el.value = value;
    };
    const [year, month] = data.month.split('-');
    document.getElementById('setMonth').textContent =
        new Date(Number(year), Number(month) - 1, 1).toLocaleString('en', { month: 'short', year: 'numeric' });
    setIfIdle('setWage', s.hourly_wage.toFixed(2));
    setIfIdle('setLimit', s.monthly_limit.toFixed(0));
    setIfIdle('setTarget', s.own_target_minutes ? fmtDuration(s.own_target_minutes) : '');
    document.getElementById('setMax').textContent = fmtDuration(s.max_minutes);
    document.getElementById('setMonthlyTarget').textContent = fmtDuration(s.target_minutes);

    // KPIs
    document.getElementById('kpiWorked').textContent = fmtDuration(t.worked_minutes);
    document.getElementById('kpiEarned').textContent = fmtEuro(t.earned);
    document.getElementById('kpiLeft').textContent = fmtEuro(t.left_to_limit);
    document.getElementById('kpiHoursLeft').textContent = fmtDuration(t.minutes_left);
    document.getElementById('kpiTips').textContent = fmtEuro(t.tips);
    document.getElementById('kpiPocket').textContent = fmtEuro(t.in_pocket);
    const over = t.left_to_limit < 0;
    document.getElementById('kpiLeft').parentElement.classList.toggle('over', over);
    document.getElementById('kpiHoursLeft').parentElement.classList.toggle('over', over);

    // Progress
    const fill = document.getElementById('progressFill');
    fill.style.width = `${Math.min(t.limit_pct, 100)}%`;
    fill.classList.toggle('over', over);
    document.getElementById('progressLabel').textContent = `${Math.round(t.limit_pct)}% of limit`;
    document.getElementById('progressMeta').textContent =
        `Shifts: ${t.shifts}  ·  Avg/shift: ${fmtDuration(t.avg_shift_minutes)}  ·  Projected month-end: ${t.projected.toFixed(0)} €`;
    document.getElementById('tipsNote').textContent =
        `Tips not counted toward the ${s.monthly_limit.toFixed(0)} € limit`;
    document.getElementById('tipsMeta').textContent =
        `Tips/hour: ${t.tips_per_hour.toFixed(2)} € · Effective: ${t.effective_wage.toFixed(2)} €/h`;

    renderDays(data.days);
    renderTotals(data);
    renderWeeks(data.weeks);
}

function statusCell(day) {
    if (day.status === 'logged') return '✅ Logged';
    if (day.status === 'off') return '🏖️ Off';
    if (day.status === 'open') return '<span class="status-open">⏳ Open</span>';
    return 'Mark off';
}

function renderDays(days) {
    // Preserve focus across re-render
    const active = document.activeElement;
    const focusKey = active?.dataset?.field ? `${active.closest('tr').dataset.date}:${active.dataset.field}` : null;

    const body = document.getElementById('daysBody');
    body.innerHTML = days.map(day => {
        const classes = [day.is_off ? 'off' : '', day.is_today ? 'today' : ''].join(' ');
        const breakText = day.status === 'logged' && !day.break_minutes ? 'No' : (day.break_minutes ? fmtDuration(day.break_minutes) : '');
        return `
        <tr class="${classes}" data-date="${day.date}">
            <td class="kw">${day.kw}</td>
            <td>${day.weekday}</td>
            <td>${fmtDayMonth(day.date)}</td>
            <td><input data-field="start" value="${day.is_off ? 'Off' : escapeHtml(day.start_time || '')}" aria-label="Start ${day.date}"></td>
            <td><input data-field="end" value="${escapeHtml(day.end_time || '')}" aria-label="End ${day.date}" ${day.is_off ? 'disabled' : ''}></td>
            <td><input data-field="break" value="${breakText}" aria-label="Break ${day.date}" ${day.is_off ? 'disabled' : ''}></td>
            <td class="net">${fmtDuration(day.net_minutes)}</td>
            <td>${fmtDuration(day.running_minutes)}</td>
            <td class="earned">${fmtEuro(day.earned)}</td>
            <td>${fmtEuro(day.running_earned)}</td>
            <td><button type="button" class="status-btn ${day.status ? '' : 'empty'}" data-action="toggle-off"
                title="${day.is_off ? 'Unmark day off' : 'Mark as day off'}">${statusCell(day)}</button></td>
            <td class="tips"><input data-field="tips" value="${day.tips ? fmtEuro(day.tips) : ''}" aria-label="Tips ${day.date}"></td>
            <td class="notes"><input data-field="notes" value="${escapeHtml(day.notes)}" aria-label="Notes ${day.date}"></td>
        </tr>`;
    }).join('');

    if (focusKey) {
        const [date, field] = focusKey.split(':');
        const el = body.querySelector(`tr[data-date="${date}"] input[data-field="${field}"]`);
        if (el) el.focus();
    }
}

function renderTotals(data) {
    const s = data.settings;
    const t = data.totals;
    document.getElementById('totalRow').innerHTML = `
        <td colspan="5">MONTH TOTAL</td>
        <td>${fmtDuration(t.break_minutes)}</td>
        <td>${fmtDuration(t.worked_minutes)}</td>
        <td>${fmtDuration(t.worked_minutes)} / ${fmtDuration(s.max_minutes)}</td>
        <td>${fmtEuro(t.earned)}</td>
        <td>${t.earned.toFixed(0)} / ${s.monthly_limit.toFixed(0)} €</td>
        <td></td>
        <td>${fmtEuro(t.tips)}</td>
        <td></td>`;
}

function renderWeeks(weeks) {
    const maxMinutes = Math.max(60, ...weeks.map(w => w.minutes));
    document.getElementById('weeksBody').innerHTML = weeks.map(w => {
        const hours = w.minutes / 60;
        const width = Math.round((w.minutes / maxMinutes) * 140);
        return `
        <tr class="${w.is_current ? 'current' : ''}">
            <td>${w.kw}</td>
            <td>${fmtDayMonth(w.from)}</td>
            <td>${fmtDuration(w.minutes)}</td>
            <td>${fmtEuro(w.earned)}</td>
            <td class="week-tips">${fmtEuro(w.tips)}</td>
            <td class="bar">${w.minutes ? `<span class="bar-fill" style="width:${width}px"></span>${hours.toFixed(1)}h` : ''}</td>
        </tr>`;
    }).join('');
}

// ---------- editing ----------

function rowPayload(tr) {
    const get = field => tr.querySelector(`input[data-field="${field}"]`).value.trim();
    const day = state.days.find(d => d.date === tr.dataset.date);
    return {
        is_off: day.is_off,
        start_time: get('start'),
        end_time: get('end'),
        break: get('break'),
        tips: get('tips').replace('€', '').replace(',', '.').trim(),
        notes: get('notes'),
    };
}

async function saveDay(date, payload) {
    try {
        const data = await api(`/api/minijob/day/${date}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
        if (data) render(data);
    } catch (err) {
        toast(err.message, true);
        loadMonth(currentMonth);
    }
}

function handleCellChange(input) {
    const tr = input.closest('tr');
    const field = input.dataset.field;
    const payload = rowPayload(tr);
    input.classList.remove('invalid');

    if (field === 'start' && /^off$/i.test(payload.start_time)) {
        payload.is_off = true;
    } else if (field === 'start' || field === 'end') {
        if (field === 'start' && payload.is_off) payload.is_off = false;
        const key = field === 'start' ? 'start_time' : 'end_time';
        const normalized = normalizeTime(payload[key] === 'Off' ? '' : payload[key]);
        if (normalized === null) {
            input.classList.add('invalid');
            toast('Use a time like 18:00', true);
            return;
        }
        payload[key] = normalized;
    }
    if (payload.is_off) {
        payload.start_time = '';
        payload.end_time = '';
        payload.break = '';
    }
    saveDay(tr.dataset.date, payload);
}

document.getElementById('daysBody').addEventListener('change', e => {
    if (e.target.matches('input[data-field]')) handleCellChange(e.target);
});

document.getElementById('daysBody').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input[data-field]')) {
        // Move down to the same column in the next row
        const tr = e.target.closest('tr');
        const field = e.target.dataset.field;
        e.target.blur();
        const next = tr.nextElementSibling?.querySelector(`input[data-field="${field}"]:not([disabled])`);
        if (next) next.focus();
    }
});

document.getElementById('daysBody').addEventListener('click', e => {
    const btn = e.target.closest('[data-action="toggle-off"]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const payload = rowPayload(tr);
    payload.is_off = !payload.is_off;
    if (payload.is_off) {
        if (payload.end_time && !confirmLoseShift()) return;
        payload.start_time = payload.end_time = payload.break = '';
    } else {
        payload.start_time = '';
    }
    saveDay(tr.dataset.date, payload);
});

function confirmLoseShift() {
    // Use a non-blocking approach: require a second click within 3s
    const now = Date.now();
    if (confirmLoseShift.last && now - confirmLoseShift.last < 3000) {
        confirmLoseShift.last = 0;
        return true;
    }
    confirmLoseShift.last = now;
    toast('Click again to replace this shift with a day off');
    return false;
}

// ---------- fast entry (quick add + paste) ----------

const WEEKDAY_RE = /^(mon|tue|wed|thu|fri|sat|sun|mo|di|mi|do|fr|sa|so)[a-z]*\.?$/i;
const OFF_RE = /^(off|frei)$/i;
const TIPS_RE = /^\d+(?:[.,]\d{1,2})?\s*€?$/;

function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "5", "5.10", "05.10.2026", "5/10/26", "2026-10-05", "today" -> ISO date, or null
function parseDateToken(token, baseMonth) {
    const t = token.toLowerCase();
    const today = new Date();
    if (t === 'today' || t === 'heute') return isoDate(today);
    if (t === 'yesterday' || t === 'gestern') {
        today.setDate(today.getDate() - 1);
        return isoDate(today);
    }
    let [y, m] = baseMonth.split('-').map(Number);
    let d;
    const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const dotted = t.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?\.?$/);
    const dayOnly = t.match(/^(\d{1,2})\.?$/);
    if (iso) {
        [y, m, d] = iso.slice(1).map(Number);
    } else if (dotted) {
        d = Number(dotted[1]);
        m = Number(dotted[2]);
        if (dotted[3]) y = Number(dotted[3]) + (dotted[3].length === 2 ? 2000 : 0);
    } else if (dayOnly) {
        d = Number(dayOnly[1]);
    } else {
        return null;
    }
    const date = new Date(y, m - 1, d);
    if (date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return isoDate(date);
}

// "10-18", "10:00–18:30" -> [start, end], or null
function parseRange(token) {
    const match = token.match(/^([\d:]+)\s*[-–]\s*([\d:]+)$/);
    if (!match) return null;
    const start = normalizeTime(match[1]);
    const end = normalizeTime(match[2]);
    return start && end ? [start, end] : null;
}

// "", "no", "30", "0:30", "1.5h" -> minutes, or null
function parseBreak(token) {
    const t = token.trim().toLowerCase();
    if (['', 'no', 'nein', '-', '0'].includes(t)) return 0;
    if (/^\d+$/.test(t)) return Number(t);
    const hm = t.match(/^(\d+):(\d{2})$/);
    if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
    const hours = t.match(/^(\d+(?:[.,]\d+)?)h$/);
    if (hours) return Math.round(Number(hours[1].replace(',', '.')) * 60);
    return null;
}

function parseTips(token) {
    const value = Number(token.replace('€', '').replace(',', '.').trim());
    return Number.isFinite(value) && value >= 0 ? value : null;
}

function shiftNetMinutes(start, end, breakMinutes) {
    const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    let gross = toMin(end) - toMin(start);
    if (gross <= 0) gross += 24 * 60;
    return Math.max(gross - breakMinutes, 0);
}

// Tab-separated line (spreadsheet): columns are positional, empty cells allowed
function parseCells(entry, cells) {
    if (cells.length && WEEKDAY_RE.test(cells[0])) cells.shift();
    const first = cells[0] || '';
    if (OFF_RE.test(first)) {
        entry.is_off = true;
        cells = cells.slice(1);
    } else {
        const range = parseRange(first);
        if (range) {
            [entry.start_time, entry.end_time] = range;
            cells = cells.slice(1);
        } else {
            entry.start_time = normalizeTime(first);
            entry.end_time = normalizeTime(cells[1] || '');
            if (first && entry.start_time === null) return `Invalid start "${first}"`;
            if (cells[1] && entry.end_time === null) return `Invalid end "${cells[1]}"`;
            cells = cells.slice(2);
        }
        entry.break = parseBreak(cells[0] || '');
        if (entry.break === null) return `Invalid break "${cells[0]}"`;
        cells = cells.slice(1);
    }
    if (cells[0]) {
        entry.tips = parseTips(cells[0]);
        if (entry.tips === null) return `Invalid tips "${cells[0]}"`;
    }
    if (cells[1]) entry.notes = cells.slice(1).join(' ').trim();
    return null;
}

// Free-typed line: "10-18 30 12", "10 18 0:30 8,50 €", "off"
function parseTokens(entry, tokens) {
    const notes = [];
    for (const token of tokens) {
        const range = !entry.start_time && parseRange(token);
        if (OFF_RE.test(token)) {
            entry.is_off = true;
        } else if (!entry.start_time && !entry.is_off && WEEKDAY_RE.test(token)) {
            // skip weekday names like "Mon"
        } else if (range) {
            [entry.start_time, entry.end_time] = range;
        } else if (/€|[.,]\d/.test(token) && entry.tips === undefined && parseTips(token) !== null) {
            entry.tips = parseTips(token);
        } else if (!entry.start_time && !entry.is_off && normalizeTime(token)) {
            entry.start_time = normalizeTime(token);
        } else if (entry.start_time && !entry.end_time && normalizeTime(token)) {
            entry.end_time = normalizeTime(token);
        } else if (entry.end_time && entry.break === undefined && parseBreak(token) !== null) {
            entry.break = parseBreak(token);
        } else if ((entry.end_time || entry.is_off) && entry.tips === undefined && TIPS_RE.test(token)) {
            entry.tips = parseTips(token);
        } else {
            notes.push(token);
        }
    }
    if (notes.length) entry.notes = notes.join(' ');
    return null;
}

// Parse one line into a day entry. Returns null for lines without a date
// (blank lines, headers) unless defaultToday is set (quick add).
function parseShiftLine(line, baseMonth, defaultToday = false) {
    const text = line.trim();
    if (!text) return null;
    const tabbed = line.includes('\t');
    const cells = tabbed ? line.split('\t').map(c => c.trim()) : text.split(/\s+/);
    if (cells.length > 1 && WEEKDAY_RE.test(cells[0])) cells.shift();

    let date = parseDateToken(cells[0], baseMonth);
    const looksLikeDate = /^\d{1,4}[./-]\d/.test(cells[0]) && !parseRange(cells[0]);
    if (date) {
        cells.shift();
    } else if (defaultToday && !looksLikeDate) {
        date = isoDate(new Date());
    } else if (looksLikeDate) {
        // Looks like a date but isn't one (e.g. 31.9): show it instead of skipping silently
        return { date: null, raw: text, error: `Invalid date "${cells[0]}"` };
    } else {
        return null;
    }

    const entry = { date, is_off: false, start_time: '', end_time: '' };
    const error = tabbed ? parseCells(entry, cells) : parseTokens(entry, cells);
    entry.start_time = entry.start_time || '';
    entry.end_time = entry.end_time || '';
    entry.break = entry.break || 0;
    if (error) {
        entry.error = error;
    } else if (!entry.is_off && !(entry.start_time && entry.end_time)) {
        entry.error = 'Needs a start and end time, or "off"';
    } else if (!entry.is_off) {
        entry.net_minutes = shiftNetMinutes(entry.start_time, entry.end_time, entry.break);
    }
    return entry;
}

function entryPayload(entry) {
    const { error, net_minutes, ...payload } = entry;
    return payload;
}

function hasExistingData(isoDay) {
    const day = state?.days.find(d => d.date === isoDay);
    return Boolean(day && (day.status || day.tips || day.notes));
}

function describeEntry(entry) {
    if (!entry.date) return entry.error;
    const d = new Date(`${entry.date}T00:00`);
    const label = d.toLocaleDateString('en', { weekday: 'short', day: '2-digit', month: '2-digit' });
    if (entry.error) return `${label} · ${entry.error}`;
    const parts = [label];
    if (entry.is_off) {
        parts.push('day off');
    } else {
        parts.push(`${entry.start_time}–${entry.end_time}`);
        if (entry.break) parts.push(`break ${fmtDuration(entry.break)}`);
        parts.push(`${fmtDuration(entry.net_minutes)} h`);
    }
    if (entry.tips !== undefined) parts.push(`tips ${fmtEuro(entry.tips)}`);
    if (hasExistingData(entry.date)) parts.push('replaces existing');
    return parts.join(' · ');
}

async function saveEntries(entries, month) {
    const data = await api(`/api/minijob/${month}/bulk`, {
        method: 'POST',
        body: JSON.stringify({ entries: entries.map(entryPayload) }),
    });
    if (!data) return null;
    if (month === currentMonth) {
        render(data);
    } else {
        goToMonth(month);
    }
    return data;
}

// Quick add

const quickInput = document.getElementById('quickInput');
const quickPreview = document.getElementById('quickPreview');

function updateQuickPreview() {
    const entry = parseShiftLine(quickInput.value, currentMonth, true);
    quickPreview.textContent = entry ? describeEntry(entry) : '';
    quickPreview.classList.toggle('error', Boolean(entry?.error));
}

quickInput.addEventListener('input', updateQuickPreview);

quickInput.addEventListener('paste', e => {
    // Multi-line paste goes to the paste dialog
    const text = e.clipboardData.getData('text');
    if (text.includes('\n')) {
        e.preventDefault();
        openPasteDialog(text);
    }
});

document.getElementById('quickForm').addEventListener('submit', async e => {
    e.preventDefault();
    const entry = parseShiftLine(quickInput.value, currentMonth, true);
    if (!entry) return;
    if (entry.error) {
        toast(entry.error, true);
        return;
    }
    try {
        await saveEntries([entry], entry.date.slice(0, 7));
        toast(`Saved ${describeEntry(entry).split(' · ').slice(0, 2).join(' · ')}`);
        quickInput.value = '';
        updateQuickPreview();
    } catch (err) {
        toast(err.message, true);
    }
});

// Paste dialog

const pasteDialog = document.getElementById('pasteDialog');
const pasteInput = document.getElementById('pasteInput');
let pastedEntries = [];

function openPasteDialog(text = '') {
    pasteInput.value = text;
    updatePastePreview();
    pasteDialog.showModal();
    pasteInput.focus();
}

function updatePastePreview() {
    pastedEntries = pasteInput.value.split(/\r?\n/)
        .map(line => parseShiftLine(line, currentMonth))
        .filter(Boolean);
    const valid = pastedEntries.filter(e => !e.error);
    const invalid = pastedEntries.length - valid.length;

    document.getElementById('pastePreview').innerHTML = pastedEntries.map(pasteRow).join('');

    let summary = 'Nothing to import yet';
    if (pastedEntries.length) {
        summary = `${plural(valid.length, 'day')} ready`;
        if (invalid) summary += ` · ${plural(invalid, 'line')} with problems will be skipped`;
    }
    document.getElementById('pasteSummary').textContent = summary;
    const btn = document.getElementById('importPaste');
    btn.disabled = !valid.length;
    btn.textContent = valid.length ? `Import ${plural(valid.length, 'day')}` : 'Import';
}

function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function pasteRow(entry) {
    if (entry.error) {
        const label = entry.date ? fmtDayMonth(entry.date) : escapeHtml(entry.raw);
        return `<tr class="invalid-row"><td>${label}</td><td colspan="6" class="paste-error">${escapeHtml(entry.error)}</td></tr>`;
    }
    const flag = hasExistingData(entry.date) ? 'replaces' : '';
    const tips = entry.tips === undefined ? '' : fmtEuro(entry.tips);
    if (entry.is_off) {
        return `<tr class="off"><td>${fmtDayMonth(entry.date)}</td><td>Off</td><td></td><td></td><td></td><td>${tips}</td><td class="paste-flag">${flag}</td></tr>`;
    }
    return `<tr>
        <td>${fmtDayMonth(entry.date)}</td>
        <td>${entry.start_time}</td>
        <td>${entry.end_time}</td>
        <td>${entry.break ? fmtDuration(entry.break) : 'No'}</td>
        <td class="net">${fmtDuration(entry.net_minutes)}</td>
        <td>${tips}</td>
        <td class="paste-flag">${flag}</td>
    </tr>`;
}

pasteInput.addEventListener('input', updatePastePreview);
document.getElementById('openPaste').addEventListener('click', () => openPasteDialog());
document.getElementById('closePaste').addEventListener('click', () => pasteDialog.close());
document.getElementById('cancelPaste').addEventListener('click', () => pasteDialog.close());

document.getElementById('importPaste').addEventListener('click', async () => {
    const valid = pastedEntries.filter(e => !e.error);
    if (!valid.length) return;
    try {
        const data = await saveEntries(valid, currentMonth);
        if (data) {
            const other = valid.filter(e => !e.date.startsWith(currentMonth)).length;
            const where = other ? ` (${other} in other months)` : '';
            toast(`Imported ${plural(data.saved, 'day')}${where}`);
            pasteDialog.close();
        }
    } catch (err) {
        toast(err.message, true);
    }
});

// ---------- settings ----------

document.getElementById('settingsForm').addEventListener('change', async () => {
    const payload = {
        hourly_wage: document.getElementById('setWage').value,
        monthly_limit: document.getElementById('setLimit').value,
        own_target: document.getElementById('setTarget').value.trim(),
    };
    try {
        const data = await api(`/api/minijob/${currentMonth}/settings`, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
        if (data) {
            render(data);
            toast('Settings saved');
        }
    } catch (err) {
        toast(err.message, true);
    }
});

document.getElementById('settingsForm').addEventListener('submit', e => e.preventDefault());

// ---------- month navigation ----------

function goToMonth(month) {
    currentMonth = month;
    document.getElementById('monthPicker').value = month;
    history.replaceState(null, '', `?month=${month}`);
    loadMonth(month);
}

function shiftMonth(delta) {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    goToMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
}

document.getElementById('prevMonth').addEventListener('click', () => shiftMonth(-1));
document.getElementById('nextMonth').addEventListener('click', () => shiftMonth(1));
document.getElementById('thisMonth').addEventListener('click', () => goToMonth(app.dataset.todayMonth));
document.getElementById('monthPicker').addEventListener('change', e => {
    if (e.target.value) goToMonth(e.target.value);
});

// ---------- year view ----------

let currentYear = Number(currentMonth.slice(0, 4));

async function loadYear(year) {
    try {
        const data = await api(`/api/minijob/year/${year}`);
        if (data) renderYear(data);
    } catch (err) {
        toast(err.message, true);
    }
}

function renderYear(data) {
    const t = data.totals;
    document.getElementById('yearLabel').textContent = data.year;
    document.getElementById('subtitle').textContent =
        `${data.year} · ${t.shifts} shifts · Annual limit ${t.annual_limit.toFixed(0)} €`;

    document.getElementById('yKpiWorked').textContent = fmtDuration(t.worked_minutes);
    document.getElementById('yKpiEarned').textContent = fmtEuro(t.earned);
    document.getElementById('yKpiLeft').textContent = fmtEuro(t.left_to_limit);
    document.getElementById('yKpiAvg').textContent = fmtEuro(t.avg_month_earned);
    document.getElementById('yKpiTips').textContent = fmtEuro(t.tips);
    document.getElementById('yKpiPocket').textContent = fmtEuro(t.in_pocket);
    const over = t.left_to_limit < 0;
    document.getElementById('yKpiLeft').parentElement.classList.toggle('over', over);

    const fill = document.getElementById('yProgressFill');
    fill.style.width = `${Math.min(t.limit_pct, 100)}%`;
    fill.classList.toggle('over', over);
    document.getElementById('yProgressLabel').textContent = `${Math.round(t.limit_pct)}% of annual limit`;
    document.getElementById('yProgressMeta').textContent =
        `Months over limit: ${t.months_over_limit}  ·  Effective: ${t.effective_wage.toFixed(2)} €/h incl. tips`;

    const maxEarned = Math.max(1, ...data.months.map(m => Math.max(m.earned, m.monthly_limit)));
    document.getElementById('yearBody').innerHTML = data.months.map(m => {
        const width = Math.round((m.earned / maxEarned) * 160);
        const classes = [m.is_current ? 'today' : '', m.is_future ? 'future' : '', m.over_limit ? 'over' : ''].join(' ');
        return `
        <tr class="${classes}" data-month="${m.month}" title="Open ${m.label}">
            <td class="month-name">${m.label}</td>
            <td>${m.shifts || ''}</td>
            <td>${m.worked_minutes ? fmtDuration(m.worked_minutes) : ''}</td>
            <td class="earned">${m.earned ? fmtEuro(m.earned) : ''}</td>
            <td class="pct">${m.earned ? `${Math.round(m.limit_pct)}%` : ''}</td>
            <td class="week-tips">${m.tips ? fmtEuro(m.tips) : ''}</td>
            <td class="net">${m.in_pocket ? fmtEuro(m.in_pocket) : ''}</td>
            <td class="bar">${m.earned ? `<span class="bar-fill" style="width:${width}px"></span>` : ''}</td>
        </tr>`;
    }).join('');

    document.getElementById('yearTotalRow').innerHTML = `
        <td>YEAR TOTAL</td>
        <td>${t.shifts}</td>
        <td>${fmtDuration(t.worked_minutes)}</td>
        <td>${fmtEuro(t.earned)}</td>
        <td>${Math.round(t.limit_pct)}%</td>
        <td>${fmtEuro(t.tips)}</td>
        <td>${fmtEuro(t.in_pocket)}</td>
        <td></td>`;
}

function goToYear(year) {
    currentYear = year;
    // Keep the open month in the URL so switching back to Month returns to it
    const month = currentMonth.startsWith(`${year}-`) ? currentMonth : `${year}-01`;
    history.replaceState(null, '', `?view=year&month=${month}`);
    loadYear(year);
}

document.getElementById('prevYear').addEventListener('click', () => goToYear(currentYear - 1));
document.getElementById('nextYear').addEventListener('click', () => goToYear(currentYear + 1));
document.getElementById('thisYear').addEventListener('click', () => goToYear(Number(app.dataset.todayMonth.slice(0, 4))));
document.getElementById('yearBody').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-month]');
    if (tr) setView('month', tr.dataset.month);
});

// ---------- view switching ----------

function setView(view, month) {
    const isYear = view === 'year';
    document.getElementById('monthView').hidden = isYear;
    document.getElementById('monthNav').hidden = isYear;
    document.getElementById('yearView').hidden = !isYear;
    document.getElementById('yearNav').hidden = !isYear;
    document.querySelectorAll('.mj-tabs button').forEach(btn => {
        const active = btn.dataset.view === view;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active);
    });
    if (isYear) {
        goToYear(Number((month || currentMonth).slice(0, 4)));
    } else {
        goToMonth(month || currentMonth);
    }
}

document.querySelector('.mj-tabs').addEventListener('click', e => {
    const btn = e.target.closest('button[data-view]');
    if (btn) setView(btn.dataset.view);
});

setView(app.dataset.view);
