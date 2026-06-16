import {
    PROFILE_SELECT_ID,
    PROFILE_STATUS_ID,
    TASKS_PER_PAGE,
    CONNECTION_PROFILE_EVENTS,
    state,
} from '../lib/constants.js';

import { getContextSafely, getSettings, getStoryData, saveStoryData } from '../lib/data.js';
import { getConnectionManagerState, getSortedProfilesByGroup, showToast, injectSteeringPrompt, removeSteeringPrompt } from '../lib/services.js';
import { generateStorySteps, addMoreStorySteps, checkStepCompletion, resetStory, onAIMessage, onChatChanged } from '../lib/story-manager.js';
import { createSettingsPanel } from './panel.js';

// ==================== Status ====================

export function setStatus(text) {
    const el = document.getElementById(PROFILE_STATUS_ID);
    if (el) el.textContent = text;
}

// ==================== Profile Rendering ====================

export function renderConnectionProfileOptions(context, settings) {
    const select = document.getElementById(PROFILE_SELECT_ID);
    if (!select) return;

    const { available, isDisabled, profiles } = getConnectionManagerState(context);
    select.innerHTML = '';

    const def = document.createElement('option');
    def.value = '';
    def.textContent = 'Select a Connection Profile';
    select.append(def);

    if (!available) {
        select.disabled = true;
        setStatus(isDisabled ? 'Connection Manager is disabled.' : 'Connection Manager is unavailable.');
        return;
    }
    select.disabled = false;

    const savedExists = !settings.connectionProfileId || profiles.some(p => p.id === settings.connectionProfileId);
    if (!savedExists) {
        settings.connectionProfileId = '';
        context.saveSettingsDebounced?.();
    }

    const grouped = getSortedProfilesByGroup(context, profiles);
    for (const [label, groupProfiles] of grouped.entries()) {
        const group = document.createElement('optgroup');
        group.label = label;
        for (const profile of groupProfiles) {
            const opt = document.createElement('option');
            opt.value = profile.id;
            opt.textContent = profile.name;
            group.append(opt);
        }
        select.append(group);
    }

    select.value = settings.connectionProfileId || '';
    setStatus(profiles.length ? 'Used by Story Progress Extended only.' : 'No connection profiles found.');
}

// ==================== Goal Banner ====================

function renderGoalBanner(storyData) {
    const banner = document.getElementById('story_progress_extended_goal_banner');
    if (!banner) return;

    if (!storyData?.storyGoal || (!storyData.isActive && !storyData.storyComplete)) {
        banner.style.display = 'none';
        return;
    }

    banner.style.display = '';
    banner.innerHTML = '';

    const goalLabel = document.createElement('span');
    goalLabel.className = 'story-progress-extended__goal-banner-label';
    goalLabel.textContent = storyData.storyComplete ? 'Quest Achieved:' : 'Quest:';

    const goalText = document.createElement('span');
    goalText.className = 'story-progress-extended__goal-banner-text';
    goalText.textContent = storyData.storyGoal;

    banner.append(goalLabel, goalText);

    if (storyData.storyComplete) {
        banner.classList.add('story-progress-extended__goal-banner--complete');
    } else {
        banner.classList.remove('story-progress-extended__goal-banner--complete');
    }
}

// ==================== Task List Rendering ====================

function onTaskFieldEdit(event) {
    const context = getContextSafely();
    if (!context) return;
    const el = event.target;
    const index = parseInt(el.dataset.stepIndex, 10);
    const field = el.dataset.field;
    const storyData = getStoryData(context);
    if (!storyData?.storySteps?.[index]) return;
    storyData.storySteps[index][field] = el.value;
    context.saveMetadataDebounced?.();
}

function onDeleteStep(event) {
    const context = getContextSafely();
    if (!context) return;
    const index = parseInt(event.currentTarget.dataset.stepIndex, 10);
    const storyData = getStoryData(context);
    if (!storyData?.storySteps?.[index]) return;

    storyData.storySteps.splice(index, 1);
    storyData.stepsCompleted.splice(index, 1);

    if (storyData.storySteps.length === 0) {
        storyData.currentStepIndex = 0;
        storyData.storyComplete = false;
        storyData.isActive = false;
        removeSteeringPrompt();
    } else if (index < storyData.currentStepIndex) {
        storyData.currentStepIndex--;
    } else if (index === storyData.currentStepIndex) {
        if (storyData.currentStepIndex >= storyData.storySteps.length) {
            storyData.currentStepIndex = storyData.storySteps.length - 1;
        }
    }

    saveStoryData(context);
    refreshUI();
}

function renderTaskList(storyData) {
    const list = document.getElementById('story_progress_extended_steps_list');
    if (!list) return;
    list.innerHTML = '';

    if (!storyData?.storySteps?.length) {
        const empty = document.createElement('div');
        empty.className = 'story-progress-extended__empty';
        empty.textContent = "No quest objectives yet. Describe the character's quest and click \"Generate Tasks\".";
        list.append(empty);
        return;
    }

    let indices = storyData.storySteps.map((_, i) => i);
    if (state.showIncompleteOnly) {
        indices = indices.filter(i => !(storyData.stepsCompleted?.[i] || false));
        if (indices.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'story-progress-extended__empty';
            empty.textContent = 'All tasks completed!';
            list.append(empty);
            return;
        }
    }

    const totalTasks = indices.length;
    const totalPages = Math.ceil(totalTasks / TASKS_PER_PAGE);

    if (state.currentPage >= totalPages) state.currentPage = totalPages - 1;
    if (state.currentPage < 0) state.currentPage = 0;

    const startIdx = state.currentPage * TASKS_PER_PAGE;
    const endIdx = Math.min(startIdx + TASKS_PER_PAGE, totalTasks);

    for (let i = startIdx; i < endIdx; i++) {
        const index = indices[i];
        const task = storyData.storySteps[index];
        const isDone = storyData.stepsCompleted?.[index] || false;
        const isCurrent = index === storyData.currentStepIndex && !storyData.storyComplete;

        const card = document.createElement('div');
        card.className = 'story-progress-extended__step-card';
        if (isCurrent) card.classList.add('story-progress-extended__step-card--current');
        if (isDone) card.classList.add('story-progress-extended__step-card--completed');
        if (storyData.storyComplete) card.classList.add('story-progress-extended__step-card--story-done');

        const header = document.createElement('div');
        header.className = 'story-progress-extended__step-header';

        const number = document.createElement('span');
        number.className = 'story-progress-extended__step-number';
        if (isDone) {
            number.textContent = '\u2713';
            number.classList.add('story-progress-extended__step-number--done');
        } else {
            number.textContent = String(index + 1);
        }

        const label = document.createElement('span');
        label.className = 'story-progress-extended__step-label';
        if (isCurrent) {
            label.textContent = '\u25BA Current';
            label.classList.add('story-progress-extended__step-label--current');
        } else if (isDone) {
            label.textContent = 'Done';
        } else {
            label.textContent = 'Pending';
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'story-progress-extended__step-delete menu_button';
        deleteBtn.textContent = '\u2715';
        deleteBtn.title = 'Delete this task';
        deleteBtn.dataset.stepIndex = String(index);
        deleteBtn.addEventListener('click', onDeleteStep);

        header.append(number, label, deleteBtn);

        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'text_pole story-progress-extended__task-title';
        titleInput.value = task.title || '';
        titleInput.placeholder = 'Task title';
        titleInput.dataset.stepIndex = String(index);
        titleInput.dataset.field = 'title';
        if (!storyData.isActive && !storyData.storyComplete) titleInput.disabled = true;
        titleInput.addEventListener('change', onTaskFieldEdit);

        const descTextarea = document.createElement('textarea');
        descTextarea.className = 'text_pole story-progress-extended__task-desc';
        descTextarea.value = task.description || '';
        descTextarea.placeholder = 'Task description';
        descTextarea.rows = 2;
        descTextarea.dataset.stepIndex = String(index);
        descTextarea.dataset.field = 'description';
        if (!storyData.isActive && !storyData.storyComplete) descTextarea.disabled = true;
        descTextarea.addEventListener('change', onTaskFieldEdit);

        card.append(header, titleInput, descTextarea);
        list.append(card);
    }

    if (totalPages > 1) {
        const paginationRow = document.createElement('div');
        paginationRow.className = 'story-progress-extended__pagination';

        const prevBtn = document.createElement('button');
        prevBtn.className = 'menu_button story-progress-extended__pagination-btn';
        prevBtn.textContent = '\u25C0 Prev';
        prevBtn.disabled = state.currentPage <= 0;
        prevBtn.addEventListener('click', () => {
            state.currentPage--;
            renderTaskList(getStoryData(getContextSafely()));
        });

        const pageInfo = document.createElement('span');
        pageInfo.className = 'story-progress-extended__pagination-info';
        pageInfo.textContent = `Page ${state.currentPage + 1}/${totalPages}`;

        const nextBtn = document.createElement('button');
        nextBtn.className = 'menu_button story-progress-extended__pagination-btn';
        nextBtn.textContent = 'Next \u25B6';
        nextBtn.disabled = state.currentPage >= totalPages - 1;
        nextBtn.addEventListener('click', () => {
            state.currentPage++;
            renderTaskList(getStoryData(getContextSafely()));
        });

        paginationRow.append(prevBtn, pageInfo, nextBtn);
        list.append(paginationRow);
    }
}

// ==================== Progress UI ====================

export function updateProgressUI(storyData) {
    const fractionEl = document.getElementById('story_progress_extended_fraction');
    const barEl = document.getElementById('story_progress_extended_bar');
    const statusEl = document.getElementById('story_progress_extended_progress_status');

    renderGoalBanner(storyData);

    if (!storyData?.storySteps?.length) {
        if (fractionEl) fractionEl.textContent = '';
        if (barEl) barEl.style.width = '0%';
        if (statusEl) statusEl.textContent = '';
        renderTaskList(storyData);
        return;
    }

    const done = (storyData.stepsCompleted || []).filter(Boolean).length;
    const total = storyData.storySteps.length;
    const pct = Math.round((done / total) * 100);

    if (fractionEl) fractionEl.textContent = `${done}/${total}`;
    if (barEl) {
        barEl.style.width = `${pct}%`;
        barEl.classList.toggle('story-progress-extended__progress-bar--complete', storyData.storyComplete);
    }

    if (statusEl) {
        if (storyData.storyComplete) {
            statusEl.textContent = 'All tasks complete!';
            statusEl.classList.add('story-progress-extended__status--success');
        } else if (storyData.isActive) {
            const cur = storyData.storySteps[storyData.currentStepIndex];
            statusEl.textContent = `Active \u2014 Task ${storyData.currentStepIndex + 1}: ${cur?.title || 'Unknown'}`;
            statusEl.classList.remove('story-progress-extended__status--success');
        } else {
            statusEl.textContent = 'Inactive';
            statusEl.classList.remove('story-progress-extended__status--success');
        }
    }

    renderTaskList(storyData);
}

export function refreshUI() {
    const context = getContextSafely();
    if (!context) return;
    const settings = getSettings(context);
    const storyData = getStoryData(context);

    const el = (id) => document.getElementById(id);
    const enabledCb = el('story_progress_extended_enabled');
    if (enabledCb) enabledCb.checked = settings.enabled;
    const si = el('story_progress_extended_steps');
    if (si) si.value = settings.numberOfSteps;
    const ii = el('story_progress_extended_interval');
    if (ii) ii.value = settings.checkInterval;
    const ai = el('story_progress_extended_auto_inject');
    if (ai) ai.checked = settings.autoInject;
    const ma = el('story_progress_extended_max_attempts');
    if (ma) ma.value = settings.maxAttemptsPerTask || 10;
    const gt = el('story_progress_extended_goal');
    if (gt && storyData) gt.value = storyData.storyGoal || '';

    renderConnectionProfileOptions(context, settings);
    updateProgressUI(storyData);

    const gb = el('story_progress_extended_generate');
    const rb = el('story_progress_extended_reset');
    const checkBtn = el('story_progress_extended_check');
    const ab = el('story_progress_extended_add_more');
    if (gb) {
        gb.disabled = !settings.connectionProfileId || state.isGenerating;
        gb.textContent = state.isGenerating ? 'Generating...' : 'Generate Tasks';
    }
    if (rb) rb.disabled = (!storyData.storyGoal && !storyData.isActive) || state.isGenerating;
    if (checkBtn) {
        checkBtn.disabled = !storyData.isActive || storyData.storyComplete || state.isChecking;
        checkBtn.textContent = state.isChecking ? 'Checking...' : 'Check Now';
    }
    if (ab) {
        ab.style.display = storyData.isActive ? '' : 'none';
        ab.disabled = !storyData.isActive || state.isGenerating;
    }
    const sb = el('story_progress_extended_skip');
    if (sb) sb.disabled = !storyData.isActive || storyData.storyComplete || state.isGenerating || state.isChecking;
    const bb = el('story_progress_extended_back');
    if (bb) bb.disabled = !storyData || storyData.currentStepIndex <= 0;
    const fb = el('story_progress_extended_filter');
    if (fb) fb.textContent = state.showIncompleteOnly ? 'Show All' : 'Hide Completed';

    const spinnerEl = el('story_progress_extended_spinner');
    const spinnerTextEl = el('story_progress_extended_spinner_text');
    if (spinnerEl) {
        const busy = state.isGenerating || state.isChecking;
        spinnerEl.style.display = busy ? 'flex' : 'none';
        if (spinnerTextEl) {
            spinnerTextEl.textContent = state.isGenerating ? 'Generating tasks...' : state.isChecking ? 'Checking completion...' : 'Processing...';
        }
    }
}

// ==================== Click Handlers ====================

async function onGenerateClick() {
    const goalTextarea = document.getElementById('story_progress_extended_goal');
    const storyGoal = goalTextarea?.value?.trim();
    if (!storyGoal) { setStatus('Please describe the quest first.'); return; }
    if (state.isGenerating) return;

    state.isGenerating = true;
    refreshUI();

    try {
        const result = await generateStorySteps(storyGoal);
        if (result.success) {
            showToast('Tasks Generated', 'Tasks generated successfully!', 'success');
        } else {
            showToast('Error', result.error, 'error');
        }
    } catch (error) {
        showToast('Error', error.message, 'error');
    } finally {
        state.isGenerating = false;
        refreshUI();
    }
}

async function onCheckClick() {
    if (state.isChecking || state.isGenerating) return;

    state.isChecking = true;
    refreshUI();

    try {
        await checkStepCompletion();
    } catch (error) {
        setStatus(`Check error: ${error.message}`);
    } finally {
        state.isChecking = false;
        refreshUI();
    }
}

function onSkipClick() {
    const context = getContextSafely();
    if (!context) return;
    const settings = getSettings(context);
    const storyData = getStoryData(context);
    if (!storyData?.isActive || storyData.storyComplete) return;

    const task = storyData.storySteps[storyData.currentStepIndex];
    if (!task) return;

    storyData.stepsCompleted[storyData.currentStepIndex] = true;
    storyData.checkAttempts = 0;
    const next = storyData.currentStepIndex + 1;
    if (next >= storyData.storySteps.length) {
        storyData.storyComplete = true;
        storyData.isActive = false;
        removeSteeringPrompt();
        showToast('Quest Complete!', `"${storyData.storyGoal}" has been achieved. All ${storyData.storySteps.length} tasks finished.`, 'success');
    } else {
        storyData.currentStepIndex = next;
        if (settings.autoInject) injectSteeringPrompt(context, settings);
        const nextTask = storyData.storySteps[next];
        showToast('Skipped Task', `"${task.title}" skipped. Now: "${nextTask.title}"`, 'info');
    }

    storyData.lastCheckedMsgIndex = (context.chat || []).length;
    saveStoryData(context);
    refreshUI();
}

function onBackClick() {
    const context = getContextSafely();
    if (!context) return;
    const settings = getSettings(context);
    const storyData = getStoryData(context);
    if (!storyData) return;
    if (storyData.currentStepIndex <= 0) return;

    const prev = storyData.currentStepIndex - 1;
    storyData.currentStepIndex = prev;
    storyData.stepsCompleted[prev] = false;
    storyData.checkAttempts = 0;

    if (storyData.storyComplete) {
        storyData.storyComplete = false;
        storyData.isActive = true;
    }

    if (settings.autoInject) injectSteeringPrompt(context, settings);
    const task = storyData.storySteps[prev];
    showToast('Went Back', `Now on task: "${task?.title || prev + 1}"`, 'info');

    saveStoryData(context);
    refreshUI();
}

function showAddTasksPopup() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'story-progress-extended__modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'story-progress-extended__modal';

        const title = document.createElement('h3');
        title.textContent = 'Add More Tasks';
        title.style.margin = '0 0 0.8rem 0';
        title.style.fontSize = '1rem';

        const countLabel = document.createElement('label');
        countLabel.textContent = 'Number of tasks to add:';
        countLabel.style.display = 'block';
        countLabel.style.marginBottom = '0.3rem';
        countLabel.style.fontWeight = '600';
        countLabel.style.fontSize = '0.85rem';

        const countInput = document.createElement('input');
        countInput.type = 'number';
        countInput.min = '1';
        countInput.max = '20';
        countInput.value = '3';
        countInput.className = 'text_pole story-progress-extended__number-input';
        countInput.style.width = '100%';
        countInput.style.marginBottom = '0.8rem';

        const goalLabel = document.createElement('label');
        goalLabel.textContent = 'What should these tasks achieve? (optional):';
        goalLabel.style.display = 'block';
        goalLabel.style.marginBottom = '0.3rem';
        goalLabel.style.fontWeight = '600';
        goalLabel.style.fontSize = '0.85rem';

        const goalTextarea = document.createElement('textarea');
        goalTextarea.className = 'text_pole';
        goalTextarea.rows = 3;
        goalTextarea.style.width = '100%';
        goalTextarea.style.resize = 'vertical';
        goalTextarea.style.marginBottom = '1rem';
        goalTextarea.placeholder = 'e.g., introduce a rival faction, build tension...';

        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '0.5rem';
        btnRow.style.justifyContent = 'flex-end';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'menu_button';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(null); });

        const okBtn = document.createElement('button');
        okBtn.className = 'menu_button';
        okBtn.textContent = 'Generate';
        okBtn.style.backgroundColor = 'rgba(76, 175, 80, 0.3)';
        okBtn.style.borderColor = 'rgba(76, 175, 80, 0.5)';
        okBtn.addEventListener('click', () => {
            const count = parseInt(countInput.value, 10) || 3;
            const goal = goalTextarea.value.trim();
            overlay.remove();
            resolve({ count, goal });
        });

        btnRow.append(cancelBtn, okBtn);
        modal.append(title, countLabel, countInput, goalLabel, goalTextarea, btnRow);
        overlay.append(modal);
        document.body.append(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) { overlay.remove(); resolve(null); }
        });

        countInput.focus();
        countInput.select();
    });
}

async function onAddMoreClick() {
    if (state.isGenerating) return;

    const result = await showAddTasksPopup();
    if (!result) return;

    state.isGenerating = true;
    refreshUI();

    try {
        const res = await addMoreStorySteps(result.count, result.goal);
        if (res.success) {
            showToast('Tasks Added', `${result.count} more tasks added to the story.`, 'success');
        } else {
            showToast('Error', res.error, 'error');
        }
    } catch (error) {
        showToast('Error', error.message, 'error');
    } finally {
        state.isGenerating = false;
        refreshUI();
    }
}

function onResetClick() {
    resetStory();
    refreshUI();
    setStatus('Progress reset.');
}

function onFilterToggle() {
    state.showIncompleteOnly = !state.showIncompleteOnly;
    state.currentPage = 0;
    refreshUI();
}

// ==================== Event Binding ====================

function bindEvents(context, settings) {
    const bind = (id, event, handler) => {
        const el = document.getElementById(id);
        if (el && !el.dataset.speBound) {
            el.dataset.speBound = 'true';
            el.addEventListener(event, handler);
        }
    };

    bind('story_progress_extended_enabled', 'change', function () {
        settings.enabled = this.checked;
        context.saveSettingsDebounced?.();
        if (!settings.enabled) removeSteeringPrompt();
    });

    bind(PROFILE_SELECT_ID, 'change', function () {
        settings.connectionProfileId = this.value;
        context.saveSettingsDebounced?.();
        const gb = document.getElementById('story_progress_extended_generate');
        if (gb) gb.disabled = !settings.connectionProfileId;
    });

    bind('story_progress_extended_steps', 'change', function () {
        let v = parseInt(this.value, 10);
        if (isNaN(v) || v < 1) v = 1;
        if (v > 20) v = 20;
        this.value = v;
        settings.numberOfSteps = v;
        context.saveSettingsDebounced?.();
    });

    bind('story_progress_extended_interval', 'change', function () {
        let v = parseInt(this.value, 10);
        if (isNaN(v) || v < 1) v = 1;
        if (v > 20) v = 20;
        this.value = v;
        settings.checkInterval = v;
        context.saveSettingsDebounced?.();
    });

    bind('story_progress_extended_auto_inject', 'change', function () {
        settings.autoInject = this.checked;
        context.saveSettingsDebounced?.();
    });

    bind('story_progress_extended_generate', 'click', onGenerateClick);
    bind('story_progress_extended_add_more', 'click', onAddMoreClick);
    bind('story_progress_extended_reset', 'click', onResetClick);
    bind('story_progress_extended_check', 'click', onCheckClick);
    bind('story_progress_extended_skip', 'click', onSkipClick);
    bind('story_progress_extended_back', 'click', onBackClick);
    bind('story_progress_extended_filter', 'click', onFilterToggle);

    bind('story_progress_extended_goal', 'input', function () {
        const sd = getStoryData(context);
        if (sd) sd.storyGoal = this.value;
    });

    bind('story_progress_extended_max_attempts', 'change', function () {
        let v = parseInt(this.value, 10);
        if (isNaN(v) || v < 1) v = 1;
        if (v > 50) v = 50;
        this.value = v;
        settings.maxAttemptsPerTask = v;
        context.saveSettingsDebounced?.();
    });
}

function bindConnectionProfileEvents(context) {
    if (!context?.eventSource || !context?.eventTypes || state.profileEventsBound) return;
    for (const eventName of CONNECTION_PROFILE_EVENTS) {
        const eventType = context.eventTypes[eventName];
        if (!eventType) continue;
        context.eventSource.on(eventType, () => refreshUI());
    }
    state.profileEventsBound = true;
}

export function initUI(context, settings) {
    if (!ensureSettingsPanel()) return false;
    bindEvents(context, settings);
    bindConnectionProfileEvents(context);
    refreshUI();
    return true;
}

export function bindChatEvents(context) {
    if (!context?.eventSource || !context?.eventTypes || state.chatEventsBound) return;

    const mr = context.eventTypes.CHARACTER_MESSAGE_RENDERED;
    if (mr) {
        context.eventSource.on(mr, () => {
            onAIMessage().catch(err => console.error('[StoryProgressExtended] Error:', err));
        });
    }

    const cc = context.eventTypes.CHAT_CHANGED;
    if (cc) {
        context.eventSource.on(cc, () => {
            onChatChanged();
            refreshUI();
        });
    }

    const ms = context.eventTypes.MESSAGE_SENT;
    if (ms) {
        context.eventSource.on(ms, () => {
            const ctx = getContextSafely();
            if (!ctx) return;
            const s = getSettings(ctx);
            const sd = getStoryData(ctx);
            if (sd?.isActive && !sd.storyComplete && s.autoInject) {
                injectSteeringPrompt(ctx, s);
            }
        });
    }

    state.chatEventsBound = true;
}

// ==================== Panel Init ====================

function getSettingsContainer() {
    return document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
}

export function ensureSettingsPanel() {
    let panel = document.getElementById('story_progress_extended_settings');
    if (panel) return panel;
    const container = getSettingsContainer();
    if (!container) return null;
    panel = createSettingsPanel();
    container.append(panel);
    return panel;
}
