// Global state
let tasks = [];
let currentFilter = 'all';
let currentCategory = null;
let timerInterval = null;
let activeTaskId = null;
let deleteTaskId = null;
let mobileMenuOpen = false;
let isAdmin = window.isAdmin || false;
let currentUserId = window.currentUserId || 0;
let deleteUserId = null;
let users = [];
let hasValidationErrors = false; // Track validation state

// Initialize the dashboard
document.addEventListener('DOMContentLoaded', () => {
    updateGreeting();
    loadTasks();
    startTimerUpdate();
    
    // Load users if admin
    if (isAdmin) {
        loadUsers();
    }
});

// Update greeting based on time of day
function updateGreeting() {
    const hour = new Date().getHours();
    let greeting = 'Good morning';
    if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
    else if (hour >= 17) greeting = 'Good evening';
    
    document.getElementById('greeting').textContent = `${greeting}, admin`;
    
    const now = new Date();
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    document.getElementById('dateInfo').textContent = now.toLocaleDateString('en-US', options);
}

// Handle API errors (especially 401 unauthorized)
async function apiFetch(url, options = {}) {
    try {
        const response = await fetch(url, options);
        
        // Check for 401 Unauthorized
        if (response.status === 401) {
            // Session expired, redirect to login
            window.location.href = '/login';
            return null;
        }
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(error.error || 'Request failed');
        }
        
        return response.json();
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// Load tasks from API
async function loadTasks() {
    try {
        const data = await apiFetch('/api/tasks');
        if (data) {
            tasks = data;  // Update global tasks variable
            renderTasks();
            updateStats();
            updateTimerDisplay();
        }
    } catch (error) {
        console.error('Error loading tasks:', error);
    }
}

// Render task list
function renderTasks() {
    const taskList = document.getElementById('taskList');
    let filteredTasks = tasks;
    
    // Filter by status (all/active/completed)
    if (currentFilter === 'active') {
        filteredTasks = filteredTasks.filter(t => !t.completed);
    } else if (currentFilter === 'completed') {
        filteredTasks = filteredTasks.filter(t => t.completed);
    }
    
    // Filter by category
    if (currentCategory) {
        filteredTasks = filteredTasks.filter(t => t.category === currentCategory);
    }
    
    // Sort: active first, then by creation date (newest first)
    filteredTasks.sort((a, b) => {
        if (a.timer_active && !b.timer_active) return -1;
        if (!a.timer_active && b.timer_active) return 1;
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(b.created_at) - new Date(a.created_at);
    });
    
    if (filteredTasks.length === 0) {
        let emptyMessage = 'No tasks yet. Create your first task!';
        if (currentFilter === 'active') emptyMessage = 'No active tasks. Great job!';
        else if (currentFilter === 'completed') emptyMessage = 'No completed tasks yet.';
        else if (currentCategory) {
            const categoryLabel = currentCategory.charAt(0).toUpperCase() + currentCategory.slice(1);
            emptyMessage = `No tasks in ${categoryLabel} category.`;
        }
        
        taskList.innerHTML = `
            <div class="empty-state">
                <i class="ti ti-circle-check"></i>
                <p>${emptyMessage}</p>
            </div>
        `;
        document.getElementById('taskCount').textContent = '0 tasks';
        return;
    }
    
    taskList.innerHTML = filteredTasks.map(task => {
        const categoryClass = task.category || 'general';
        const categoryLabel = getCategoryLabel(task.category);
        const isCompleted = task.completed;
        const isActive = task.timer_active;
        const isPaused = task.timer_paused;
        
        // Format time consistently as HH:MM:SS
        let timeDisplay = '';
        if (isCompleted) {
            timeDisplay = `<i class="ti ti-clock"></i> ${formatTime(task.total_time || 0)}`;
        } else if (isActive) {
            // Don't set static time here, let startTimerUpdate handle it live
            timeDisplay = `<i class="ti ti-player-play" style="color:#534AB7"></i> 00:00:00`;
        } else if (isPaused) {
            timeDisplay = `<i class="ti ti-player-pause" style="color:#BA7517"></i> ${formatTime(task.accumulated_time || 0)}`;
        } else {
            const totalMinutes = Math.floor((task.total_time || 0) / 60);
            timeDisplay = totalMinutes > 0 ? `<i class="ti ti-clock"></i> ${formatTime(task.total_time || 0)}` : '';
        }
        
        // Check if overdue
        let overdueClass = '';
        if (!isCompleted && task.due_date) {
            const dueDate = new Date(task.due_date);
            if (dueDate < new Date()) {
                overdueClass = ' style="color:#A32D2D"';
                timeDisplay = `<i class="ti ti-alert-triangle" style="color:#A32D2D;font-size:13px"></i> Overdue`;
            }
        }
        
        // Description display (truncate if too long)
        let descriptionHtml = '';
        if (task.description && task.description.trim()) {
            const desc = task.description.trim();
            const displayDesc = desc.length > 60 ? desc.substring(0, 60) + '...' : desc;
            descriptionHtml = `<div class="t-desc">${escapeHtml(displayDesc)}</div>`;
        }
        
        return `
            <div class="task-item" data-task-id="${task.id}">
                <div class="chk ${isCompleted ? 'done' : ''}" onclick="toggleComplete(${task.id})">
                    ${isCompleted ? '<i class="ti ti-check"></i>' : ''}
                </div>
                <div class="task-info">
                    <div class="t-name ${isCompleted ? 'done' : ''}">${escapeHtml(task.name)}</div>
                    ${descriptionHtml}
                    <div class="t-meta">
                        <span class="tag ${categoryClass}">${categoryLabel}</span>
                        ${task.due_date ? `<span class="tag general">${formatDate(task.due_date)}</span>` : ''}
                    </div>
                </div>
                ${!isCompleted ? `
                    <div class="task-time${overdueClass}">${timeDisplay}</div>
                    <div class="task-actions">
                        ${!isActive && !isPaused ? `<i class="ti ti-player-play" onclick="startTimer(${task.id})" title="Start timer"></i>` : ''}
                        ${isPaused ? `<i class="ti ti-player-play" onclick="resumeTimer(${task.id})" title="Resume timer"></i>` : ''}
                        <i class="ti ti-edit" onclick="showEditModal(${task.id})" title="Edit"></i>
                        <i class="ti ti-trash" onclick="showDeleteModal(${task.id})" title="Delete"></i>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
    
    document.getElementById('taskCount').textContent = `${filteredTasks.length} task${filteredTasks.length !== 1 ? 's' : ''}`;
    
    // Update active timer
    const activeTask = tasks.find(t => t.timer_active);
    const pausedTask = tasks.find(t => t.timer_paused);
    
    if (activeTask) {
        activeTaskId = activeTask.id;
        document.getElementById('timerTask').textContent = activeTask.name;
        document.getElementById('pauseBtn').disabled = false;
        document.getElementById('pauseBtn').innerHTML = '<i class="ti ti-player-pause" style="font-size:13px"></i> Pause';
        document.getElementById('stopBtn').disabled = false;
    } else if (pausedTask) {
        activeTaskId = pausedTask.id;
        document.getElementById('timerTask').textContent = pausedTask.name + ' (paused)';
        document.getElementById('pauseBtn').disabled = false;
        document.getElementById('pauseBtn').innerHTML = '<i class="ti ti-player-play" style="font-size:13px"></i> Resume';
        document.getElementById('stopBtn').disabled = false;
    } else {
        activeTaskId = null;
        document.getElementById('timerTask').textContent = 'No active task';
        document.getElementById('pauseBtn').disabled = true;
        document.getElementById('pauseBtn').innerHTML = '<i class="ti ti-player-pause" style="font-size:13px"></i> Pause';
        document.getElementById('stopBtn').disabled = true;
    }
}

// Get category label
function getCategoryLabel(category) {
    const labels = {
        'general': 'General',
        'design': 'Design',
        'dev': 'Development',
        'review': 'Review',
        'bug': 'Bug Fix'
    };
    return labels[category] || category.charAt(0).toUpperCase() + category.slice(1);
}

// Format time as HH:MM:SS
function formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Format date for display
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Update stats
function updateStats() {
    const totalTasks = tasks.length;
    const completedToday = tasks.filter(t => {
        if (!t.completed || !t.completed_at) return false;
        const completedDate = new Date(t.completed_at).toDateString();
        const today = new Date().toDateString();
        return completedDate === today;
    }).length;
    
    // In progress = all non-completed tasks (consistent with label "in progress")
    const inProgress = tasks.filter(t => !t.completed).length;
    const overdue = tasks.filter(t => {
        if (t.completed || !t.due_date) return false;
        return new Date(t.due_date) < new Date();
    }).length;
    
    // Calculate total time including active timer
    let totalTime = tasks.reduce((sum, t) => sum + (t.total_time || 0), 0);
    const activeTask = tasks.find(t => t.timer_active);
    if (activeTask && activeTask.timer_start) {
        const start = new Date(activeTask.timer_start);
        const now = new Date();
        const diffSecs = Math.max(0, Math.floor((now - start) / 1000));
        // Add current elapsed time (accumulated + current session)
        totalTime = totalTime - (activeTask.accumulated_time || 0) + (activeTask.accumulated_time || 0) + diffSecs;
    }
    
    const hours = Math.floor(totalTime / 3600);
    const minutes = Math.floor((totalTime % 3600) / 60);
    
    document.getElementById('statTotal').textContent = totalTasks;
    document.getElementById('statInProgress').textContent = inProgress;
    document.getElementById('statCompleted').textContent = completedToday;
    document.getElementById('statTime').textContent = `${hours}h ${minutes}m`;
    document.getElementById('statOverdue').textContent = overdue;
    document.getElementById('overdueText').textContent = overdue > 0 ? 'Needs attention' : 'All on track';
}

// Timer update interval
function startTimerUpdate() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const activeTask = tasks.find(t => t.timer_active);
        if (activeTask && activeTask.timer_start) {
            const start = new Date(activeTask.timer_start);
            const now = new Date();
            const diffSecs = Math.max(0, Math.floor((now - start) / 1000));
            const elapsed = diffSecs + (activeTask.accumulated_time || 0);
            
            // Update sidebar timer
            const displayEl = document.getElementById('timerDisplay');
            if (displayEl) displayEl.textContent = formatTime(elapsed);
            
            // Update task list timer
            const taskEl = document.querySelector(`[data-task-id="${activeTask.id}"] .task-time`);
            if (taskEl) {
                taskEl.innerHTML = `<i class="ti ti-player-play" style="color:#534AB7"></i> ${formatTime(elapsed)}`;
            }
            
            // Update time tracked stat
            updateStats();
        }
    }, 1000); // Update every second
}

// Update timer display
function updateTimerDisplay() {
    const activeTask = tasks.find(t => t.timer_active);
    const pausedTask = tasks.find(t => t.timer_paused);
    
    if (activeTask) {
        const start = new Date(activeTask.timer_start);
        const elapsed = Math.floor((new Date() - start) / 1000) + (activeTask.accumulated_time || 0);
        document.getElementById('timerDisplay').textContent = formatTime(elapsed);
    } else if (pausedTask) {
        document.getElementById('timerDisplay').textContent = formatTime(pausedTask.accumulated_time || 0);
    } else {
        document.getElementById('timerDisplay').textContent = '00:00:00';
    }
}

// Mobile menu toggle
function toggleMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobileOverlay');
    mobileMenuOpen = !mobileMenuOpen;
    
    if (mobileMenuOpen) {
        sidebar.classList.add('mobile-open');
        overlay.classList.add('show');
    } else {
        sidebar.classList.remove('mobile-open');
        overlay.classList.remove('show');
    }
}

function closeMobileMenu() {
    if (mobileMenuOpen) {
        toggleMobileMenu();
    }
}

// Show new task modal
function showNewTaskModal() {
    document.getElementById('newTaskModal').classList.add('show');
    document.getElementById('taskName').focus();
    document.getElementById('taskNameError').style.display = 'none';
    hasValidationErrors = false;
}

// Show edit task modal
function showEditModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    document.getElementById('editTaskId').value = task.id;
    document.getElementById('editTaskName').value = task.name;
    document.getElementById('editTaskDescription').value = task.description || '';
    document.getElementById('editTaskCategory').value = task.category || 'general';
    document.getElementById('editTaskDueDate').value = task.due_date || '';
    document.getElementById('editTaskNameError').style.display = 'none';
    hasValidationErrors = false;
    
    document.getElementById('editTaskModal').classList.add('show');
    document.getElementById('editTaskName').focus();
}

// Show delete confirmation modal
function showDeleteModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    deleteTaskId = taskId;
    document.getElementById('deleteTaskName').textContent = task.name;
    document.getElementById('deleteTaskModal').classList.add('show');
}

// Close modal - with validation check
function closeModal(modalId) {
    // Don't close if there are validation errors
    if (hasValidationErrors) {
        return;
    }
    
    document.getElementById(modalId).classList.remove('show');
    if (modalId === 'newTaskModal') {
        document.getElementById('newTaskForm').reset();
        document.getElementById('taskNameError').style.display = 'none';
    } else if (modalId === 'editTaskModal') {
        document.getElementById('editTaskForm').reset();
        document.getElementById('editTaskNameError').style.display = 'none';
    }
    deleteTaskId = null;
    hasValidationErrors = false;
}

// Create new task
async function createTask(event) {
    event.preventDefault();
    
    const name = document.getElementById('taskName').value.trim();
    const description = document.getElementById('taskDescription').value.trim();
    const category = document.getElementById('taskCategory').value;
    const dueDate = document.getElementById('taskDueDate').value || null;
    
    // Validate
    if (!name) {
        document.getElementById('taskNameError').style.display = 'block';
        document.getElementById('taskName').focus();
        hasValidationErrors = true;
        return;
    }
    
    hasValidationErrors = false;
    document.getElementById('taskNameError').style.display = 'none';
    
    try {
        const newTask = await apiFetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, category, due_date: dueDate })
        });
        
        if (newTask) {
            // Reload tasks from server to ensure consistency
            await loadTasks();
            closeModal('newTaskModal');
            addActivity('New task created', name);
        }
    } catch (error) {
        console.error('Error creating task:', error);
        if (error.message) {
            document.getElementById('taskNameError').textContent = error.message;
            document.getElementById('taskNameError').style.display = 'block';
            hasValidationErrors = true;
        }
    }
}

// Save edit task
async function saveEditTask(event) {
    event.preventDefault();
    
    const taskId = parseInt(document.getElementById('editTaskId').value);
    const name = document.getElementById('editTaskName').value.trim();
    const description = document.getElementById('editTaskDescription').value.trim();
    const category = document.getElementById('editTaskCategory').value;
    const dueDate = document.getElementById('editTaskDueDate').value || null;
    
    // Validate
    if (!name) {
        document.getElementById('editTaskNameError').style.display = 'block';
        document.getElementById('editTaskName').focus();
        hasValidationErrors = true;
        return;
    }
    
    hasValidationErrors = false;
    document.getElementById('editTaskNameError').style.display = 'none';
    
    try {
        const updatedTask = await apiFetch(`/api/tasks/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, category, due_date: dueDate })
        });
        
        if (updatedTask) {
            // Reload tasks from server
            await loadTasks();
            closeModal('editTaskModal');
            addActivity('Task updated', name);
        }
    } catch (error) {
        console.error('Error updating task:', error);
        if (error.message) {
            document.getElementById('editTaskNameError').textContent = error.message;
            document.getElementById('editTaskNameError').style.display = 'block';
            hasValidationErrors = true;
        }
    }
}

// Confirm delete task
async function confirmDeleteTask() {
    if (!deleteTaskId) return;
    
    const taskName = tasks.find(t => t.id === deleteTaskId)?.name || 'Task';
    
    try {
        const result = await apiFetch(`/api/tasks/${deleteTaskId}/delete`, { method: 'DELETE' });
        
        if (result && result.success) {
            // Reload tasks from server
            await loadTasks();
            closeModal('deleteTaskModal');
            addActivity('Task deleted', taskName);
        }
    } catch (error) {
        console.error('Error deleting task:', error);
    }
}

// Toggle task completion
async function toggleComplete(taskId) {
    try {
        const updatedTask = await apiFetch(`/api/tasks/${taskId}/complete`, { method: 'POST' });
        
        if (updatedTask) {
            // Reload tasks from server
            await loadTasks();
            
            const action = updatedTask.completed ? 'completed' : 'reopened';
            addActivity(`Task ${action}`, updatedTask.name);
        }
    } catch (error) {
        console.error('Error toggling task:', error);
    }
}

// Start timer for a task
async function startTimer(taskId) {
    try {
        const updatedTask = await apiFetch(`/api/tasks/${taskId}/timer/start`, { method: 'POST' });
        
        if (updatedTask) {
            // Reload tasks from server
            await loadTasks();
            addActivity('Timer started', updatedTask.name);
        }
    } catch (error) {
        console.error('Error starting timer:', error);
    }
}

// Resume timer (from paused state)
async function resumeTimer(taskId) {
    await startTimer(taskId);
}

// Toggle pause/resume
async function toggleTimer() {
    if (!activeTaskId) return;
    
    const activeTask = tasks.find(t => t.id === activeTaskId);
    
    if (activeTask && activeTask.timer_active) {
        // Pause
        await pauseTimer();
    } else if (activeTask && activeTask.timer_paused) {
        // Resume
        await startTimer(activeTaskId);
    }
}

// Pause timer
async function pauseTimer() {
    if (!activeTaskId) return;
    
    try {
        const updatedTask = await apiFetch(`/api/tasks/${activeTaskId}/timer/pause`, { method: 'POST' });
        
        if (updatedTask) {
            // Reload tasks from server
            await loadTasks();
            addActivity('Timer paused', updatedTask.name);
        }
    } catch (error) {
        console.error('Error pausing timer:', error);
    }
}

// Stop timer
async function stopTimer() {
    if (!activeTaskId) return;
    
    try {
        const updatedTask = await apiFetch(`/api/tasks/${activeTaskId}/timer/stop`, { method: 'POST' });
        
        if (updatedTask) {
            // Reload tasks from server
            await loadTasks();
            activeTaskId = null;
            addActivity('Timer stopped', updatedTask.name);
        }
    } catch (error) {
        console.error('Error stopping timer:', error);
    }
}

// Set filter (from filter pills)
function setFilter(filter, element) {
    currentFilter = filter;
    currentCategory = null;
    
    // Update active pill
    document.querySelectorAll('.filter-pill').forEach(pill => pill.classList.remove('active'));
    if (element) element.classList.add('active');
    
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Highlight the appropriate nav item
    const navItems = document.querySelectorAll('#navSection .nav-item');
    if (filter === 'all') {
        if (navItems[0]) navItems[0].classList.add('active'); // Dashboard
    } else if (filter === 'active') {
        if (navItems[2]) navItems[2].classList.add('active'); // Active
    } else if (filter === 'completed') {
        if (navItems[3]) navItems[3].classList.add('active'); // Completed
    }
    
    renderTasks();
    closeMobileMenu();
}

// Filter by category
function filterByCategory(category) {
    currentCategory = category;
    currentFilter = 'all';
    
    // Reset filter pills
    document.querySelectorAll('.filter-pill').forEach(pill => pill.classList.remove('active'));
    document.querySelector('.filter-pill').classList.add('active');
    
    // Update nav items - remove active from workspace items
    document.querySelectorAll('#navSection .nav-item').forEach(item => item.classList.remove('active'));
    
    // Highlight the selected category
    document.querySelectorAll('#categorySection .nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.onclick && item.onclick.toString().includes(`'${category}'`)) {
            item.classList.add('active');
        }
    });
    
    renderTasks();
    closeMobileMenu();
}

// Filter tasks (from sidebar)
function filterTasks(filter) {
    currentFilter = filter;
    currentCategory = null;
    
    // Reset category highlighting
    document.querySelectorAll('#categorySection .nav-item').forEach(item => item.classList.remove('active'));
    
    // Update filter pills
    document.querySelectorAll('.filter-pill').forEach(pill => {
        pill.classList.remove('active');
        const pillText = pill.textContent.toLowerCase();
        if ((filter === 'all' && pillText === 'all') ||
            (filter === 'active' && pillText === 'active') ||
            (filter === 'completed' && pillText === 'completed')) {
            pill.classList.add('active');
        }
    });
    
    // Update nav items
    document.querySelectorAll('#navSection .nav-item').forEach(item => item.classList.remove('active'));
    
    // Highlight the appropriate nav item
    const navItems = document.querySelectorAll('#navSection .nav-item');
    if (filter === 'all') {
        if (navItems[0]) navItems[0].classList.add('active'); // Dashboard
        if (navItems[1]) navItems[1].classList.add('active'); // All Tasks
    } else if (filter === 'active') {
        if (navItems[2]) navItems[2].classList.add('active'); // Active
    } else if (filter === 'completed') {
        if (navItems[3]) navItems[3].classList.add('active'); // Completed
    }
    
    renderTasks();
    closeMobileMenu();
}

// Add activity to feed
function addActivity(action, taskName) {
    const feed = document.getElementById('activityFeed');
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    
    const icons = {
        'created': { icon: 'ti ti-circle-plus', color: '#0F6E56', bg: '#E1F5EE' },
        'completed': { icon: 'ti ti-check', color: '#534AB7', bg: '#EEEDFE' },
        'reopened': { icon: 'ti ti-arrow-back', color: '#BA7517', bg: '#FAEEDA' },
        'deleted': { icon: 'ti ti-trash', color: '#A32D2D', bg: '#FCEBEB' },
        'started': { icon: 'ti ti-clock', color: '#534AB7', bg: '#EEEDFE' },
        'stopped': { icon: 'ti ti-square', color: '#534AB7', bg: '#EEEDFE' },
        'paused': { icon: 'ti ti-player-pause', color: '#BA7517', bg: '#FAEEDA' },
        'updated': { icon: 'ti ti-edit', color: '#BA7517', bg: '#FAEEDA' },
        'renamed': { icon: 'ti ti-edit', color: '#BA7517', bg: '#FAEEDA' }
    };
    
    let iconKey = 'created';
    if (action.includes('completed')) iconKey = 'completed';
    else if (action.includes('reopened')) iconKey = 'reopened';
    else if (action.includes('deleted')) iconKey = 'deleted';
    else if (action.includes('started')) iconKey = 'started';
    else if (action.includes('stopped')) iconKey = 'stopped';
    else if (action.includes('paused')) iconKey = 'paused';
    else if (action.includes('updated')) iconKey = 'updated';
    else if (action.includes('renamed')) iconKey = 'renamed';
    
    const iconConfig = icons[iconKey];
    
    const activityHtml = `
        <div class="activity-item">
            <div class="act-icon" style="background:${iconConfig.bg}">
                <i class="${iconConfig.icon}" style="color:${iconConfig.color}"></i>
            </div>
            <div>
                <div class="act-text">${action}: <b>${escapeHtml(taskName)}</b></div>
                <div class="act-time">${timeStr}</div>
            </div>
        </div>
    `;
    
    feed.insertAdjacentHTML('afterbegin', activityHtml);
    
    // Keep only last 5 activities
    while (feed.children.length > 5) {
        feed.removeChild(feed.lastChild);
    }
}

// Close modal on outside click
document.addEventListener('click', (e) => {
    if (e.target.id === 'newTaskModal') {
        closeModal('newTaskModal');
    } else if (e.target.id === 'editTaskModal') {
        closeModal('editTaskModal');
    } else if (e.target.id === 'deleteTaskModal') {
        closeModal('deleteTaskModal');
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Escape to close modals - but not if there are validation errors
    if (e.key === 'Escape') {
        if (!hasValidationErrors) {
            closeModal('newTaskModal');
            closeModal('editTaskModal');
            closeModal('deleteTaskModal');
            closeModal('createUserModal');
            closeModal('editUserModal');
            closeModal('changePasswordModal');
            closeModal('deleteUserModal');
        }
    }
    // Ctrl/Cmd + N to create new task
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        showNewTaskModal();
    }
});

// ==================== ADMIN FUNCTIONS ====================

// Load users list
async function loadUsers() {
    try {
        const data = await apiFetch('/api/users');
        if (data) {
            users = data;
            renderUsers();
        }
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

// Render users list
function renderUsers() {
    const userList = document.getElementById('adminUserList');
    if (!userList) return;
    
    if (users.length === 0) {
        userList.innerHTML = '<p class="text-muted">No users found.</p>';
        return;
    }
    
    userList.innerHTML = users.map(user => `
        <div class="user-item" style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #eee;">
            <div>
                <div style="font-weight: 500;">${escapeHtml(user.username)}</div>
                <div style="font-size: 12px; color: #666;">
                    ${user.is_admin ? '<span style="background: #EEEDFE; color: #534AB7; padding: 2px 6px; border-radius: 4px; font-size: 11px;">Admin</span>' : '<span style="color: #999;">User</span>'}
                    ${user.id === currentUserId ? ' • You' : ''}
                </div>
            </div>
            <div style="display: flex; gap: 5px;">
                <button onclick="showEditUserModal(${user.id})" style="background: none; border: none; cursor: pointer; color: #534AB7;" title="Edit">
                    <i class="ti ti-edit"></i>
                </button>
                <button onclick="showChangePasswordModal(${user.id})" style="background: none; border: none; cursor: pointer; color: #BA7517;" title="Change Password">
                    <i class="ti ti-key"></i>
                </button>
                ${user.id !== currentUserId ? `
                <button onclick="showDeleteUserModal(${user.id})" style="background: none; border: none; cursor: pointer; color: #A32D2D;" title="Delete">
                    <i class="ti ti-trash"></i>
                </button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

// Show create user modal
function showCreateUserModal() {
    document.getElementById('createUserModal').classList.add('show');
    document.getElementById('newUsername').focus();
    document.getElementById('newUsernameError').style.display = 'none';
    document.getElementById('newPasswordError').style.display = 'none';
}

// Create user
async function createUser(event) {
    event.preventDefault();
    
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;
    const isAdmin = document.getElementById('newIsAdmin').checked;
    
    // Validate
    if (!username) {
        document.getElementById('newUsernameError').style.display = 'block';
        document.getElementById('newUsername').focus();
        return;
    }
    
    if (!password || password.length < 6) {
        document.getElementById('newPasswordError').style.display = 'block';
        document.getElementById('newPassword').focus();
        return;
    }
    
    document.getElementById('newUsernameError').style.display = 'none';
    document.getElementById('newPasswordError').style.display = 'none';
    
    try {
        const newUser = await apiFetch('/api/admin/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, is_admin: isAdmin })
        });
        
        if (newUser) {
            await loadUsers();
            closeModal('createUserModal');
            document.getElementById('createUserForm').reset();
            alert('User created successfully!');
        }
    } catch (error) {
        console.error('Error creating user:', error);
        if (error.message) {
            alert(error.message);
        }
    }
}

// Show edit user modal
function showEditUserModal(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    
    document.getElementById('editUserId').value = user.id;
    document.getElementById('editUsername').value = user.username;
    document.getElementById('editIsAdmin').checked = !!user.is_admin;
    document.getElementById('editUsernameError').style.display = 'none';
    
    document.getElementById('editUserModal').classList.add('show');
    document.getElementById('editUsername').focus();
}

// Update user
async function updateUser(event) {
    event.preventDefault();
    
    const userId = parseInt(document.getElementById('editUserId').value);
    const username = document.getElementById('editUsername').value.trim();
    const isAdmin = document.getElementById('editIsAdmin').checked;
    
    // Validate
    if (!username) {
        document.getElementById('editUsernameError').style.display = 'block';
        document.getElementById('editUsername').focus();
        return;
    }
    
    document.getElementById('editUsernameError').style.display = 'none';
    
    try {
        const updatedUser = await apiFetch(`/api/users/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, is_admin: isAdmin })
        });
        
        if (updatedUser) {
            await loadUsers();
            closeModal('editUserModal');
            alert('User updated successfully!');
        }
    } catch (error) {
        console.error('Error updating user:', error);
        if (error.message) {
            alert(error.message);
        }
    }
}

// Show change password modal
function showChangePasswordModal(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    
    document.getElementById('changePasswordUserId').value = user.id;
    document.getElementById('changePasswordUsername').textContent = user.username;
    document.getElementById('newUserPasswordError').style.display = 'none';
    
    document.getElementById('changePasswordModal').classList.add('show');
    document.getElementById('newUserPassword').focus();
}

// Change user password
async function changeUserPassword(event) {
    event.preventDefault();
    
    const userId = parseInt(document.getElementById('changePasswordUserId').value);
    const password = document.getElementById('newUserPassword').value;
    
    // Validate
    if (!password || password.length < 6) {
        document.getElementById('newUserPasswordError').style.display = 'block';
        document.getElementById('newUserPassword').focus();
        return;
    }
    
    document.getElementById('newUserPasswordError').style.display = 'none';
    
    try {
        const result = await apiFetch(`/api/users/${userId}/password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        
        if (result && result.success) {
            closeModal('changePasswordModal');
            document.getElementById('changePasswordForm').reset();
            alert('Password changed successfully!');
        }
    } catch (error) {
        console.error('Error changing password:', error);
        if (error.message) {
            alert(error.message);
        }
    }
}

// Show delete user modal
function showDeleteUserModal(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    
    deleteUserId = userId;
    document.getElementById('deleteUsername').textContent = user.username;
    document.getElementById('deleteUserModal').classList.add('show');
}

// Confirm delete user
async function confirmDeleteUser() {
    if (!deleteUserId) return;
    
    try {
        const result = await apiFetch(`/api/users/${deleteUserId}`, { method: 'DELETE' });
        
        if (result && result.success) {
            await loadUsers();
            closeModal('deleteUserModal');
            alert('User deleted successfully!');
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        if (error.message) {
            alert(error.message);
        }
    }
}
