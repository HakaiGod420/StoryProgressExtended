import { MODULE_NAME, defaultSettings, getSettings, getStoryData, generateStorySteps, checkStepCompletion, resetStory } from './story-manager.js';
import { removeSteeringPrompt } from './prompt-injector.js';

const SETTINGS_PANEL_ID = 'story_progress_extended_settings';
const PROFILE_SELECT_ID = 'story_progress_extended_connection_profile';
const PROFILE_STATUS_ID = 'story_progress_extended_profile_status';

function getContextSafely() {
    if (!globalThis.SillyTavern || typeof globalThis.SillyTavern.getContext !== 'function') {
        return null;
    }
    return globalThis.SillyTavern.getContext();
}

function getConnectionManagerState(context) {
    const extensionSettings = context?.extensionSettings;
    const connectionManager = extensionSettings?.connectionManager;
    const disabledExtensions = extensionSettings?.disabledExtensions;
    const isDisabled = Array.isArray(disabledExtensions) && disabledExtensions.includes('connection-manager');
    const profiles = Array.isArray(connectionManager?.profiles) ? connectionManager.profiles : [];

    return {
        available: Boolean(connectionManager) && !isDisabled,
        isDisabled,
        profiles,
    };
}

function getProfileGroupLabel(context, profile) {
    const apiMap = context?.CONNECT_API_MAP?.[profile?.api];

    if (apiMap?.selected === 'openai') {
        return 'Chat Completion';
    }

    if (apiMap?.selected === 'textgenerationwebui') {
        return 'Text Completion';
    }

    return 'Other Profiles';
}

function getSortedProfilesByGroup(context, profiles) {
    const groups = new Map();

    for (const profile of profiles) {
        if (!profile?.id || !profile?.name) {
            continue;
        }

        const label = getProfileGroupLabel(context, profile);
        const groupProfiles = groups.get(label) ?? [];
        groupProfiles.push(profile);
        groups.set(label, groupProfiles);
    }

    for (const groupProfiles of groups.values()) {
        groupProfiles.sort((a, b) => a.name.localeCompare(b.name));
    }

    return groups;
}

function renderConnectionProfileOptions(context, settings) {
    const select = document.getElementById(PROFILE_SELECT_ID);
    if (!select) {
        return;
    }

    const { available, isDisabled, profiles } = getConnectionManagerState(context);

    select.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Select a Connection Profile';
    select.append(defaultOption);

    if (!available) {
        select.disabled = true;
        setStatus(isDisabled ? 'Connection Manager is disabled.' : 'Connection Manager is unavailable.');
        return;
    }

    select.disabled = false;

    const savedProfileExists = !settings.connectionProfileId || profiles.some(profile => profile.id === settings.connectionProfileId);
    if (!savedProfileExists) {
        settings.connectionProfileId = '';
        context.saveSettingsDebounced?.();
    }

    const groupedProfiles = getSortedProfilesByGroup(context, profiles);
    for (const [label, groupProfiles] of groupedProfiles.entries()) {
        const group = document.createElement('optgroup');
        group.label = label;

        for (const profile of groupProfiles) {
            const option = document.createElement('option');
            option.value = profile.id;
            option.textContent = profile.name;
            group.append(option);
        }

        select.append(group);
    }

    select.value = settings.connectionProfileId || '';
    setStatus(profiles.length ? 'Used by Story Progress Extended only.' : 'No connection profiles found.');
}

function setStatus(text) {
    const status = document.getElementById(PROFILE_STATUS_ID);
    if (status) {
        status.textContent = text;
    }
}

function createSettingsPanel() {
    const wrapper = document.createElement('div');
    wrapper.id = SETTINGS_PANEL_ID;
    wrapper.className = 'story-progress-extended';

    const drawer = document.createElement('div');
    drawer.className = 'inline-drawer';

    const toggle = document.createElement('div');
    toggle.className = 'inline-drawer-toggle inline-drawer-header';

    const title = document.createElement('b');
    title.textContent = 'Story Progress Extended';

    const icon = document.createElement('div');
    icon.className = 'inline-drawer-icon fa-solid fa-circle-chevron-down down';

    toggle.append(title, icon);

    const content = document.createElement('div');
    content.className = 'inline-drawer-content';

    content.append(
        createEnableRow(),
        createProfileRow(),
        createSettingsRows(),
        createDivider(),
        createStoryGoalSection(),
        createProgressSection(),
    );

    drawer.append(toggle, content);
    wrapper.append(drawer);

    return wrapper;
}

function createEnableRow() {
    const row = document.createElement('div');
    row.className = 'story-progress-extended__row story-progress-extended__row--setting';

    const label = document.createElement('label');
    label.htmlFor = 'story_progress_extended_enabled';
    label.textContent = 'Enabled';

    const checkbox = document.createElement('input');
    checkbox.id = 'story_progress_extended_enabled';
    checkbox.type = 'checkbox';
    checkbox.className = 'story-progress-extended__checkbox';

    row.append(label, checkbox);
    return row;
}

function createProfileRow() {
    const row = document.createElement('div');
    row.className = 'story-progress-extended__row story-progress-extended__row--setting';

    const label = document.createElement('label');
    label.htmlFor = PROFILE_SELECT_ID;
    label.textContent = 'Connection Profile';

    const select = document.createElement('select');
    select.id = PROFILE_SELECT_ID;
    select.className = 'text_pole story-progress-extended__select';

    row.append(label, select);

    const status = document.createElement('small');
    status.id = PROFILE_STATUS_ID;
    status.className = 'story-progress-extended__status';

    const wrapper = document.createElement('div');
    wrapper.append(row, status);
    return wrapper;
}

function createSettingsRows() {
    const container = document.createElement('div');
    container.className = 'story-progress-extended__settings-group';

    const stepsRow = document.createElement('div');
    stepsRow.className = 'story-progress-extended__row story-progress-extended__row--setting';

    const stepsLabel = document.createElement('label');
    stepsLabel.htmlFor = 'story_progress_extended_steps';
    stepsLabel.textContent = 'Number of Steps';

    const stepsInput = document.createElement('input');
    stepsInput.id = 'story_progress_extended_steps';
    stepsInput.type = 'number';
    stepsInput.min = '1';
    stepsInput.max = '20';
    stepsInput.value = '5';
    stepsInput.className = 'text_pole story-progress-extended__number-input';

    stepsRow.append(stepsLabel, stepsInput);

    const intervalRow = document.createElement('div');
    intervalRow.className = 'story-progress-extended__row story-progress-extended__row--setting';

    const intervalLabel = document.createElement('label');
    intervalLabel.htmlFor = 'story_progress_extended_interval';
    intervalLabel.textContent = 'Check Interval';

    const intervalInput = document.createElement('input');
    intervalInput.id = 'story_progress_extended_interval';
    intervalInput.type = 'number';
    intervalInput.min = '1';
    intervalInput.max = '20';
    intervalInput.value = '5';
    intervalInput.className = 'text_pole story-progress-extended__number-input';

    const intervalHint = document.createElement('small');
    intervalHint.className = 'story-progress-extended__hint';
    intervalHint.textContent = 'AI messages between checks';

    intervalRow.append(intervalLabel, intervalInput, intervalHint);

    const autoInjectRow = document.createElement('div');
    autoInjectRow.className = 'story-progress-extended__row story-progress-extended__row--setting';

    const autoInjectLabel = document.createElement('label');
    autoInjectLabel.htmlFor = 'story_progress_extended_auto_inject';
    autoInjectLabel.textContent = 'Auto-Inject Steering';

    const autoInjectCheckbox = document.createElement('input');
    autoInjectCheckbox.id = 'story_progress_extended_auto_inject';
    autoInjectCheckbox.type = 'checkbox';
    autoInjectCheckbox.className = 'story-progress-extended__checkbox';

    autoInjectRow.append(autoInjectLabel, autoInjectCheckbox);

    container.append(stepsRow, intervalRow, autoInjectRow);
    return container;
}

function createDivider() {
    const divider = document.createElement('hr');
    divider.className = 'story-progress-extended__divider';
    return divider;
}

function createStoryGoalSection() {
    const section = document.createElement('div');
    section.className = 'story-progress-extended__goal-section';

    const goalLabel = document.createElement('label');
    goalLabel.htmlFor = 'story_progress_extended_goal';
    goalLabel.textContent = 'Story Goal';
    goalLabel.className = 'story-progress-extended__goal-label';

    const goalTextarea = document.createElement('textarea');
    goalTextarea.id = 'story_progress_extended_goal';
    goalTextarea.className = 'text_pole story-progress-extended__goal-input';
    goalTextarea.placeholder = 'Describe the story goal you want the AI to progress toward...';
    goalTextarea.rows = 3;

    const buttonRow = document.createElement('div');
    buttonRow.className = 'story-progress-extended__button-row';

    const generateBtn = document.createElement('button');
    generateBtn.id = 'story_progress_extended_generate';
    generateBtn.className = 'menu_button story-progress-extended__btn story-progress-extended__btn--generate';
    generateBtn.textContent = 'Generate Story';
    generateBtn.title = 'Generate story steps from the goal above';

    const resetBtn = document.createElement('button');
    resetBtn.id = 'story_progress_extended_reset';
    resetBtn.className = 'menu_button story-progress-extended__btn story-progress-extended__btn--reset';
    resetBtn.textContent = 'Reset';
    resetBtn.title = 'Reset all story progress for this chat';

    buttonRow.append(generateBtn, resetBtn);

    section.append(goalLabel, goalTextarea, buttonRow);
    return section;
}

function createProgressSection() {
    const section = document.createElement('div');
    section.id = 'story_progress_extended_progress';
    section.className = 'story-progress-extended__progress';

    const progressHeader = document.createElement('div');
    progressHeader.className = 'story-progress-extended__progress-header';

    const progressTitle = document.createElement('b');
    progressTitle.textContent = 'Story Progress';

    const progressFraction = document.createElement('span');
    progressFraction.id = 'story_progress_extended_fraction';
    progressFraction.className = 'story-progress-extended__progress-fraction';

    progressHeader.append(progressTitle, progressFraction);

    const progressBarContainer = document.createElement('div');
    progressBarContainer.className = 'story-progress-extended__progress-bar-container';

    const progressBar = document.createElement('div');
    progressBar.id = 'story_progress_extended_bar';
    progressBar.className = 'story-progress-extended__progress-bar';
    progressBar.style.width = '0%';

    progressBarContainer.append(progressBar);

    const stepsList = document.createElement('div');
    stepsList.id = 'story_progress_extended_steps_list';
    stepsList.className = 'story-progress-extended__steps-list';

    const checkBtn = document.createElement('button');
    checkBtn.id = 'story_progress_extended_check';
    checkBtn.className = 'menu_button story-progress-extended__btn story-progress-extended__btn--check';
    checkBtn.textContent = 'Check Now';
    checkBtn.title = 'Force a completion check for the current step';

    const statusText = document.createElement('small');
    statusText.id = 'story_progress_extended_progress_status';
    statusText.className = 'story-progress-extended__status';

    section.append(progressHeader, progressBarContainer, stepsList, checkBtn, statusText);
    return section;
}

function renderStepList(storyData, settings) {
    const stepsList = document.getElementById('story_progress_extended_steps_list');
    if (!stepsList) {
        return;
    }

    stepsList.innerHTML = '';

    if (!storyData || !storyData.storySteps || storyData.storySteps.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'story-progress-extended__empty';
        emptyMsg.textContent = 'No story steps generated yet. Enter a story goal and click "Generate Story".';
        stepsList.append(emptyMsg);
        return;
    }

    storyData.storySteps.forEach((step, index) => {
        const isCompleted = storyData.stepsCompleted?.[index] || false;
        const isCurrent = index === storyData.currentStepIndex && !storyData.storyComplete;

        const stepCard = document.createElement('div');
        stepCard.className = 'story-progress-extended__step-card';
        if (isCurrent) {
            stepCard.classList.add('story-progress-extended__step-card--current');
        }
        if (isCompleted) {
            stepCard.classList.add('story-progress-extended__step-card--completed');
        }
        if (storyData.storyComplete) {
            stepCard.classList.add('story-progress-extended__step-card--story-done');
        }

        const stepHeader = document.createElement('div');
        stepHeader.className = 'story-progress-extended__step-header';

        const stepNumber = document.createElement('span');
        stepNumber.className = 'story-progress-extended__step-number';

        if (isCompleted) {
            stepNumber.textContent = '✓';
            stepNumber.classList.add('story-progress-extended__step-number--done');
        } else {
            stepNumber.textContent = String(index + 1);
        }

        const stepLabel = document.createElement('span');
        stepLabel.className = 'story-progress-extended__step-label';

        if (isCurrent) {
            stepLabel.textContent = '► Current';
            stepLabel.classList.add('story-progress-extended__step-label--current');
        } else if (isCompleted) {
            stepLabel.textContent = 'Completed';
        } else {
            stepLabel.textContent = 'Upcoming';
        }

        stepHeader.append(stepNumber, stepLabel);

        const stepTextarea = document.createElement('textarea');
        stepTextarea.className = 'text_pole story-progress-extended__step-text';
        stepTextarea.value = step;
        stepTextarea.rows = 2;
        stepTextarea.dataset.stepIndex = String(index);

        if (!storyData.isActive && !storyData.storyComplete) {
            stepTextarea.disabled = true;
        }

        stepTextarea.addEventListener('change', onStepEdit);

        stepCard.append(stepHeader, stepTextarea);
        stepsList.append(stepCard);
    });
}

function onStepEdit(event) {
    const context = getContextSafely();
    if (!context) {
        return;
    }

    const textarea = event.target;
    const index = parseInt(textarea.dataset.stepIndex, 10);
    const storyData = getStoryData(context);

    if (!storyData?.storySteps) {
        return;
    }

    storyData.storySteps[index] = textarea.value;
    context.saveMetadataDebounced?.();
}

function updateProgressUI(storyData) {
    const fractionEl = document.getElementById('story_progress_extended_fraction');
    const barEl = document.getElementById('story_progress_extended_bar');
    const progressStatusEl = document.getElementById('story_progress_extended_progress_status');

    if (!storyData || !storyData.storySteps || storyData.storySteps.length === 0) {
        if (fractionEl) {
            fractionEl.textContent = '';
        }
        if (barEl) {
            barEl.style.width = '0%';
        }
        if (progressStatusEl) {
            if (storyData?.storyComplete) {
                progressStatusEl.textContent = 'Story complete!';
                progressStatusEl.classList.add('story-progress-extended__status--success');
            } else {
                progressStatusEl.textContent = '';
            }
        }
        return;
    }

    const completedCount = (storyData.stepsCompleted || []).filter(Boolean).length;
    const totalSteps = storyData.storySteps.length;
    const percentage = Math.round((completedCount / totalSteps) * 100);

    if (fractionEl) {
        fractionEl.textContent = `${completedCount}/${totalSteps}`;
    }

    if (barEl) {
        barEl.style.width = `${percentage}%`;

        if (storyData.storyComplete) {
            barEl.classList.add('story-progress-extended__progress-bar--complete');
        } else {
            barEl.classList.remove('story-progress-extended__progress-bar--complete');
        }
    }

    if (progressStatusEl) {
        if (storyData.storyComplete) {
            progressStatusEl.textContent = 'Story complete! All steps finished.';
            progressStatusEl.classList.add('story-progress-extended__status--success');
        } else if (storyData.isActive) {
            progressStatusEl.textContent = `Active — Step ${storyData.currentStepIndex + 1}: ${storyData.storySteps[storyData.currentStepIndex]?.substring(0, 60) || 'Unknown'}...`;
            progressStatusEl.classList.remove('story-progress-extended__status--success');
        } else {
            progressStatusEl.textContent = 'Inactive';
            progressStatusEl.classList.remove('story-progress-extended__status--success');
        }
    }

    const ctx = getContextSafely();
    const settings = ctx ? getSettings(ctx) : null;
    renderStepList(storyData, settings);

    const checkBtn = document.getElementById('story_progress_extended_check');
    if (checkBtn) {
        checkBtn.disabled = !storyData.isActive || storyData.storyComplete;
    }
}

function refreshUI() {
    const context = getContextSafely();
    if (!context) {
        return;
    }

    const settings = getSettings(context);
    const storyData = getStoryData(context);

    const enabledCheckbox = document.getElementById('story_progress_extended_enabled');
    if (enabledCheckbox) {
        enabledCheckbox.checked = settings.enabled;
    }

    const stepsInput = document.getElementById('story_progress_extended_steps');
    if (stepsInput) {
        stepsInput.value = settings.numberOfSteps;
    }

    const intervalInput = document.getElementById('story_progress_extended_interval');
    if (intervalInput) {
        intervalInput.value = settings.checkInterval;
    }

    const autoInjectCheckbox = document.getElementById('story_progress_extended_auto_inject');
    if (autoInjectCheckbox) {
        autoInjectCheckbox.checked = settings.autoInject;
    }

    const goalTextarea = document.getElementById('story_progress_extended_goal');
    if (goalTextarea && storyData) {
        goalTextarea.value = storyData.storyGoal || '';
    }

    renderConnectionProfileOptions(context, settings);
    updateProgressUI(storyData);

    const generateBtn = document.getElementById('story_progress_extended_generate');
    const resetBtn = document.getElementById('story_progress_extended_reset');
    if (generateBtn) {
        generateBtn.disabled = !settings.connectionProfileId;
    }
    if (resetBtn && storyData) {
        resetBtn.disabled = !storyData.storyGoal && !storyData.isActive;
    }
}

async function onGenerateClick() {
    const context = getContextSafely();
    if (!context) {
        return;
    }

    const goalTextarea = document.getElementById('story_progress_extended_goal');
    const storyGoal = goalTextarea?.value?.trim();

    if (!storyGoal) {
        setStatus('Please enter a story goal first.');
        return;
    }

    const generateBtn = document.getElementById('story_progress_extended_generate');
    if (generateBtn) {
        generateBtn.disabled = true;
        generateBtn.textContent = 'Generating...';
    }

    try {
        const result = await generateStorySteps(storyGoal);

        if (result.success) {
            setStatus('Story steps generated successfully!');
        } else {
            setStatus(`Error: ${result.error}`);
        }
    } catch (error) {
        setStatus(`Error: ${error.message}`);
    }

    if (generateBtn) {
        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate Story';
    }

    refreshUI();
}

async function onCheckClick() {
    const checkBtn = document.getElementById('story_progress_extended_check');
    if (checkBtn) {
        checkBtn.disabled = true;
        checkBtn.textContent = 'Checking...';
    }

    try {
        const result = await checkStepCompletion();

        if (result.success) {
            if (result.completed) {
                setStatus('Step completed! Moving forward.');
            } else {
                setStatus(`Not yet completed: ${result.reasoning}`);
            }
        } else {
            if (result.error !== 'Busy') {
                setStatus(`Check error: ${result.error}`);
            }
        }
    } catch (error) {
        setStatus(`Check error: ${error.message}`);
    }

    if (checkBtn) {
        checkBtn.disabled = false;
        checkBtn.textContent = 'Check Now';
    }

    refreshUI();
}

function onResetClick() {
    resetStory();
    refreshUI();
    setStatus('Story progress reset.');
}

function bindEvents(context, settings) {
    const enabledCheckbox = document.getElementById('story_progress_extended_enabled');

    if (enabledCheckbox && !enabledCheckbox.dataset.speBound) {
        enabledCheckbox.dataset.speBound = 'true';
        enabledCheckbox.addEventListener('change', () => {
            settings.enabled = enabledCheckbox.checked;
            context.saveSettingsDebounced?.();

            if (!settings.enabled) {
                removeSteeringPrompt();
            }
        });
    }

    const profileSelect = document.getElementById(PROFILE_SELECT_ID);

    if (profileSelect && !profileSelect.dataset.speBound) {
        profileSelect.dataset.speBound = 'true';
        profileSelect.addEventListener('change', () => {
            settings.connectionProfileId = profileSelect.value;
            context.saveSettingsDebounced?.();

            const generateBtn = document.getElementById('story_progress_extended_generate');
            if (generateBtn) {
                generateBtn.disabled = !settings.connectionProfileId;
            }

            console.info('[StoryProgressExtended] Connection profile preference saved.', {
                connectionProfileId: settings.connectionProfileId,
            });
        });
    }

    const stepsInput = document.getElementById('story_progress_extended_steps');

    if (stepsInput && !stepsInput.dataset.speBound) {
        stepsInput.dataset.speBound = 'true';
        stepsInput.addEventListener('change', () => {
            let val = parseInt(stepsInput.value, 10);
            if (isNaN(val) || val < 1) {
                val = 1;
            }
            if (val > 20) {
                val = 20;
            }
            stepsInput.value = val;
            settings.numberOfSteps = val;
            context.saveSettingsDebounced?.();
        });
    }

    const intervalInput = document.getElementById('story_progress_extended_interval');

    if (intervalInput && !intervalInput.dataset.speBound) {
        intervalInput.dataset.speBound = 'true';
        intervalInput.addEventListener('change', () => {
            let val = parseInt(intervalInput.value, 10);
            if (isNaN(val) || val < 1) {
                val = 1;
            }
            if (val > 20) {
                val = 20;
            }
            intervalInput.value = val;
            settings.checkInterval = val;
            context.saveSettingsDebounced?.();
        });
    }

    const autoInjectCheckbox = document.getElementById('story_progress_extended_auto_inject');

    if (autoInjectCheckbox && !autoInjectCheckbox.dataset.speBound) {
        autoInjectCheckbox.dataset.speBound = 'true';
        autoInjectCheckbox.addEventListener('change', () => {
            settings.autoInject = autoInjectCheckbox.checked;
            context.saveSettingsDebounced?.();
        });
    }

    const generateBtn = document.getElementById('story_progress_extended_generate');

    if (generateBtn && !generateBtn.dataset.speBound) {
        generateBtn.dataset.speBound = 'true';
        generateBtn.addEventListener('click', onGenerateClick);
    }

    const resetBtn = document.getElementById('story_progress_extended_reset');

    if (resetBtn && !resetBtn.dataset.speBound) {
        resetBtn.dataset.speBound = 'true';
        resetBtn.addEventListener('click', onResetClick);
    }

    const checkBtn = document.getElementById('story_progress_extended_check');

    if (checkBtn && !checkBtn.dataset.speBound) {
        checkBtn.dataset.speBound = 'true';
        checkBtn.addEventListener('click', onCheckClick);
    }

    const goalTextarea = document.getElementById('story_progress_extended_goal');

    if (goalTextarea && !goalTextarea.dataset.speBound) {
        goalTextarea.dataset.speBound = 'true';
        goalTextarea.addEventListener('input', () => {
            const storyData = getStoryData(context);
            if (storyData) {
                storyData.storyGoal = goalTextarea.value;
            }
        });
    }
}

function bindConnectionProfileEvents(context) {
    if (!context?.eventSource || !context?.eventTypes || context.eventSource.__speProfileEventsBound) {
        return;
    }

    const events = [
        'CONNECTION_PROFILE_CREATED',
        'CONNECTION_PROFILE_UPDATED',
        'CONNECTION_PROFILE_DELETED',
    ];

    for (const eventName of events) {
        const eventType = context.eventTypes[eventName];
        if (!eventType) {
            continue;
        }

        context.eventSource.on(eventType, () => {
            const settings = getSettings(context);
            renderConnectionProfileOptions(context, settings);
        });
    }

    context.eventSource.__speProfileEventsBound = true;
}

function getSettingsContainer() {
    return document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
}

function ensureSettingsPanel() {
    let panel = document.getElementById(SETTINGS_PANEL_ID);

    if (panel) {
        return panel;
    }

    const container = getSettingsContainer();
    if (!container) {
        console.warn('[StoryProgressExtended] Extensions settings container was not found.');
        return null;
    }

    panel = createSettingsPanel();
    container.append(panel);

    return panel;
}

function initUI(context, settings) {
    if (!ensureSettingsPanel()) {
        return false;
    }

    bindEvents(context, settings);
    bindConnectionProfileEvents(context);
    refreshUI();
    return true;
}

export {
    initUI,
    refreshUI,
    updateProgressUI,
    createSettingsPanel,
    ensureSettingsPanel,
};