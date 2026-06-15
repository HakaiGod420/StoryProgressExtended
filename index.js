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
    if (changed) {
        context.saveSettingsDebounced?.();
    }
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

function getStoryData(context) {
    if (!context?.chatMetadata) {
        return null;
    }
    if (!context.chatMetadata[STORY_METADATA_KEY]) {
        context.chatMetadata[STORY_METADATA_KEY] = createDefaultStoryData();
    }
    return context.chatMetadata[STORY_METADATA_KEY];
}

function saveStoryData(context) {
    if (typeof context.saveMetadataDebounced === 'function') {
        context.saveMetadataDebounced();
    } else if (typeof context.saveMetadata === 'function') {
        context.saveMetadata();
    }
}

// ==================== Context Builder ====================

function getCharacterContext(context) {
    const charId = context.characterId;
    if (charId === undefined || charId === null) {
        return null;
    }
    const char = context.characters?.[charId];
    if (!char?.data) {
        return null;
    }
    const data = char.data;
    const parts = [];
    if (data.name) parts.push(`Character Name: ${data.name}`);
    if (data.description) parts.push(`Character Description: ${data.description}`);
    if (data.personality) parts.push(`Character Personality: ${data.personality}`);
    if (data.scenario) parts.push(`Scenario: ${data.scenario}`);
    if (data.first_mes) parts.push(`First Message: ${data.first_mes}`);
    if (data.mes_example) parts.push(`Example Messages: ${data.mes_example}`);
    if (data.system_prompt) parts.push(`Character System Prompt: ${data.system_prompt}`);
    if (data.post_history_instructions) parts.push(`Post-History Instructions: ${data.post_history_instructions}`);
    return parts.join('\n\n');
}

function getChatContext(context, maxMessages) {
    const chat = context.chat;
    if (!Array.isArray(chat) || chat.length === 0) {
        return '';
    }
    const limit = maxMessages || MAX_CHAT_MESSAGES_FOR_CONTEXT;
    const recentMessages = chat.slice(-limit);
    return recentMessages.map(msg => {
        const sender = msg.is_user ? context.name1 : msg.name || context.name2;
        return `${sender}: ${msg.mes || ''}`;
    }).join('\n');
}

function buildStepGenerationMessages(context, storyGoal, numberOfSteps) {
    const characterContext = getCharacterContext(context);
    const chatContext = getChatContext(context);

    const systemContent = `You are a story planning assistant. Your task is to break down a story goal into sequential story steps for a roleplay scenario.

IMPORTANT: You must respond ONLY with valid JSON in the following format, nothing else:
{"steps": ["Step 1 description", "Step 2 description", "Step 3 description"]}

Rules for the steps:
- Each step should be a clear, specific narrative milestone or event
- Steps should be sequential and build upon each other
- Steps should be achievable within the context of the roleplay
- The steps should collectively fulfill the story goal
- Each step should be described in 1-3 sentences
- Generate exactly ${numberOfSteps} steps
- Steps should be natural story progressions, not forced or contrived`;

    let userContent = `Story Goal: ${storyGoal}\n\n`;
    if (characterContext) userContent += `--- Character Context ---\n${characterContext}\n\n`;
    if (chatContext) userContent += `--- Recent Chat History ---\n${chatContext}\n\n`;
    userContent += `Based on the above context, generate ${numberOfSteps} sequential story steps that will progress toward the story goal: "${storyGoal}". Respond with JSON only.`;

    return [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
    ];
}

function buildCompletionCheckMessages(context, currentStepDescription, currentStepIndex) {
    const characterContext = getCharacterContext(context);
    const chatContext = getChatContext(context);

    const systemContent = `You are a story analysis assistant. Your task is to determine if a specific story step has been accomplished in the ongoing roleplay conversation.

IMPORTANT: You must respond ONLY with valid JSON in the following format:
{"completed": true/false, "reasoning": "Brief explanation of why the step is or isn't completed"}

A step is "completed" when the narrative events described in the step have clearly occurred or been achieved in the conversation. Partial progress does not count as completed.`;

    let userContent = `Current Story Step (${currentStepIndex + 1}): ${currentStepDescription}\n\n`;
    if (characterContext) userContent += `--- Character Context ---\n${characterContext}\n\n`;
    userContent += `--- Recent Chat History ---\n${chatContext}\n\n`;
    userContent += `Has the story step "${currentStepDescription}" been accomplished in the conversation above? Respond with JSON only.`;

    return [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
    ];
}

function buildSteeringPromptText(currentStepDescription, currentStepIndex, totalSteps, storyGoal) {
    return `[Story Progress Reminder - Step ${currentStepIndex + 1}/${totalSteps}]\nCurrent story goal: "${storyGoal}"\nCurrent step to progress toward: "${currentStepDescription}"\nPlease naturally guide the narrative to fulfill this story step. Do not rush or force it, but ensure the story moves meaningfully toward this milestone.`;
}

function parseStepsFromResponse(responseText) {
    if (!responseText || typeof responseText !== 'string') {
        return null;
    }
    let cleaned = responseText.trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*"steps"[\s\S]*\}/);
    if (jsonMatch) cleaned = jsonMatch[0];

    try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed.steps) && parsed.steps.length > 0 && typeof parsed.steps[0] === 'string') {
            return parsed.steps;
        }
    } catch {
        const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            try {
                const arr = JSON.parse(arrayMatch[0]);
                if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'string') {
                    return arr;
                }
            } catch { /* fall through */ }
        }
    }

    const lines = cleaned.split('\n').filter(l => l.trim().length > 0);
    const stepLines = lines.filter(l => /^\d+[\.\):]\s/.test(l.trim()));
    if (stepLines.length > 0) {
        return stepLines.map(l => l.trim().replace(/^\d+[\.\):]\s*/, ''));
    }
    if (lines.length > 1) {
        return lines.map(l => l.trim()).filter(l => l.length > 5);
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

    const lowerText = cleaned.toLowerCase();
    if (lowerText.includes('"completed": true') || lowerText.includes('"completed":true')) {
        return { completed: true, reasoning: 'Parsed from text response' };
    }
    if (lowerText.includes('"completed": false') || lowerText.includes('"completed":false')) {
        return { completed: false, reasoning: 'Parsed from text response' };
    }
    if (lowerText.includes('completed') && lowerText.includes('yes')) {
        return { completed: true, reasoning: 'Inferred from text response' };
    }
    if (lowerText.includes('completed') && lowerText.includes('no')) {
        return { completed: false, reasoning: 'Inferred from text response' };
    }
    return { completed: false, reasoning: 'Could not determine completion status' };
}

// ==================== Prompt Injector ====================

function injectSteeringPrompt(context, settings) {
    if (!context || typeof context.setExtensionPrompt !== 'function') {
        return;
    }
    if (!settings?.enabled || !settings?.autoInject) {
        removeSteeringPrompt();
        return;
    }

    const storyData = getStoryData(context);
    if (!storyData?.isActive || storyData.storyComplete) {
        removeSteeringPrompt();
        return;
    }

    const currentStep = storyData.storySteps[storyData.currentStepIndex];
    if (!currentStep) {
        removeSteeringPrompt();
        return;
    }

    const steeringText = buildSteeringPromptText(
        currentStep, storyData.currentStepIndex, storyData.storySteps.length, storyData.storyGoal,
    );

    try {
        context.setExtensionPrompt(EXTENSION_PROMPT_KEY, steeringText, PROMPT_POSITION_AFTER, PROMPT_DEPTH, true, PROMPT_ROLE_SYSTEM);
    } catch (error) {
        console.error('[StoryProgressExtended] Failed to inject steering prompt:', error);
    }
}

function removeSteeringPrompt() {
    const context = globalThis.SillyTavern?.getContext?.() || null;
    if (!context || typeof context.setExtensionPrompt !== 'function') {
        return;
    }
    try {
        context.setExtensionPrompt(EXTENSION_PROMPT_KEY, '', 0, 0, false, 0);
    } catch { /* silently fail */ }
}

// ==================== Connection Profile Helpers ====================

function getProfileApi(context, profileId) {
    const profiles = context.extensionSettings?.connectionManager?.profiles || [];
    const profile = profiles.find(p => p.id === profileId);
    return profile?.api;
}

function getConnectionManagerState(context) {
    const extensionSettings = context?.extensionSettings;
    const connectionManager = extensionSettings?.connectionManager;
    const disabledExtensions = extensionSettings?.disabledExtensions;
    const isDisabled = Array.isArray(disabledExtensions) && disabledExtensions.includes('connection-manager');
    const profiles = Array.isArray(connectionManager?.profiles) ? connectionManager.profiles : [];
    return { available: Boolean(connectionManager) && !isDisabled, isDisabled, profiles };
}

function getProfileGroupLabel(context, profile) {
    const apiMap = context?.CONNECT_API_MAP?.[profile?.api];
    if (apiMap?.selected === 'openai') return 'Chat Completion';
    if (apiMap?.selected === 'textgenerationwebui') return 'Text Completion';
    return 'Other Profiles';
}

function getSortedProfilesByGroup(context, profiles) {
    const groups = new Map();
    for (const profile of profiles) {
        if (!profile?.id || !profile?.name) continue;
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

// ==================== Story Manager ====================

async function generateStorySteps(storyGoal) {
    const context = getContextSafely();
    if (!context) return { success: false, error: 'Context unavailable' };
    if (isGenerating) return { success: false, error: 'Already generating' };

    const settings = getSettings(context);
    if (!settings.connectionProfileId) return { success: false, error: 'No connection profile selected' };
    if (!storyGoal || !storyGoal.trim()) return { success: false, error: 'Please enter a story goal' };

    isGenerating = true;
    try {
        const storyData = getStoryData(context);
        const messages = buildStepGenerationMessages(context, storyGoal.trim(), settings.numberOfSteps || 5);

        const apiMap = context.CONNECT_API_MAP?.[getProfileApi(context, settings.connectionProfileId)];
        const isChatCompletion = apiMap?.selected === 'openai';

        let result;
        if (typeof context.ConnectionManagerRequestService?.sendRequest === 'function') {
            result = await context.ConnectionManagerRequestService.sendRequest(
                settings.connectionProfileId,
                isChatCompletion ? messages : messages.map(m => `${m.role}: ${m.content}`).join('\n\n'),
                2048,
                { stream: false, extractData: true, includePreset: true },
            );
        } else {
            const quietPrompt = messages.map(m => m.content).join('\n\n');
            const response = await context.generateQuietPrompt({ quietPrompt, skipWIAN: true, responseLength: 2048 });
            result = { content: response, reasoning: '' };
        }

        const responseText = result?.content || result?.text || (typeof result === 'string' ? result : '');
        const steps = parseStepsFromResponse(responseText);

        if (!steps || steps.length === 0) {
            return { success: false, error: 'Failed to parse story steps from AI response. Try again.' };
        }

        storyData.storyGoal = storyGoal.trim();
        storyData.storySteps = steps;
        storyData.currentStepIndex = 0;
        storyData.stepsCompleted = steps.map(() => false);
        storyData.messagesSinceCheck = 0;
        storyData.aiMessagesSinceCheck = 0;
        storyData.storyComplete = false;
        storyData.isActive = true;

        saveStoryData(context);
        injectSteeringPrompt(context, settings);

        console.info('[StoryProgressExtended] Story steps generated.', { steps });
        return { success: true, data: storyData };
    } catch (error) {
        console.error('[StoryProgressExtended] Error generating story steps:', error);
        return { success: false, error: error.message || 'Unknown error occurred' };
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

    if (!storyData?.isActive || storyData.storyComplete) return { success: false, error: 'No active story' };
    if (!settings.connectionProfileId) return { success: false, error: 'No connection profile selected' };

    const currentStep = storyData.storySteps[storyData.currentStepIndex];
    if (!currentStep) return { success: false, error: 'No current step' };

    isChecking = true;
    try {
        const messages = buildCompletionCheckMessages(context, currentStep, storyData.currentStepIndex);

        const apiMap = context.CONNECT_API_MAP?.[getProfileApi(context, settings.connectionProfileId)];
        const isChatCompletion = apiMap?.selected === 'openai';

        let result;
        if (typeof context.ConnectionManagerRequestService?.sendRequest === 'function') {
            result = await context.ConnectionManagerRequestService.sendRequest(
                settings.connectionProfileId,
                isChatCompletion ? messages : messages.map(m => `${m.role}: ${m.content}`).join('\n\n'),
                512,
                { stream: false, extractData: true, includePreset: true },
            );
        } else {
            const quietPrompt = messages.map(m => m.content).join('\n\n');
            const response = await context.generateQuietPrompt({ quietPrompt, skipWIAN: true, responseLength: 512 });
            result = { content: response, reasoning: '' };
        }

        const responseText = result?.content || result?.text || (typeof result === 'string' ? result : '');
        const completionResult = parseCompletionFromResponse(responseText);

        if (completionResult.completed) {
            storyData.stepsCompleted[storyData.currentStepIndex] = true;
            const nextIndex = storyData.currentStepIndex + 1;
            if (nextIndex >= storyData.storySteps.length) {
                storyData.storyComplete = true;
                storyData.isActive = false;
                removeSteeringPrompt();
                console.info('[StoryProgressExtended] Story complete!');
            } else {
                storyData.currentStepIndex = nextIndex;
                if (settings.autoInject) injectSteeringPrompt(context, settings);
                console.info(`[StoryProgressExtended] Step completed. Moving to step ${nextIndex + 1}.`);
            }
        } else {
            if (settings.autoInject) injectSteeringPrompt(context, settings);
        }

        storyData.aiMessagesSinceCheck = 0;
        storyData.messagesSinceCheck = 0;
        saveStoryData(context);

        return { success: true, completed: completionResult.completed, reasoning: completionResult.reasoning, data: storyData };
    } catch (error) {
        console.error('[StoryProgressExtended] Error checking step completion:', error);
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
    const status = document.getElementById(PROFILE_STATUS_ID);
    if (status) status.textContent = text;
}

function renderConnectionProfileOptions(context, settings) {
    const select = document.getElementById(PROFILE_SELECT_ID);
    if (!select) return;

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

    const savedProfileExists = !settings.connectionProfileId || profiles.some(p => p.id === settings.connectionProfileId);
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

    // Enable row
    const enableRow = document.createElement('div');
    enableRow.className = 'story-progress-extended__row story-progress-extended__row--setting';
    const enableLabel = document.createElement('label');
    enableLabel.htmlFor = 'story_progress_extended_enabled';
    enableLabel.textContent = 'Enabled';
    const enableCheckbox = document.createElement('input');
    enableCheckbox.id = 'story_progress_extended_enabled';
    enableCheckbox.type = 'checkbox';
    enableCheckbox.className = 'story-progress-extended__checkbox';
    enableRow.append(enableLabel, enableCheckbox);

    // Profile row
    const profileRow = document.createElement('div');
    profileRow.className = 'story-progress-extended__row story-progress-extended__row--setting';
    const profileLabel = document.createElement('label');
    profileLabel.htmlFor = PROFILE_SELECT_ID;
    profileLabel.textContent = 'Connection Profile';
    const profileSelect = document.createElement('select');
    profileSelect.id = PROFILE_SELECT_ID;
    profileSelect.className = 'text_pole story-progress-extended__select';
    profileRow.append(profileLabel, profileSelect);
    const profileStatus = document.createElement('small');
    profileStatus.id = PROFILE_STATUS_ID;
    profileStatus.className = 'story-progress-extended__status';
    const profileWrapper = document.createElement('div');
    profileWrapper.append(profileRow, profileStatus);

    // Settings rows
    const settingsGroup = document.createElement('div');
    settingsGroup.className = 'story-progress-extended__settings-group';

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

    settingsGroup.append(stepsRow, intervalRow, autoInjectRow);

    // Divider
    const divider = document.createElement('hr');
    divider.className = 'story-progress-extended__divider';

    // Goal section
    const goalSection = document.createElement('div');
    goalSection.className = 'story-progress-extended__goal-section';
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
    const resetBtn = document.createElement('button');
    resetBtn.id = 'story_progress_extended_reset';
    resetBtn.className = 'menu_button story-progress-extended__btn story-progress-extended__btn--reset';
    resetBtn.textContent = 'Reset';
    buttonRow.append(generateBtn, resetBtn);
    goalSection.append(goalLabel, goalTextarea, buttonRow);

    // Progress section
    const progressSection = document.createElement('div');
    progressSection.id = 'story_progress_extended_progress';
    progressSection.className = 'story-progress-extended__progress';
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
    const statusText = document.createElement('small');
    statusText.id = 'story_progress_extended_progress_status';
    statusText.className = 'story-progress-extended__status';
    progressSection.append(progressHeader, progressBarContainer, stepsList, checkBtn, statusText);

    content.append(enableRow, profileWrapper, settingsGroup, divider, goalSection, progressSection);
    drawer.append(toggle, content);
    wrapper.append(drawer);

    return wrapper;
}

function renderStepList(storyData) {
    const stepsList = document.getElementById('story_progress_extended_steps_list');
    if (!stepsList) return;
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
        if (isCurrent) stepCard.classList.add('story-progress-extended__step-card--current');
        if (isCompleted) stepCard.classList.add('story-progress-extended__step-card--completed');
        if (storyData.storyComplete) stepCard.classList.add('story-progress-extended__step-card--story-done');

        const stepHeader = document.createElement('div');
        stepHeader.className = 'story-progress-extended__step-header';
        const stepNumber = document.createElement('span');
        stepNumber.className = 'story-progress-extended__step-number';
        if (isCompleted) {
            stepNumber.textContent = '\u2713';
            stepNumber.classList.add('story-progress-extended__step-number--done');
        } else {
            stepNumber.textContent = String(index + 1);
        }
        const stepLabel = document.createElement('span');
        stepLabel.className = 'story-progress-extended__step-label';
        if (isCurrent) {
            stepLabel.textContent = '\u25BA Current';
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
        if (!storyData.isActive && !storyData.storyComplete) stepTextarea.disabled = true;
        stepTextarea.addEventListener('change', onStepEdit);

        stepCard.append(stepHeader, stepTextarea);
        stepsList.append(stepCard);
    });
}

function onStepEdit(event) {
    const context = getContextSafely();
    if (!context) return;
    const textarea = event.target;
    const index = parseInt(textarea.dataset.stepIndex, 10);
    const storyData = getStoryData(context);
    if (!storyData?.storySteps) return;
    storyData.storySteps[index] = textarea.value;
    context.saveMetadataDebounced?.();
}

function updateProgressUI(storyData) {
    const fractionEl = document.getElementById('story_progress_extended_fraction');
    const barEl = document.getElementById('story_progress_extended_bar');
    const progressStatusEl = document.getElementById('story_progress_extended_progress_status');

    if (!storyData || !storyData.storySteps || storyData.storySteps.length === 0) {
        if (fractionEl) fractionEl.textContent = '';
        if (barEl) barEl.style.width = '0%';
        if (progressStatusEl) {
            if (storyData?.storyComplete) {
                progressStatusEl.textContent = 'Story complete!';
                progressStatusEl.classList.add('story-progress-extended__status--success');
            } else {
                progressStatusEl.textContent = '';
            }
        }
        renderStepList(storyData);
        const checkBtn = document.getElementById('story_progress_extended_check');
        if (checkBtn) checkBtn.disabled = true;
        return;
    }

    const completedCount = (storyData.stepsCompleted || []).filter(Boolean).length;
    const totalSteps = storyData.storySteps.length;
    const percentage = Math.round((completedCount / totalSteps) * 100);

    if (fractionEl) fractionEl.textContent = `${completedCount}/${totalSteps}`;
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
            progressStatusEl.textContent = `Active \u2014 Step ${storyData.currentStepIndex + 1}: ${(storyData.storySteps[storyData.currentStepIndex] || 'Unknown').substring(0, 60)}...`;
            progressStatusEl.classList.remove('story-progress-extended__status--success');
        } else {
            progressStatusEl.textContent = 'Inactive';
            progressStatusEl.classList.remove('story-progress-extended__status--success');
        }
    }

    renderStepList(storyData);
    const checkBtn = document.getElementById('story_progress_extended_check');
    if (checkBtn) checkBtn.disabled = !storyData.isActive || storyData.storyComplete;
}

function refreshUI() {
    const context = getContextSafely();
    if (!context) return;
    const settings = getSettings(context);
    const storyData = getStoryData(context);

    const enabledCheckbox = document.getElementById('story_progress_extended_enabled');
    if (enabledCheckbox) enabledCheckbox.checked = settings.enabled;
    const stepsInput = document.getElementById('story_progress_extended_steps');
    if (stepsInput) stepsInput.value = settings.numberOfSteps;
    const intervalInput = document.getElementById('story_progress_extended_interval');
    if (intervalInput) intervalInput.value = settings.checkInterval;
    const autoInjectCheckbox = document.getElementById('story_progress_extended_auto_inject');
    if (autoInjectCheckbox) autoInjectCheckbox.checked = settings.autoInject;
    const goalTextarea = document.getElementById('story_progress_extended_goal');
    if (goalTextarea && storyData) goalTextarea.value = storyData.storyGoal || '';

    renderConnectionProfileOptions(context, settings);
    updateProgressUI(storyData);

    const generateBtn = document.getElementById('story_progress_extended_generate');
    const resetBtn = document.getElementById('story_progress_extended_reset');
    if (generateBtn) generateBtn.disabled = !settings.connectionProfileId;
    if (resetBtn && storyData) resetBtn.disabled = !storyData.storyGoal && !storyData.isActive;
}

async function onGenerateClick() {
    const goalTextarea = document.getElementById('story_progress_extended_goal');
    const storyGoal = goalTextarea?.value?.trim();
    if (!storyGoal) { setStatus('Please enter a story goal first.'); return; }

    const generateBtn = document.getElementById('story_progress_extended_generate');
    if (generateBtn) { generateBtn.disabled = true; generateBtn.textContent = 'Generating...'; }

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

    if (generateBtn) { generateBtn.disabled = false; generateBtn.textContent = 'Generate Story'; }
    refreshUI();
}

async function onCheckClick() {
    const checkBtn = document.getElementById('story_progress_extended_check');
    if (checkBtn) { checkBtn.disabled = true; checkBtn.textContent = 'Checking...'; }

    try {
        const result = await checkStepCompletion();
        if (result.success) {
            if (result.completed) {
                setStatus('Step completed! Moving forward.');
            } else {
                setStatus(`Not yet completed: ${result.reasoning}`);
            }
        } else if (result.error !== 'Busy') {
            setStatus(`Check error: ${result.error}`);
        }
    } catch (error) {
        setStatus(`Check error: ${error.message}`);
    }

    if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Check Now'; }
    refreshUI();
}

function onResetClick() {
    resetStory();
    refreshUI();
    setStatus('Story progress reset.');
}

function getSettingsContainer() {
    return document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
}

function ensureSettingsPanel() {
    let panel = document.getElementById(SETTINGS_PANEL_ID);
    if (panel) return panel;

    const container = getSettingsContainer();
    if (!container) {
        console.warn('[StoryProgressExtended] Extensions settings container was not found.');
        return null;
    }

    panel = createSettingsPanel();
    container.append(panel);
    return panel;
}

function bindEvents(context, settings) {
    const enabledCheckbox = document.getElementById('story_progress_extended_enabled');
    if (enabledCheckbox && !enabledCheckbox.dataset.speBound) {
        enabledCheckbox.dataset.speBound = 'true';
        enabledCheckbox.addEventListener('change', () => {
            settings.enabled = enabledCheckbox.checked;
            context.saveSettingsDebounced?.();
            if (!settings.enabled) removeSteeringPrompt();
        });
    }

    const profileSelect = document.getElementById(PROFILE_SELECT_ID);
    if (profileSelect && !profileSelect.dataset.speBound) {
        profileSelect.dataset.speBound = 'true';
        profileSelect.addEventListener('change', () => {
            settings.connectionProfileId = profileSelect.value;
            context.saveSettingsDebounced?.();
            const generateBtn = document.getElementById('story_progress_extended_generate');
            if (generateBtn) generateBtn.disabled = !settings.connectionProfileId;
        });
    }

    const stepsInput = document.getElementById('story_progress_extended_steps');
    if (stepsInput && !stepsInput.dataset.speBound) {
        stepsInput.dataset.speBound = 'true';
        stepsInput.addEventListener('change', () => {
            let val = parseInt(stepsInput.value, 10);
            if (isNaN(val) || val < 1) val = 1;
            if (val > 20) val = 20;
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
            if (isNaN(val) || val < 1) val = 1;
            if (val > 20) val = 20;
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
            if (storyData) storyData.storyGoal = goalTextarea.value;
        });
    }
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

    const messageReceived = context.eventTypes.CHARACTER_MESSAGE_RENDERED;
    if (messageReceived) {
        context.eventSource.on(messageReceived, () => {
            onAIMessage().catch(err => console.error('[StoryProgressExtended] Error in AI message handler:', err));
        });
    }

    const chatChanged = context.eventTypes.CHAT_CHANGED;
    if (chatChanged) {
        context.eventSource.on(chatChanged, () => {
            onChatChanged();
            refreshUI();
        });
    }

    chatEventsBound = true;
}

// ==================== Init ====================

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
        console.info('[StoryProgressExtended] UI initialized successfully.');
        return true;
    } catch (err) {
        console.error('[StoryProgressExtended] Error during UI init:', err);
        return false;
    }
}

function scheduleUIInit(attempts) {
    if (uiInitialized) return;
    if (tryInitUI()) { uiInitialized = true; return; }
    if (attempts <= 0) { console.warn('[StoryProgressExtended] Could not init UI after all retries.'); return; }
    setTimeout(() => scheduleUIInit(attempts - 1), 500);
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
                if (!uiInitialized) scheduleUIInit(10);
            });
        }
    }

    scheduleUIInit(10);
}