import { MODULE_NAME, STORY_METADATA_KEY, defaultSettings } from './constants.js';

export function getContextSafely() {
    if (!globalThis.SillyTavern || typeof globalThis.SillyTavern.getContext !== 'function') {
        return null;
    }
    return globalThis.SillyTavern.getContext();
}

export function getSettings(context) {
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

export function createDefaultStoryData() {
    return {
        storyGoal: '',
        storySteps: [],
        currentStepIndex: 0,
        stepsCompleted: [],
        messagesSinceCheck: 0,
        aiMessagesSinceCheck: 0,
        lastCheckedMsgIndex: -1,
        checkAttempts: 0,
        storyComplete: false,
        isActive: false,
        goalCompletionSentence: '',
    };
}

export function migrateStoryData(storyData) {
    if (!storyData?.storySteps) return storyData;
    let migrated = false;
    if (storyData.lastCheckedMsgIndex === undefined) {
        storyData.lastCheckedMsgIndex = -1;
        migrated = true;
    }
    if (storyData.checkAttempts === undefined) {
        storyData.checkAttempts = 0;
        migrated = true;
    }
    if (storyData.goalCompletionSentence === undefined) {
        storyData.goalCompletionSentence = '';
        migrated = true;
    }
    storyData.storySteps = storyData.storySteps.map((step, i) => {
        if (typeof step === 'string') {
            migrated = true;
            return { title: `Task ${i + 1}`, description: step, npcs: [], subtasks: [] };
        }
        if (!step.title) {
            migrated = true;
            step.title = `Task ${i + 1}`;
        }
        if (!step.description) {
            migrated = true;
            step.description = step.title;
        }
        if (!Array.isArray(step.npcs)) {
            migrated = true;
            step.npcs = [];
        }
        if (!Array.isArray(step.subtasks)) {
            migrated = true;
            step.subtasks = [];
        }
        return step;
    });
    return storyData;
}

export function getStoryData(context) {
    if (!context?.chatMetadata) return null;
    if (!context.chatMetadata[STORY_METADATA_KEY]) {
        context.chatMetadata[STORY_METADATA_KEY] = createDefaultStoryData();
    }
    return migrateStoryData(context.chatMetadata[STORY_METADATA_KEY]);
}

export function saveStoryData(context) {
    if (typeof context.saveMetadataDebounced === 'function') {
        context.saveMetadataDebounced();
    } else if (typeof context.saveMetadata === 'function') {
        context.saveMetadata();
    }
}
