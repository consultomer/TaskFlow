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
    if (day.status === 'logged') return `✅ Logged${day.late ? ' 🌙' : ''}`;
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
document.getElementById('monthPicker').addEventListener('change', e => {
    if (e.target.value) goToMonth(e.target.value);
});

loadMonth(currentMonth);
