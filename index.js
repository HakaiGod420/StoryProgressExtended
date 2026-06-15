import { getSettings, getStoryData, onAIMessage, onChatChanged } from './story-manager.js';
import { initUI, refreshUI } from './ui-manager.js';
import { injectSteeringPrompt } from './prompt-injector.js';

const CONNECTION_PROFILE_EVENTS = [
    'CONNECTION_PROFILE_CREATED',
    'CONNECTION_PROFILE_UPDATED',
    'CONNECTION_PROFILE_DELETED',
];

const CHAT_EVENTS = {
    MESSAGE_RECEIVED: 'CHARACTER_MESSAGE_RENDERED',
    MESSAGE_SENT: 'USER_MESSAGE_RENDERED',
    CHAT_CHANGED: 'CHAT_CHANGED',
};

function getContextSafely() {
    if (!globalThis.SillyTavern || typeof globalThis.SillyTavern.getContext !== 'function') {
        console.warn('[StoryProgressExtended] SillyTavern context is not available yet.');
        return null;
    }

    return globalThis.SillyTavern.getContext();
}

function bindChatEvents(context) {
    if (!context?.eventSource || !context?.eventTypes) {
        console.warn('[StoryProgressExtended] Event source not available.');
        return;
    }

    if (context.eventSource.__speChatEventsBound) {
        return;
    }

    const messageReceived = context.eventTypes[CHAT_EVENTS.MESSAGE_RECEIVED];
    if (messageReceived) {
        context.eventSource.on(messageReceived, () => {
            onAIMessage().catch(err => {
                console.error('[StoryProgressExtended] Error in AI message handler:', err);
            });
        });
    }

    const chatChanged = context.eventTypes[CHAT_EVENTS.CHAT_CHANGED];
    if (chatChanged) {
        context.eventSource.on(chatChanged, () => {
            onChatChanged();
            refreshUI();
        });
    }

    context.eventSource.__speChatEventsBound = true;
    console.info('[StoryProgressExtended] Chat events bound.');
}

function bindConnectionProfileEvents(context) {
    if (!context?.eventSource || !context?.eventTypes || context.eventSource.__speProfileEventsBound) {
        return;
    }

    for (const eventName of CONNECTION_PROFILE_EVENTS) {
        const eventType = context.eventTypes[eventName];
        if (!eventType) {
            continue;
        }

        context.eventSource.on(eventType, () => {
            const settings = getSettings(context);
            refreshUI();
        });
    }

    context.eventSource.__speProfileEventsBound = true;
}

export function onActivate() {
    const context = getContextSafely();
    if (!context) {
        console.warn('[StoryProgressExtended] Context not available. Will retry on next load.');
        return;
    }

    const settings = getSettings(context);

    initUI(context, settings);
    bindChatEvents(context);
    bindConnectionProfileEvents(context);

    const storyData = getStoryData(context);
    if (storyData?.isActive && !storyData.storyComplete && settings.autoInject) {
        injectSteeringPrompt(context, settings);
    }

    console.info('[StoryProgressExtended] Activated.', { settings, storyData });
}