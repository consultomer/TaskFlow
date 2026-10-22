// Daily planner

const app = document.getElementById('app');
let currentDay = app.dataset.day;
let currentView = app.dataset.view;
let dayData = null;
let routine = null;
let routineWeekday = new Date(`${currentDay}T00:00`).getDay() === 0 ? 6 : new Date(`${currentDay}T00:00`).getDay() - 1;
let editingId = null; // block being edited in the Day view ('new' for a new one)

const CATEGORIES = {
    german: 'German',
    k8s: 'Kubernetes',
    jobs: 'Job search',
    routine: 'Routine',
    free: 'Free time',
    other: 'Other',
    work: 'Work',
    travel: 'Travel',
};
const EDITABLE_CATEGORIES = ['german', 'k8s', 'jobs', 'routine', 'free', 'other'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---------- helpers ----------

function toMinutes(time) {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}

function fmtDuration(minutes) {
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function fmtHours(minutes) {
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}

function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(iso, days) {
    const d = new Date(`${iso}T00:00`);
    d.setDate(d.getDate() + days);
    return isoDate(d);
}

// Accepts "8", "800", "8:00", "08:00" -> "HH:MM", or null
function normalizeTime(value) {
    const text = String(value).trim();
    let h;
    let m;
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
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59 || h > 24 || (h === 24 && m > 0)) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function nowMinutes() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (response.status === 401) {
        globalThis.location.href = '/login';
        return null;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
}

function toast(message, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2500);
}

async function run(promise) {
    try {
        return await promise;
    } catch (err) {
        toast(err.message, true);
        return null;
    }
}

// ---------- day view ----------

async function loadDay() {
    const data = await run(api(`/api/planner/day/${currentDay}`));
    if (data) renderDay(data);
}

function categoryOptions(selected) {
    return EDITABLE_CATEGORIES.map(c =>
        `<option value="${c}" ${c === selected ? 'selected' : ''}>${CATEGORIES[c]}</option>`).join('');
}

function blockBadges(block) {
    const badges = [];
    if (block.source === 'minijob') badges.push('<span class="pl-badge">from Minijob tracker</span>');
    if (block.moved_from) badges.push(`<span class="pl-badge pl-badge-moved">moved from ${block.moved_from}</span>`);
    if (block.shortened) badges.push('<span class="pl-badge pl-badge-warn">shortened</span>');
    if (block.clash) badges.push('<span class="pl-badge pl-badge-warn">clashes with work</span>');
    return badges.join('');
}

function taskItem(task) {
    let timer = `<button type="button" class="pl-icon-btn" data-action="timer" data-task="${task.id}" title="Start timer"><i class="ti ti-player-play"></i></button>`;
    if (task.timer_active) timer = '<span class="pl-running" title="Timer running"><i class="ti ti-clock-play"></i></span>';
    if (task.completed) timer = '';
    return `
        <li class="${task.completed ? 'done' : ''}">
            <label><input type="checkbox" data-action="complete" data-task="${task.id}" ${task.completed ? 'checked' : ''}>
            <span>${escapeHtml(task.name)}</span></label>
            ${timer}
            <button type="button" class="pl-icon-btn" data-action="unplan" data-task="${task.id}" title="Take out of this block"><i class="ti ti-x"></i></button>
        </li>`;
}

function blockRow(block) {
    const fixed = block.source === 'minijob';
    const minutes = toMinutes(block.end) - toMinutes(block.start);
    const now = dayData.is_today && toMinutes(block.start) <= nowMinutes() && nowMinutes() < toMinutes(block.end);
    const classes = ['pl-block', `cat-${block.category}`, block.done ? 'done' : '', now ? 'now' : '', fixed ? 'fixed' : ''];
    const tasks = block.tasks.length ? `<ul class="pl-tasks">${block.tasks.map(taskItem).join('')}</ul>` : '';
    const addTask = fixed ? '' : `
        <form class="pl-add-task" data-block="${block.id}" data-category="${block.category}">
            <input type="text" placeholder="+ Add a task to this block" aria-label="Add task to ${escapeHtml(block.title)}">
        </form>`;
    const actions = fixed ? '' : `
        <button type="button" class="pl-icon-btn pl-done-btn" data-action="done" title="${block.done ? 'Mark not done' : 'Mark done'}">
            <i class="ti ti-${block.done ? 'circle-check-filled' : 'circle-check'}"></i></button>
        <button type="button" class="pl-icon-btn" data-action="edit" title="Edit for this day"><i class="ti ti-pencil"></i></button>
        <button type="button" class="pl-icon-btn" data-action="delete" title="Remove from this day"><i class="ti ti-trash"></i></button>`;
    return `
        <li class="${classes.join(' ')}" data-id="${escapeHtml(block.id)}">
            <div class="pl-time">${block.start}<span>${block.end}</span></div>
            <div class="pl-body">
                <div class="pl-title-row">
                    <span class="pl-cat">${CATEGORIES[block.category] || block.category}</span>
                    <strong>${escapeHtml(block.title)}</strong>
                    ${now ? '<span class="pl-badge pl-badge-now">now</span>' : ''}
                    ${blockBadges(block)}
                    <span class="pl-dur">${fmtDuration(minutes)}</span>
                </div>
                ${tasks}
                ${addTask}
            </div>
            <div class="pl-actions">${actions}</div>
        </li>`;
}

function editRow(block) {
    return `
        <li class="pl-block pl-editing cat-${block.category}" data-id="${escapeHtml(block.id)}">
            <form class="pl-edit-form">
                <input name="start" value="${block.start}" aria-label="Start" placeholder="08:00">
                <span>–</span>
                <input name="end" value="${block.end}" aria-label="End" placeholder="09:30">
                <input name="title" class="pl-edit-title" value="${escapeHtml(block.title)}" aria-label="Title" placeholder="What will you do?">
                <select name="category" aria-label="Type">${categoryOptions(block.category)}</select>
                <button type="submit" class="mj-btn mj-btn-primary">Save</button>
                <button type="button" class="mj-btn" data-action="cancel">Cancel</button>
            </form>
        </li>`;
}

function setGoal(id, done, planned, target) {
    const goal = target || planned;
    document.getElementById(id).textContent = `${fmtDuration(done)} / ${fmtDuration(goal)}`;
    document.getElementById(`${id}Bar`).style.width = `${goal ? Math.min(done / goal * 100, 100) : 0}%`;
}

function renderDay(data) {
    dayData = data;
    document.getElementById('subtitle').textContent = data.label + (data.is_today ? ' · today' : '');

    let notice = '';
    if (data.overridden) notice = 'Edited for this day.';
    else if (data.has_work) notice = 'Work day: blocks were fitted around your shift.';
    document.getElementById('dayNotice').textContent = notice;
    document.getElementById('resetDay').hidden = !data.overridden;

    const missedBox = document.getElementById('missedBox');
    missedBox.hidden = !data.missed.length;
    missedBox.innerHTML = data.missed.length
        ? `<i class="ti ti-alert-triangle"></i> No free time left for: ${data.missed.map(m =>
            `<strong>${escapeHtml(m.title)}</strong> (${fmtDuration(m.minutes)})`).join(', ')}. Edit the day to make room, or catch up tomorrow.`
        : '';

    renderBlocks();

    const s = data.stats;
    setGoal('goalGerman', s.german.done, s.german.planned, data.german_target);
    setGoal('goalK8s', s.k8s.done, s.k8s.planned);
    setGoal('goalJobs', s.jobs.done, s.jobs.planned);
    document.getElementById('appCount').textContent = data.applications;
    document.getElementById('goalDay').textContent = `${s.goal_blocks_done} / ${s.goal_blocks}`;
    document.getElementById('goalDayBar').style.width = `${s.goal_blocks ? s.goal_blocks_done / s.goal_blocks * 100 : 0}%`;

    renderUnplanned();
}

function renderBlocks() {
    const blocks = [...dayData.blocks];
    let html = blocks.map(b => (b.id === editingId ? editRow(b) : blockRow(b))).join('');
    if (editingId === 'new') html += editRow(newBlockDefaults());
    if (!blocks.length && editingId !== 'new') html = '<li class="pl-empty">Nothing planned. Add a block or set up your routine.</li>';
    document.getElementById('blockList').innerHTML = html;
    document.querySelector('.pl-editing input[name="title"]')?.focus();
}

function newBlockDefaults() {
    // Start where the last block ends (or now, today), one hour long
    const editable = dayData.blocks.filter(b => b.source !== 'minijob');
    let start = editable.length ? toMinutes(editable.at(-1).end) : 8 * 60;
    if (dayData.is_today) start = Math.max(Math.ceil(nowMinutes() / 15) * 15, 0);
    start = Math.min(start, 23 * 60);
    const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return { id: 'new', start: fmt(start), end: fmt(Math.min(start + 60, 24 * 60)), title: '', category: 'other' };
}

function renderUnplanned() {
    const options = dayData.blocks
        .filter(b => b.source !== 'minijob')
        .map(b => `<option value="${escapeHtml(b.id)}">${b.start} ${escapeHtml(b.title)}</option>`).join('');
    const list = document.getElementById('unplannedList');
    if (!dayData.unplanned_tasks.length) {
        list.innerHTML = '<li class="pl-empty">No open tasks for this day.</li>';
        return;
    }
    list.innerHTML = dayData.unplanned_tasks.map(task => {
        let due = 'no due date';
        if (task.due_date && task.due_date < dayData.date) due = `overdue · ${task.due_date}`;
        else if (task.due_date) due = 'due this day';
        return `
        <li>
            <div><span>${escapeHtml(task.name)}</span><small class="${task.due_date && task.due_date < dayData.date ? 'overdue' : ''}">${due}</small></div>
            <select data-plan-task="${task.id}" aria-label="Plan ${escapeHtml(task.name)} into a block">
                <option value="">Plan into…</option>${options}
            </select>
        </li>`;
    }).join('');
}

// Editable blocks of the day as sent to the server (work/travel come from the Minijob tracker)
function editableBlocks() {
    return dayData.blocks
        .filter(b => b.source !== 'minijob')
        .map(({ id, start, end, title, category }) => ({ id, start, end, title, category }));
}

async function saveDayBlocks(blocks) {
    const data = await run(api(`/api/planner/day/${currentDay}/blocks`, {
        method: 'PUT',
        body: JSON.stringify({ blocks }),
    }));
    if (data) {
        editingId = null;
        renderDay(data);
    }
    return data;
}

document.getElementById('blockList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.tagName === 'INPUT') return;
    const li = btn.closest('li.pl-block');
    const id = li?.dataset.id;
    const action = btn.dataset.action;

    if (action === 'edit') {
        editingId = id;
        renderBlocks();
    } else if (action === 'cancel') {
        editingId = null;
        renderBlocks();
    } else if (action === 'delete') {
        const block = dayData.blocks.find(b => b.id === id);
        if (await saveDayBlocks(editableBlocks().filter(b => b.id !== id))) toast(`Removed "${block.title}" from this day`);
    } else if (action === 'done') {
        const block = dayData.blocks.find(b => b.id === id);
        const data = await run(api(`/api/planner/day/${currentDay}/done`, {
            method: 'PUT',
            body: JSON.stringify({ block_id: id, done: !block.done }),
        }));
        if (data) renderDay(data);
    } else if (action === 'timer') {
        if (await run(api(`/api/tasks/${btn.dataset.task}/timer/start`, { method: 'POST' }))) {
            toast('Timer started (see dashboard)');
            loadDay();
        }
    } else if (action === 'unplan') {
        const data = await run(api(`/api/planner/tasks/${btn.dataset.task}`, {
            method: 'PUT',
            body: JSON.stringify({ day: currentDay, block_id: null }),
        }));
        if (data) renderDay(data);
    }
});

document.getElementById('blockList').addEventListener('change', async e => {
    if (e.target.dataset.action !== 'complete') return;
    if (await run(api(`/api/tasks/${e.target.dataset.task}/complete`, { method: 'POST' }))) loadDay();
});

document.getElementById('blockList').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;

    if (form.classList.contains('pl-add-task')) {
        const input = form.querySelector('input');
        const name = input.value.trim();
        if (!name) return;
        const data = await run(api(`/api/planner/day/${currentDay}/tasks`, {
            method: 'POST',
            body: JSON.stringify({ name, block_id: form.dataset.block, category: form.dataset.category }),
        }));
        if (data) {
            renderDay(data);
            document.querySelector(`.pl-add-task[data-block="${CSS.escape(form.dataset.block)}"] input`)?.focus();
        }
        return;
    }

    if (form.classList.contains('pl-edit-form')) {
        const fields = form.elements; // not form.title: that is the form's own title attribute
        const start = normalizeTime(fields.start.value);
        const end = normalizeTime(fields.end.value);
        const title = fields.title.value.trim();
        if (!start || !end) return toast('Use times like 08:00', true);
        if (!title) return toast('Give the block a name', true);
        const id = form.closest('li').dataset.id;
        const edited = { id: id === 'new' ? '' : id, start, end, title, category: fields.category.value };
        const blocks = editableBlocks().filter(b => b.id !== id);
        blocks.push(edited);
        if (await saveDayBlocks(blocks)) toast('Saved for this day');
    }
});

document.getElementById('addBlock').addEventListener('click', () => {
    editingId = 'new';
    renderBlocks();
});

document.getElementById('resetDay').addEventListener('click', async () => {
    const data = await run(api(`/api/planner/day/${currentDay}/blocks`, { method: 'DELETE' }));
    if (data) {
        editingId = null;
        renderDay(data);
        toast('Back to your routine');
    }
});

document.getElementById('unplannedList').addEventListener('change', async e => {
    const select = e.target.closest('[data-plan-task]');
    if (!select?.value) return;
    const data = await run(api(`/api/planner/tasks/${select.dataset.planTask}`, {
        method: 'PUT',
        body: JSON.stringify({ day: currentDay, block_id: select.value }),
    }));
    if (data) renderDay(data);
});

document.querySelector('.pl-counter').addEventListener('click', async e => {
    const btn = e.target.closest('[data-apps]');
    if (!btn) return;
    const count = Math.max(0, dayData.applications + Number(btn.dataset.apps));
    const data = await run(api(`/api/planner/day/${currentDay}/applications`, {
        method: 'PUT',
        body: JSON.stringify({ count }),
    }));
    if (data) renderDay(data);
});

// Keep the "now" marker current
setInterval(() => {
    if (currentView === 'day' && dayData?.is_today && editingId === null) renderBlocks();
}, 60 * 1000);

// ---------- week view ----------

function doneOfPlanned(stat) {
    if (!stat.planned) return '<span class="pl-muted">–</span>';
    const cls = stat.done >= stat.planned ? 'pl-full' : '';
    return `<span class="${cls}">${fmtDuration(stat.done)}</span> <span class="pl-muted">/ ${fmtDuration(stat.planned)}</span>`;
}

async function loadWeek() {
    const data = await run(api(`/api/planner/week/${currentDay}`));
    if (!data) return;
    const t = data.totals;
    const from = new Date(`${data.from}T00:00`).toLocaleDateString('en', { day: 'numeric', month: 'short' });
    const to = new Date(`${data.to}T00:00`).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
    document.getElementById('subtitle').textContent = `Week ${from} – ${to}`;

    document.getElementById('wkGerman').textContent = `${fmtHours(t.german.done)} / ${fmtHours(data.german_target)}`;
    document.getElementById('wkK8s').textContent = `${fmtHours(t.k8s.done)} / ${fmtHours(t.k8s.planned)}`;
    document.getElementById('wkJobs').textContent = `${fmtHours(t.jobs.done)} / ${fmtHours(t.jobs.planned)}`;
    document.getElementById('wkApps').textContent = t.applications;
    document.getElementById('wkWork').textContent = fmtHours(t.work.planned);

    document.getElementById('weekBody').innerHTML = data.days.map(d => {
        const s = d.stats;
        const flags = [];
        if (d.overridden) flags.push('<span class="pl-badge">edited</span>');
        if (d.missed) flags.push(`<span class="pl-badge pl-badge-warn">${d.missed} didn't fit</span>`);
        const blocksDone = s.goal_blocks ? `${s.goal_blocks_done} / ${s.goal_blocks}` : '–';
        const classes = [d.is_today ? 'today' : '', d.is_past && s.goal_blocks && !s.goal_blocks_done ? 'pl-missed-day' : ''];
        return `
        <tr class="${classes.join(' ')}" data-date="${d.date}" title="Open ${d.weekday}">
            <td class="pl-week-day">${d.weekday} <span class="pl-muted">${d.date.slice(8)}.${d.date.slice(5, 7)}</span></td>
            <td>${s.work.planned ? fmtDuration(s.work.planned) : '<span class="pl-muted">–</span>'}</td>
            <td>${doneOfPlanned(s.german)}</td>
            <td>${doneOfPlanned(s.k8s)}</td>
            <td>${doneOfPlanned(s.jobs)}</td>
            <td>${d.applications || '<span class="pl-muted">0</span>'}</td>
            <td>${blocksDone}</td>
            <td>${flags.join(' ')}</td>
        </tr>`;
    }).join('');
}

document.getElementById('weekBody').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-date]');
    if (!tr) return;
    currentDay = tr.dataset.date;
    setView('day');
});

// ---------- routine view ----------

async function loadRoutine() {
    const data = await run(api('/api/planner/routine'));
    if (!data) return;
    routine = data.days;
    renderRoutine();
}

function renderRoutine() {
    document.getElementById('subtitle').textContent = 'Your normal week: edit it once, every day follows it';
    document.getElementById('weekdayTabs').innerHTML = WEEKDAYS.map((name, i) =>
        `<button type="button" data-weekday="${i}" class="${i === routineWeekday ? 'active' : ''}">${name}</button>`).join('');

    const blocks = routine[routineWeekday];
    document.getElementById('routineBody').innerHTML = blocks.map((b, i) => `
        <tr class="cat-${b.category}" data-index="${i}">
            <td><input data-field="start" value="${b.start}" aria-label="Start"></td>
            <td><input data-field="end" value="${b.end}" aria-label="End"></td>
            <td class="pl-routine-title"><input data-field="title" value="${escapeHtml(b.title)}" aria-label="Block"></td>
            <td><select data-field="category" aria-label="Type">${categoryOptions(b.category)}</select></td>
            <td class="pl-muted">${fmtDuration(Math.max(toMinutes(b.end) - toMinutes(b.start), 0))}</td>
            <td><button type="button" class="pl-icon-btn" data-action="remove" title="Remove"><i class="ti ti-trash"></i></button></td>
        </tr>`).join('');

    const totals = {};
    for (const b of blocks) totals[b.category] = (totals[b.category] || 0) + toMinutes(b.end) - toMinutes(b.start);
    document.getElementById('routineTotals').textContent = ['german', 'k8s', 'jobs']
        .map(c => `${CATEGORIES[c]}: ${fmtDuration(totals[c] || 0)}`).join(' · ');
}

async function saveRoutine(weekday, blocks) {
    const data = await run(api(`/api/planner/routine/${weekday}`, {
        method: 'PUT',
        body: JSON.stringify({ blocks }),
    }));
    if (data) routine = data.days;
    renderRoutine();
    return data;
}

document.getElementById('weekdayTabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-weekday]');
    if (!btn) return;
    routineWeekday = Number(btn.dataset.weekday);
    renderRoutine();
});

document.getElementById('routineBody').addEventListener('change', async e => {
    const field = e.target.dataset.field;
    if (!field) return;
    const index = Number(e.target.closest('tr').dataset.index);
    const blocks = routine[routineWeekday].map(b => ({ ...b }));
    let value = e.target.value;
    if (field === 'start' || field === 'end') {
        value = normalizeTime(value);
        if (!value) {
            e.target.classList.add('invalid');
            return toast('Use times like 08:00', true);
        }
    }
    blocks[index][field] = value;
    if (await saveRoutine(routineWeekday, blocks)) toast(`${WEEKDAYS[routineWeekday]} saved`);
});

document.getElementById('routineBody').addEventListener('click', async e => {
    if (!e.target.closest('[data-action="remove"]')) return;
    const index = Number(e.target.closest('tr').dataset.index);
    const blocks = routine[routineWeekday].filter((_, i) => i !== index);
    if (await saveRoutine(routineWeekday, blocks)) toast('Block removed');
});

document.getElementById('addRoutineRow').addEventListener('click', async () => {
    const blocks = routine[routineWeekday].map(b => ({ ...b }));
    const last = blocks.at(-1);
    const start = last ? Math.min(toMinutes(last.end), 23 * 60) : 8 * 60;
    const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    blocks.push({ id: '', start: fmt(start), end: fmt(Math.min(start + 60, 24 * 60)), title: 'New block', category: 'other' });
    if (await saveRoutine(routineWeekday, blocks)) {
        const inputs = document.querySelectorAll('#routineBody .pl-routine-title input');
        inputs[inputs.length - 1]?.select();
    }
});

async function copyRoutine(targets) {
    const blocks = routine[routineWeekday];
    for (const weekday of targets) {
        if (weekday !== routineWeekday && !(await saveRoutine(weekday, blocks))) return;
    }
    toast(`Copied ${WEEKDAYS[routineWeekday]} to ${targets.length === 7 ? 'all days' : 'Mon–Sat'}`);
}

document.getElementById('copyWeekdays').addEventListener('click', () => copyRoutine([0, 1, 2, 3, 4, 5]));
document.getElementById('copyAll').addEventListener('click', () => copyRoutine([0, 1, 2, 3, 4, 5, 6]));
document.getElementById('resetRoutine').addEventListener('click', async () => {
    const data = await run(api(`/api/planner/routine/${routineWeekday}`, { method: 'DELETE' }));
    if (data) {
        routine = data.days;
        renderRoutine();
        toast(`${WEEKDAYS[routineWeekday]} reset to the default plan`);
    }
});

// ---------- navigation ----------

function setView(view) {
    currentView = view;
    editingId = null;
    for (const name of ['day', 'week', 'routine']) {
        document.getElementById(`${name}View`).hidden = name !== view;
    }
    document.querySelectorAll('.mj-tabs[role="tablist"] button').forEach(btn => {
        const active = btn.dataset.view === view;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active);
    });
    document.getElementById('dateNav').hidden = view === 'routine';
    document.getElementById('datePicker').value = currentDay;
    history.replaceState(null, '', `?view=${view}&day=${currentDay}`);

    if (view === 'day') loadDay();
    else if (view === 'week') loadWeek();
    else loadRoutine();
}

function moveDate(days) {
    currentDay = addDays(currentDay, currentView === 'week' ? days * 7 : days);
    setView(currentView);
}

document.querySelector('.mj-tabs[role="tablist"]').addEventListener('click', e => {
    const btn = e.target.closest('button[data-view]');
    if (btn) setView(btn.dataset.view);
});
document.getElementById('prevDate').addEventListener('click', () => moveDate(-1));
document.getElementById('nextDate').addEventListener('click', () => moveDate(1));
document.getElementById('goToday').addEventListener('click', () => {
    currentDay = app.dataset.today;
    setView(currentView);
});
document.getElementById('datePicker').addEventListener('change', e => {
    if (!e.target.value) return;
    currentDay = e.target.value;
    setView(currentView);
});

setView(currentView);
