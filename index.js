const MODULE_NAME = 'storyProgressExtended';
const STORY_METADATA_KEY = 'storyProgressExtended';
const SETTINGS_PANEL_ID = 'story_progress_extended_settings';
const PROFILE_SELECT_ID = 'story_progress_extended_connection_profile';
const PROFILE_STATUS_ID = 'story_progress_extended_profile_status';
const EXTENSION_PROMPT_KEY = MODULE_NAME;
const PROMPT_POSITION_AFTER = 2;
const PROMPT_DEPTH = 2;
const PROMPT_ROLE_SYSTEM = 0;
const MAX_CHAT_MESSAGES_FOR_CONTEXT = 30;

const CONNECTION_PROFILE_EVENTS = [
    'CONNECTION_PROFILE_CREATED',
    'CONNECTION_PROFILE_UPDATED',
    'CONNECTION_PROFILE_DELETED',
];

const defaultSettings = Object.freeze({
    enabled: true,
    connectionProfileId: '',
    numberOfSteps: 5,
    checkInterval: 5,
    autoInject: true,
});

let isGenerating = false;
let isChecking = false;
let chatEventsBound = false;
let profileEventsBound = false;
let uiInitialized = false;

// ==================== Context Helper ====================

function getContextSafely() {
    if (!globalThis.SillyTavern || typeof globalThis.SillyTavern.getContext !== 'function') {
        return null;
    }
    return globalThis.SillyTavern.getContext();
}

// ==================== Settings ====================

function getSettings(context) {
    if (!context?.extensionSettings) {
        return structuredClone(defaultSettings);
    }
    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    const settings = context.extensionSettings[MODULE_NAME];
    let changed = false;
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = defaultSettings[key];
            changed = true;
        }
    }
    if (changed) context.saveSettingsDebounced?.();
    return settings;
}

// ==================== Story Data ====================

function createDefaultStoryData() {
    return {
        storyGoal: '',
        storySteps: [],
        currentStepIndex: 0,
        stepsCompleted: [],
        messagesSinceCheck: 0,
        aiMessagesSinceCheck: 0,
        storyComplete: false,
        isActive: false,
    };
}

function migrateStoryData(storyData) {
    if (!storyData?.storySteps) return storyData;
    let migrated = false;
    storyData.storySteps = storyData.storySteps.map((step, i) => {
        if (typeof step === 'string') {
            migrated = true;
            return { title: `Task ${i + 1}`, description: step };
        }
        if (!step.title) {
            migrated = true;
            step.title = `Task ${i + 1}`;
        }
        if (!step.description) {
            migrated = true;
            step.description = step.title;
        }
        return step;
    });
    return storyData;
}

function getStoryData(context) {
    if (!context?.chatMetadata) return null;
    if (!context.chatMetadata[STORY_METADATA_KEY]) {
        context.chatMetadata[STORY_METADATA_KEY] = createDefaultStoryData();
    }
    return migrateStoryData(context.chatMetadata[STORY_METADATA_KEY]);
}

function saveStoryData(context) {
    if (typeof context.saveMetadataDebounced === 'function') {
        context.saveMetadataDebounced();
    } else if (typeof context.saveMetadata === 'function') {
        context.saveMetadata();
    }
}

// ==================== Character / Chat Context ====================

function getCharacterContext(context) {
    const charId = context.characterId;
    if (charId === undefined || charId === null) return null;
    const char = context.characters?.[charId];
    if (!char?.data) return null;
    const d = char.data;
    const p = [];
    if (d.name) p.push(`Character Name: ${d.name}`);
    if (d.description) p.push(`Character Description: ${d.description}`);
    if (d.personality) p.push(`Character Personality: ${d.personality}`);
    if (d.scenario) p.push(`Scenario: ${d.scenario}`);
    if (d.first_mes) p.push(`First Message: ${d.first_mes}`);
    if (d.mes_example) p.push(`Example Messages: ${d.mes_example}`);
    if (d.system_prompt) p.push(`Character System Prompt: ${d.system_prompt}`);
    if (d.post_history_instructions) p.push(`Post-History Instructions: ${d.post_history_instructions}`);
    return p.join('\n\n');
}

function getChatContext(context, maxMessages) {
    const chat = context.chat;
    if (!Array.isArray(chat) || chat.length === 0) return '';
    const limit = maxMessages || MAX_CHAT_MESSAGES_FOR_CONTEXT;
    return chat.slice(-limit).map(msg => {
        const sender = msg.is_user ? context.name1 : msg.name || context.name2;
        return `${sender}: ${msg.mes || ''}`;
    }).join('\n');
}

// ==================== Prompt Builders ====================

function buildTaskGenerationMessages(context, storyGoal, numberOfSteps) {
    const characterContext = getCharacterContext(context);
    const chatContext = getChatContext(context);

    const systemContent = `You are a task planning assistant for interactive roleplay. Your job is to break a narrative goal into concrete, actionable tasks.

You must respond ONLY with valid JSON, nothing else:
{"tasks": [{"title": "Short Task Title", "description": "What exactly needs to happen to complete this task"}]}

Rules:
- Each task must be a clear, actionable objective that can be definitively accomplished
- Tasks are sequential: each builds on the previous one
- Generate exactly ${numberOfSteps} tasks
- The title should be 2-6 words summarizing the task
- The description should be 1-3 sentences explaining what must happen
- Tasks should feel natural within the roleplay, not forced
- When all tasks are complete, the overall goal must be fulfilled`;

    let userContent = `Narrative Goal: ${storyGoal}\n\n`;
    if (characterContext) userContent += `--- Character Context ---\n${characterContext}\n\n`;
    if (chatContext) userContent += `--- Recent Chat History ---\n${chatContext}\n\n`;
    userContent += `Break the goal above into ${numberOfSteps} actionable tasks. Respond with JSON only.`;

    return [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
    ];
}

function buildCompletionCheckMessages(context, task, currentStepIndex) {
    const characterContext = getCharacterContext(context);
    const chatContext = getChatContext(context);

    const systemContent = `You evaluate whether a specific task has been completed in a roleplay conversation.

You must respond ONLY with valid JSON:
{"completed": true/false, "reasoning": "Brief explanation"}

A task is "completed" only when its described objective has clearly and fully been achieved in the conversation. Partial progress does NOT count.`;

    let userContent = `Task ${currentStepIndex + 1} — "${task.title}"\nObjective: ${task.description}\n\n`;
    if (characterContext) userContent += `--- Character Context ---\n${characterContext}\n\n`;
    userContent += `--- Recent Chat History ---\n${chatContext}\n\n`;
    userContent += `Has the task "${task.title}" been fully accomplished? Answer with JSON only.`;

    return [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
    ];
}

function buildSteeringPromptText(task, currentStepIndex, totalSteps, storyGoal) {
    return [
        `[Story Progress \u2014 Task ${currentStepIndex + 1}/${totalSteps}: "${task.title}"]`,
        `Overall Goal: ${storyGoal}`,
        `Current Task: ${task.title} \u2014 ${task.description}`,
        `You MUST actively steer the roleplay toward completing this task. Ensure the characters' actions, dialogue, and events directly progress toward this objective. This is a required goal, not optional guidance. Do not ignore it or move on without achieving it.`,
    ].join('\n');
}

// ==================== Response Parsers ====================

function parseTasksFromResponse(responseText) {
    if (!responseText || typeof responseText !== 'string') return null;
    let cleaned = responseText.trim();

    const jsonMatch = cleaned.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
    if (jsonMatch) cleaned = jsonMatch[0];

    try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
            return parsed.tasks.map((t, i) => ({
                title: t.title || `Task ${i + 1}`,
                description: t.description || t.title || `Task ${i + 1}`,
            }));
        }
    } catch {
        const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            try {
                const arr = JSON.parse(arrayMatch[0]);
                if (Array.isArray(arr) && arr.length > 0) {
                    return arr.map((t, i) => {
                        if (typeof t === 'string') return { title: `Task ${i + 1}`, description: t };
                        return { title: t.title || `Task ${i + 1}`, description: t.description || t.title || `Task ${i + 1}` };
                    });
                }
            } catch { /* fall through */ }
        }
    }

    const lines = cleaned.split('\n').filter(l => l.trim().length > 0);
    const taskLines = lines.filter(l => /^\d+[\.\):]\s/.test(l.trim()));
    if (taskLines.length > 0) {
        return taskLines.map((l, i) => {
            const text = l.trim().replace(/^\d+[\.\):]\s*/, '');
            return { title: `Task ${i + 1}`, description: text };
        });
    }

    if (lines.length > 1) {
        return lines.filter(l => l.trim().length > 5).map((l, i) => ({
            title: `Task ${i + 1}`,
            description: l.trim(),
        }));
    }
    return null;
}

function parseCompletionFromResponse(responseText) {
    if (!responseText || typeof responseText !== 'string') {
        return { completed: false, reasoning: 'Empty response' };
    }
    let cleaned = responseText.trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*"completed"[\s\S]*\}/);
    if (jsonMatch) cleaned = jsonMatch[0];

    try {
        const parsed = JSON.parse(cleaned);
        if (typeof parsed.completed === 'boolean') {
            return { completed: parsed.completed, reasoning: parsed.reasoning || 'No reasoning provided' };
        }
    } catch { /* fall through */ }

    const lower = cleaned.toLowerCase();
    if (lower.includes('"completed": true') || lower.includes('"completed":true'))
        return { completed: true, reasoning: 'Parsed from response' };
    if (lower.includes('"completed": false') || lower.includes('"completed":false'))
        return { completed: false, reasoning: 'Parsed from response' };
    if (lower.includes('completed') && lower.includes('yes'))
        return { completed: true, reasoning: 'Inferred from response' };
    if (lower.includes('completed') && lower.includes('no'))
        return { completed: false, reasoning: 'Inferred from response' };
    return { completed: false, reasoning: 'Could not determine completion' };
}

// ==================== Prompt Injector ====================

function injectSteeringPrompt(context, settings) {
    if (!context || typeof context.setExtensionPrompt !== 'function') return;
    if (!settings?.enabled || !settings?.autoInject) { removeSteeringPrompt(); return; }

    const storyData = getStoryData(context);
    if (!storyData?.isActive || storyData.storyComplete) { removeSteeringPrompt(); return; }

    const task = storyData.storySteps[storyData.currentStepIndex];
    if (!task) { removeSteeringPrompt(); return; }

    const text = buildSteeringPromptText(task, storyData.currentStepIndex, storyData.storySteps.length, storyData.storyGoal);
    try {
        context.setExtensionPrompt(EXTENSION_PROMPT_KEY, text, PROMPT_POSITION_AFTER, PROMPT_DEPTH, true, PROMPT_ROLE_SYSTEM);
    } catch (err) {
        console.error('[StoryProgressExtended] Failed to inject steering prompt:', err);
    }
}

function removeSteeringPrompt() {
    const ctx = globalThis.SillyTavern?.getContext?.() || null;
    if (!ctx || typeof ctx.setExtensionPrompt !== 'function') return;
    try { ctx.setExtensionPrompt(EXTENSION_PROMPT_KEY, '', 0, 0, false, 0); } catch { /* */ }
}

// ==================== Connection Profile Helpers ====================

function getProfileApi(context, profileId) {
    const profiles = context.extensionSettings?.connectionManager?.profiles || [];
    return profiles.find(p => p.id === profileId)?.api;
}

function getConnectionManagerState(context) {
    const em = context?.extensionSettings;
    const cm = em?.connectionManager;
    const isDisabled = Array.isArray(em?.disabledExtensions) && em.disabledExtensions.includes('connection-manager');
    return {
        available: Boolean(cm) && !isDisabled,
        isDisabled,
        profiles: Array.isArray(cm?.profiles) ? cm.profiles : [],
    };
}

function getProfileGroupLabel(context, profile) {
    const m = context?.CONNECT_API_MAP?.[profile?.api];
    if (m?.selected === 'openai') return 'Chat Completion';
    if (m?.selected === 'textgenerationwebui') return 'Text Completion';
    return 'Other Profiles';
}

function getSortedProfilesByGroup(context, profiles) {
    const groups = new Map();
    for (const profile of profiles) {
        if (!profile?.id || !profile?.name) continue;
        const label = getProfileGroupLabel(context, profile);
        const arr = groups.get(label) ?? [];
        arr.push(profile);
        groups.set(label, arr);
    }
    for (const arr of groups.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
}

// ==================== Popup Helper ====================

function showPopup(title, body, type) {
    const ctx = getContextSafely();
    if (!ctx) return;

    if (typeof ctx.callGenericPopup === 'function') {
        const POPUP_TYPE = ctx.POPUP_TYPE || {};
        const popupType = type === 'success' ? (POPUP_TYPE.TEXT || 1) : (POPUP_TYPE.TEXT || 1);
        ctx.callGenericPopup(
            `<div class="story-progress-extended__popup-content story-progress-extended__popup-content--${type}"><h3>${title}</h3><p>${body}</p></div>`,
            popupType,
            '',
            { okButton: 'Close', wide: false },
        );
    } else {
        showInlineNotification(title, body, type);
    }
}

function showInlineNotification(title, body, type) {
    const existing = document.getElementById('story_progress_extended_notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.id = 'story_progress_extended_notification';
    notification.className = `story-progress-extended__notification story-progress-extended__notification--${type}`;

    const titleEl = document.createElement('strong');
    titleEl.textContent = title;

    const bodyEl = document.createElement('span');
    bodyEl.textContent = body;

    const closeBtn = document.createElement('span');
    closeBtn.className = 'story-progress-extended__notification-close';
    closeBtn.textContent = '\u2715';
    closeBtn.addEventListener('click', () => notification.remove());

    notification.append(titleEl, bodyEl, closeBtn);
    document.body.append(notification);

    setTimeout(() => {
        if (notification.parentNode) notification.remove();
    }, 5000);
}

// ==================== Story Manager ====================

async function generateStorySteps(storyGoal) {
    const context = getContextSafely();
    if (!context) return { success: false, error: 'Context unavailable' };
    if (isGenerating) return { success: false, error: 'Already generating' };

    const settings = getSettings(context);
    if (!settings.connectionProfileId) return { success: false, error: 'No connection profile selected' };
    if (!storyGoal?.trim()) return { success: false, error: 'Please enter a goal' };

    isGenerating = true;
    try {
        const storyData = getStoryData(context);
        const messages = buildTaskGenerationMessages(context, storyGoal.trim(), settings.numberOfSteps || 5);

        const apiMap = context.CONNECT_API_MAP?.[getProfileApi(context, settings.connectionProfileId)];
        const isCC = apiMap?.selected === 'openai';

        let result;
        if (typeof context.ConnectionManagerRequestService?.sendRequest === 'function') {
            result = await context.ConnectionManagerRequestService.sendRequest(
                settings.connectionProfileId,
                isCC ? messages : messages.map(m => `${m.role}: ${m.content}`).join('\n\n'),
                2048,
                { stream: false, extractData: true, includePreset: true },
            );
        } else {
            const qp = messages.map(m => m.content).join('\n\n');
            const resp = await context.generateQuietPrompt({ quietPrompt: qp, skipWIAN: true, responseLength: 2048 });
            result = { content: resp, reasoning: '' };
        }

        const responseText = result?.content || result?.text || (typeof result === 'string' ? result : '');
        const tasks = parseTasksFromResponse(responseText);

        if (!tasks || tasks.length === 0) {
            return { success: false, error: 'Failed to parse tasks from AI response. Try again.' };
        }

        storyData.storyGoal = storyGoal.trim();
        storyData.storySteps = tasks;
        storyData.currentStepIndex = 0;
        storyData.stepsCompleted = tasks.map(() => false);
        storyData.messagesSinceCheck = 0;
        storyData.aiMessagesSinceCheck = 0;
        storyData.storyComplete = false;
        storyData.isActive = true;

        saveStoryData(context);
        injectSteeringPrompt(context, settings);

        return { success: true, data: storyData };
    } catch (error) {
        console.error('[StoryProgressExtended] Error generating tasks:', error);
        return { success: false, error: error.message || 'Unknown error' };
    } finally {
        isGenerating = false;
    }
}

async function checkStepCompletion() {
    const context = getContextSafely();
    if (!context) return { success: false, error: 'Context unavailable' };
    if (isChecking || isGenerating) return { success: false, error: 'Busy' };

    const settings = getSettings(context);
    const storyData = getStoryData(context);

    if (!storyData?.isActive || storyData.storyComplete) return { success: false, error: 'No active tasks' };
    if (!settings.connectionProfileId) return { success: false, error: 'No connection profile' };

    const task = storyData.storySteps[storyData.currentStepIndex];
    if (!task) return { success: false, error: 'No current task' };

    isChecking = true;
    try {
        const messages = buildCompletionCheckMessages(context, task, storyData.currentStepIndex);

        const apiMap = context.CONNECT_API_MAP?.[getProfileApi(context, settings.connectionProfileId)];
        const isCC = apiMap?.selected === 'openai';

        let result;
        if (typeof context.ConnectionManagerRequestService?.sendRequest === 'function') {
            result = await context.ConnectionManagerRequestService.sendRequest(
                settings.connectionProfileId,
                isCC ? messages : messages.map(m => `${m.role}: ${m.content}`).join('\n\n'),
                512,
                { stream: false, extractData: true, includePreset: true },
            );
        } else {
            const qp = messages.map(m => m.content).join('\n\n');
            const resp = await context.generateQuietPrompt({ quietPrompt: qp, skipWIAN: true, responseLength: 512 });
            result = { content: resp, reasoning: '' };
        }

        const responseText = result?.content || result?.text || (typeof result === 'string' ? result : '');
        const cr = parseCompletionFromResponse(responseText);

        if (cr.completed) {
            storyData.stepsCompleted[storyData.currentStepIndex] = true;
            const next = storyData.currentStepIndex + 1;
            if (next >= storyData.storySteps.length) {
                storyData.storyComplete = true;
                storyData.isActive = false;
                removeSteeringPrompt();
                showPopup('All Tasks Complete!', `"${storyData.storyGoal}" has been achieved. All ${storyData.storySteps.length} tasks finished.`, 'success');
            } else {
                storyData.currentStepIndex = next;
                if (settings.autoInject) injectSteeringPrompt(context, settings);
                const nextTask = storyData.storySteps[next];
                showPopup('Task Completed', `"${task.title}" is done. Next: "${nextTask.title}"`, 'success');
            }
        } else {
            if (settings.autoInject) injectSteeringPrompt(context, settings);
            showPopup('Not Yet Done', `"${task.title}" \u2014 ${cr.reasoning}`, 'info');
        }

        storyData.aiMessagesSinceCheck = 0;
        storyData.messagesSinceCheck = 0;
        saveStoryData(context);

        return { success: true, completed: cr.completed, reasoning: cr.reasoning, data: storyData };
    } catch (error) {
        console.error('[StoryProgressExtended] Error checking task:', error);
        return { success: false, error: error.message || 'Unknown error' };
    } finally {
        isChecking = false;
    }
}

function resetStory() {
    const context = getContextSafely();
    if (!context) return;
    removeSteeringPrompt();
    if (context.chatMetadata) {
        context.chatMetadata[STORY_METADATA_KEY] = createDefaultStoryData();
        saveStoryData(context);
    }
}

function incrementMessageCounter(isAI) {
    const context = getContextSafely();
    if (!context) return;
    const storyData = getStoryData(context);
    if (!storyData?.isActive) return;
    storyData.messagesSinceCheck = (storyData.messagesSinceCheck || 0) + 1;
    if (isAI) storyData.aiMessagesSinceCheck = (storyData.aiMessagesSinceCheck || 0) + 1;
    saveStoryData(context);
}

async function onAIMessage() {
    const context = getContextSafely();
    if (!context) return;
    const settings = getSettings(context);
    const storyData = getStoryData(context);
    if (!storyData?.isActive || storyData.storyComplete || !settings.enabled) return;

    incrementMessageCounter(true);

    const checkInterval = settings.checkInterval || 5;
    if (storyData.aiMessagesSinceCheck >= checkInterval) {
        await checkStepCompletion();
    }
}

function onChatChanged() {
    removeSteeringPrompt();
    const context = getContextSafely();
    if (!context) return;
    const storyData = getStoryData(context);
    const settings = getSettings(context);
    if (storyData?.isActive && !storyData.storyComplete && settings.autoInject) {
        injectSteeringPrompt(context, settings);
    }
}

// ==================== UI ====================

function setStatus(text) {
    const el = document.getElementById(PROFILE_STATUS_ID);
    if (el) el.textContent = text;
}

function renderConnectionProfileOptions(context, settings) {
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

// ==================== Panel Construction ====================

function makeRow(labelText, htmlFor, children, options) {
    const row = document.createElement('div');
    row.className = 'story-progress-extended__row' + (options?.setting ? ' story-progress-extended__row--setting' : '');
    const label = document.createElement('label');
    label.htmlFor = htmlFor;
    label.textContent = labelText;
    row.append(label);
    for (const child of children) row.append(child);
    return row;
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

    // Enable
    const enableCb = document.createElement('input');
    enableCb.id = 'story_progress_extended_enabled';
    enableCb.type = 'checkbox';
    enableCb.className = 'story-progress-extended__checkbox';
    content.append(makeRow('Enabled', enableCb.id, [enableCb], { setting: true }));

    // Profile
    const profileSelect = document.createElement('select');
    profileSelect.id = PROFILE_SELECT_ID;
    profileSelect.className = 'text_pole story-progress-extended__select';
    const profileStatus = document.createElement('small');
    profileStatus.id = PROFILE_STATUS_ID;
    profileStatus.className = 'story-progress-extended__status';
    const profileWrapper = document.createElement('div');
    profileWrapper.append(makeRow('Connection Profile', PROFILE_SELECT_ID, [profileSelect], { setting: true }), profileStatus);
    content.append(profileWrapper);

    // Number of Steps
    const stepsInput = document.createElement('input');
    stepsInput.id = 'story_progress_extended_steps';
    stepsInput.type = 'number';
    stepsInput.min = '1';
    stepsInput.max = '20';
    stepsInput.value = '5';
    stepsInput.className = 'text_pole story-progress-extended__number-input';
    content.append(makeRow('Number of Tasks', stepsInput.id, [stepsInput], { setting: true }));

    // Check Interval
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
    const intervalWrapper = document.createElement('div');
    intervalWrapper.append(makeRow('Check Interval', intervalInput.id, [intervalInput], { setting: true }), intervalHint);
    content.append(intervalWrapper);

    // Auto Inject
    const autoInjectCb = document.createElement('input');
    autoInjectCb.id = 'story_progress_extended_auto_inject';
    autoInjectCb.type = 'checkbox';
    autoInjectCb.className = 'story-progress-extended__checkbox';
    content.append(makeRow('Auto-Inject Steering', autoInjectCb.id, [autoInjectCb], { setting: true }));

    // Divider
    const divider = document.createElement('hr');
    divider.className = 'story-progress-extended__divider';
    content.append(divider);

    // Goal section
    const goalSection = document.createElement('div');
    goalSection.className = 'story-progress-extended__goal-section';

    const goalLabel = document.createElement('label');
    goalLabel.htmlFor = 'story_progress_extended_goal';
    goalLabel.textContent = 'Narrative Goal';
    goalLabel.className = 'story-progress-extended__goal-label';

    const goalTextarea = document.createElement('textarea');
    goalTextarea.id = 'story_progress_extended_goal';
    goalTextarea.className = 'text_pole story-progress-extended__goal-input';
    goalTextarea.placeholder = 'Describe the narrative goal \u2014 what should happen in the story?';
    goalTextarea.rows = 3;

    const buttonRow = document.createElement('div');
    buttonRow.className = 'story-progress-extended__button-row';

    const generateBtn = document.createElement('button');
    generateBtn.id = 'story_progress_extended_generate';
    generateBtn.className = 'menu_button story-progress-extended__btn story-progress-extended__btn--generate';
    generateBtn.textContent = 'Generate Tasks';

    const resetBtn = document.createElement('button');
    resetBtn.id = 'story_progress_extended_reset';
    resetBtn.className = 'menu_button story-progress-extended__btn story-progress-extended__btn--reset';
    resetBtn.textContent = 'Reset';

    buttonRow.append(generateBtn, resetBtn);
    goalSection.append(goalLabel, goalTextarea, buttonRow);
    content.append(goalSection);

    // Progress section
    const progressSection = document.createElement('div');
    progressSection.id = 'story_progress_extended_progress';
    progressSection.className = 'story-progress-extended__progress';

    const progressHeader = document.createElement('div');
    progressHeader.className = 'story-progress-extended__progress-header';
    const progressTitle = document.createElement('b');
    progressTitle.textContent = 'Task Progress';
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

    const goalBanner = document.createElement('div');
    goalBanner.id = 'story_progress_extended_goal_banner';
    goalBanner.className = 'story-progress-extended__goal-banner';
    goalBanner.style.display = 'none';

    const tasksList = document.createElement('div');
    tasksList.id = 'story_progress_extended_steps_list';
    tasksList.className = 'story-progress-extended__steps-list';

    const checkBtn = document.createElement('button');
    checkBtn.id = 'story_progress_extended_check';
    checkBtn.className = 'menu_button story-progress-extended__btn story-progress-extended__btn--check';
    checkBtn.textContent = 'Check Now';

    const statusText = document.createElement('small');
    statusText.id = 'story_progress_extended_progress_status';
    statusText.className = 'story-progress-extended__status';

    progressSection.append(progressHeader, progressBarContainer, goalBanner, tasksList, checkBtn, statusText);
    content.append(progressSection);

    drawer.append(toggle, content);
    wrapper.append(drawer);
    return wrapper;
}

// ==================== Task List Rendering ====================

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
    goalLabel.textContent = storyData.storyComplete ? 'Goal Achieved:' : 'Goal:';

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

function renderTaskList(storyData) {
    const list = document.getElementById('story_progress_extended_steps_list');
    if (!list) return;
    list.innerHTML = '';

    if (!storyData?.storySteps?.length) {
        const empty = document.createElement('div');
        empty.className = 'story-progress-extended__empty';
        empty.textContent = 'No tasks generated yet. Enter a narrative goal and click "Generate Tasks".';
        list.append(empty);
        return;
    }

    storyData.storySteps.forEach((task, index) => {
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

        header.append(number, label);

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
    });
}

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

// ==================== UI Update ====================

function updateProgressUI(storyData) {
    const fractionEl = document.getElementById('story_progress_extended_fraction');
    const barEl = document.getElementById('story_progress_extended_bar');
    const statusEl = document.getElementById('story_progress_extended_progress_status');
    const checkBtn = document.getElementById('story_progress_extended_check');

    renderGoalBanner(storyData);

    if (!storyData?.storySteps?.length) {
        if (fractionEl) fractionEl.textContent = '';
        if (barEl) barEl.style.width = '0%';
        if (statusEl) statusEl.textContent = '';
        if (checkBtn) checkBtn.disabled = true;
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

    if (checkBtn) checkBtn.disabled = !storyData.isActive || storyData.storyComplete;

    renderTaskList(storyData);
}

function refreshUI() {
    const context = getContextSafely();
    if (!context) return;
    const settings = getSettings(context);
    const storyData = getStoryData(context);

    const el = (id) => document.getElementById(id);
    const cb = el('story_progress_extended_enabled');
    if (cb) cb.checked = settings.enabled;
    const si = el('story_progress_extended_steps');
    if (si) si.value = settings.numberOfSteps;
    const ii = el('story_progress_extended_interval');
    if (ii) ii.value = settings.checkInterval;
    const ai = el('story_progress_extended_auto_inject');
    if (ai) ai.checked = settings.autoInject;
    const gt = el('story_progress_extended_goal');
    if (gt && storyData) gt.value = storyData.storyGoal || '';

    renderConnectionProfileOptions(context, settings);
    updateProgressUI(storyData);

    const gb = el('story_progress_extended_generate');
    const rb = el('story_progress_extended_reset');
    if (gb) gb.disabled = !settings.connectionProfileId;
    if (rb && storyData) rb.disabled = !storyData.storyGoal && !storyData.isActive;
}

async function onGenerateClick() {
    const goalTextarea = document.getElementById('story_progress_extended_goal');
    const storyGoal = goalTextarea?.value?.trim();
    if (!storyGoal) { setStatus('Please enter a narrative goal first.'); return; }

    const btn = document.getElementById('story_progress_extended_generate');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }

    try {
        const result = await generateStorySteps(storyGoal);
        if (result.success) setStatus('Tasks generated successfully!');
        else setStatus(`Error: ${result.error}`);
    } catch (error) {
        setStatus(`Error: ${error.message}`);
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Generate Tasks'; }
    refreshUI();
}

async function onCheckClick() {
    const btn = document.getElementById('story_progress_extended_check');
    if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }

    try {
        await checkStepCompletion();
    } catch (error) {
        setStatus(`Check error: ${error.message}`);
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Check Now'; }
    refreshUI();
}

function onResetClick() {
    resetStory();
    refreshUI();
    setStatus('Progress reset.');
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
    bind('story_progress_extended_reset', 'click', onResetClick);
    bind('story_progress_extended_check', 'click', onCheckClick);

    bind('story_progress_extended_goal', 'input', function () {
        const sd = getStoryData(context);
        if (sd) sd.storyGoal = this.value;
    });
}

function bindConnectionProfileEvents(context) {
    if (!context?.eventSource || !context?.eventTypes || profileEventsBound) return;
    for (const eventName of CONNECTION_PROFILE_EVENTS) {
        const eventType = context.eventTypes[eventName];
        if (!eventType) continue;
        context.eventSource.on(eventType, () => refreshUI());
    }
    profileEventsBound = true;
}

function initUI(context, settings) {
    if (!ensureSettingsPanel()) return false;
    bindEvents(context, settings);
    bindConnectionProfileEvents(context);
    refreshUI();
    return true;
}

function bindChatEvents(context) {
    if (!context?.eventSource || !context?.eventTypes || chatEventsBound) return;

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

    chatEventsBound = true;
}

// ==================== Init ====================

function getSettingsContainer() {
    return document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
}

function ensureSettingsPanel() {
    let panel = document.getElementById(SETTINGS_PANEL_ID);
    if (panel) return panel;
    const container = getSettingsContainer();
    if (!container) return null;
    panel = createSettingsPanel();
    container.append(panel);
    return panel;
}

function tryInitUI() {
    try {
        const context = getContextSafely();
        if (!context) return false;
        const settings = getSettings(context);
        if (!initUI(context, settings)) return false;
        bindChatEvents(context);
        const storyData = getStoryData(context);
        if (storyData?.isActive && !storyData.storyComplete && settings.autoInject) {
            injectSteeringPrompt(context, settings);
        }
        console.info('[StoryProgressExtended] UI initialized.');
        return true;
    } catch (err) {
        console.error('[StoryProgressExtended] Init error:', err);
        return false;
    }
}

let initAttempts = 0;
function scheduleUIInit() {
    if (uiInitialized) return;
    if (tryInitUI()) { uiInitialized = true; return; }
    if (initAttempts >= 20) return;
    initAttempts++;
    setTimeout(scheduleUIInit, 500);
}

export function onActivate() {
    console.info('[StoryProgressExtended] onActivate called.');
    const context = getContextSafely();
    if (context) {
        bindChatEvents(context);
        const settings = getSettings(context);
        const storyData = getStoryData(context);
        if (storyData?.isActive && !storyData.storyComplete && settings.autoInject) {
            injectSteeringPrompt(context, settings);
        }
    }
    if (context?.eventSource && context?.eventTypes) {
        const appReady = context.eventTypes.APP_READY;
        if (appReady) {
            context.eventSource.once(appReady, () => {
                if (!uiInitialized) scheduleUIInit();
            });
        }
    }
    scheduleUIInit();
}