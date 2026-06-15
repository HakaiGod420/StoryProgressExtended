import { buildStepGenerationMessages, buildCompletionCheckMessages, parseStepsFromResponse, parseCompletionFromResponse, getContextSafely } from './context-builder.js';
import { injectSteeringPrompt, removeSteeringPrompt } from './prompt-injector.js';

const MODULE_NAME = 'storyProgressExtended';
const STORY_METADATA_KEY = 'storyProgressExtended';

const defaultSettings = Object.freeze({
    enabled: true,
    connectionProfileId: '',
    numberOfSteps: 5,
    checkInterval: 5,
    autoInject: true,
});

let isGenerating = false;
let isChecking = false;

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

function getStoryData(context) {
    if (!context?.chatMetadata) {
        return null;
    }

    if (!context.chatMetadata[STORY_METADATA_KEY]) {
        context.chatMetadata[STORY_METADATA_KEY] = createDefaultStoryData();
    }

    return context.chatMetadata[STORY_METADATA_KEY];
}

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

function saveStoryData(context) {
    if (typeof context.saveMetadataDebounced === 'function') {
        context.saveMetadataDebounced();
    } else if (typeof context.saveMetadata === 'function') {
        context.saveMetadata();
    }
}

function getProfileApi(context, profileId) {
    const profiles = context.extensionSettings?.connectionManager?.profiles || [];
    const profile = profiles.find(p => p.id === profileId);
    return profile?.api;
}

async function generateStorySteps(storyGoal) {
    const context = getContextSafely();
    if (!context) {
        console.warn('[StoryProgressExtended] Cannot generate: SillyTavern context unavailable.');
        return { success: false, error: 'Context unavailable' };
    }

    if (isGenerating) {
        console.warn('[StoryProgressExtended] Already generating, skipping.');
        return { success: false, error: 'Already generating' };
    }

    const settings = getSettings(context);
    if (!settings.connectionProfileId) {
        console.warn('[StoryProgressExtended] No connection profile selected.');
        return { success: false, error: 'No connection profile selected' };
    }

    if (!storyGoal || !storyGoal.trim()) {
        console.warn('[StoryProgressExtended] No story goal provided.');
        return { success: false, error: 'Please enter a story goal' };
    }

    isGenerating = true;

    try {
        const storyData = getStoryData(context);
        const numberOfSteps = settings.numberOfSteps || 5;

        const messages = buildStepGenerationMessages(context, storyGoal.trim(), numberOfSteps);

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
            console.error('[StoryProgressExtended] Failed to parse steps from response:', responseText);
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

        console.info('[StoryProgressExtended] Story steps generated successfully.', { steps });
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
    if (!context) {
        return { success: false, error: 'Context unavailable' };
    }

    if (isChecking || isGenerating) {
        return { success: false, error: 'Busy' };
    }

    const settings = getSettings(context);
    const storyData = getStoryData(context);

    if (!storyData?.isActive || storyData.storyComplete) {
        return { success: false, error: 'No active story' };
    }

    if (!settings.connectionProfileId) {
        return { success: false, error: 'No connection profile selected' };
    }

    const currentStep = storyData.storySteps[storyData.currentStepIndex];
    if (!currentStep) {
        return { success: false, error: 'No current step' };
    }

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
                if (settings.autoInject) {
                    injectSteeringPrompt(context, settings);
                }
                console.info(`[StoryProgressExtended] Step ${storyData.currentStepIndex} completed. Moving to step ${nextIndex + 1}.`);
            }
        } else {
            if (settings.autoInject) {
                injectSteeringPrompt(context, settings);
            }
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
    if (!context) {
        return;
    }

    removeSteeringPrompt();

    if (context.chatMetadata) {
        context.chatMetadata[STORY_METADATA_KEY] = createDefaultStoryData();
        saveStoryData(context);
    }

    console.info('[StoryProgressExtended] Story data reset.');
}

function incrementMessageCounter(isAI) {
    const context = getContextSafely();
    if (!context) {
        return;
    }

    const storyData = getStoryData(context);
    if (!storyData?.isActive) {
        return;
    }

    storyData.messagesSinceCheck = (storyData.messagesSinceCheck || 0) + 1;
    if (isAI) {
        storyData.aiMessagesSinceCheck = (storyData.aiMessagesSinceCheck || 0) + 1;
    }

    saveStoryData(context);
}

async function onAIMessage() {
    const context = getContextSafely();
    if (!context) {
        return;
    }

    const settings = getSettings(context);
    const storyData = getStoryData(context);

    if (!storyData?.isActive || storyData.storyComplete || !settings.enabled) {
        return;
    }

    incrementMessageCounter(true);

    const checkInterval = settings.checkInterval || 5;
    if (storyData.aiMessagesSinceCheck >= checkInterval) {
        await checkStepCompletion();
    }
}

function onUserMessage() {
    const context = getContextSafely();
    if (!context) {
        return;
    }

    const storyData = getStoryData(context);
    if (!storyData?.isActive) {
        return;
    }

    incrementMessageCounter(false);
}

function onChatChanged() {
    removeSteeringPrompt();

    const context = getContextSafely();
    if (!context) {
        return;
    }

    const storyData = getStoryData(context);
    const settings = getSettings(context);

    if (storyData?.isActive && !storyData.storyComplete && settings.autoInject) {
        injectSteeringPrompt(context, settings);
    }
}

export {
    MODULE_NAME,
    defaultSettings,
    getSettings,
    getStoryData,
    createDefaultStoryData,
    STORY_METADATA_KEY,
    generateStorySteps,
    checkStepCompletion,
    resetStory,
    incrementMessageCounter,
    onAIMessage,
    onUserMessage,
    onChatChanged,
    isGenerating: () => isGenerating,
    isChecking: () => isChecking,
};