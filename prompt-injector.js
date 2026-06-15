import { buildSteeringPromptText } from './context-builder.js';

const MODULE_NAME = 'storyProgressExtended';
const STORY_METADATA_KEY = 'storyProgressExtended';

const EXTENSION_PROMPT_KEY = MODULE_NAME;

const PROMPT_POSITION_AFTER = 2;
const PROMPT_DEPTH = 2;
const PROMPT_ROLE_SYSTEM = 0;

function getStoryDataForPrompt(context) {
    if (!context?.chatMetadata) {
        return null;
    }

    return context.chatMetadata[STORY_METADATA_KEY] || null;
}

function injectSteeringPrompt(context, settings) {
    if (!context || typeof context.setExtensionPrompt !== 'function') {
        console.warn('[StoryProgressExtended] setExtensionPrompt not available.');
        return;
    }

    if (!settings?.enabled) {
        removeSteeringPrompt();
        return;
    }

    if (!settings?.autoInject) {
        removeSteeringPrompt();
        return;
    }

    const storyData = getStoryDataForPrompt(context);
    if (!storyData?.isActive || storyData.storyComplete) {
        removeSteeringPrompt();
        return;
    }

    const currentIndex = storyData.currentStepIndex;
    const currentStep = storyData.storySteps[currentIndex];

    if (!currentStep) {
        removeSteeringPrompt();
        return;
    }

    const steeringText = buildSteeringPromptText(
        currentStep,
        currentIndex,
        storyData.storySteps.length,
        storyData.storyGoal,
    );

    try {
        context.setExtensionPrompt(
            EXTENSION_PROMPT_KEY,
            steeringText,
            PROMPT_POSITION_AFTER,
            PROMPT_DEPTH,
            true,
            PROMPT_ROLE_SYSTEM,
        );
        console.info('[StoryProgressExtended] Steering prompt injected.');
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
    } catch {
        // Silently fail
    }
}

export {
    injectSteeringPrompt,
    removeSteeringPrompt,
    EXTENSION_PROMPT_KEY,
};