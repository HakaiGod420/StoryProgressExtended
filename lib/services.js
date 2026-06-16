import {
    EXTENSION_PROMPT_KEY,
    EXTENSION_PROMPT_KEY_GOALS,
    PROMPT_POSITION_BEFORE,
    PROMPT_POSITION_AFTER,
    PROMPT_DEPTH,
    PROMPT_DEPTH_BEFORE,
    PROMPT_ROLE_SYSTEM,
} from './constants.js';

import { getContextSafely, getStoryData } from './data.js';
import { buildGoalsSummaryText, buildSteeringPromptText } from './prompts.js';

export function getProfileApi(context, profileId) {
    const profiles = context.extensionSettings?.connectionManager?.profiles || [];
    return profiles.find(p => p.id === profileId)?.api;
}

export function getConnectionManagerState(context) {
    const em = context?.extensionSettings;
    const cm = em?.connectionManager;
    const isDisabled = Array.isArray(em?.disabledExtensions) && em.disabledExtensions.includes('connection-manager');
    return {
        available: Boolean(cm) && !isDisabled,
        isDisabled,
        profiles: Array.isArray(cm?.profiles) ? cm.profiles : [],
    };
}

export function getProfileGroupLabel(context, profile) {
    const m = context?.CONNECT_API_MAP?.[profile?.api];
    if (m?.selected === 'openai') return 'Chat Completion';
    if (m?.selected === 'textgenerationwebui') return 'Text Completion';
    return 'Other Profiles';
}

export function getSortedProfilesByGroup(context, profiles) {
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

export function showToast(title, body, type) {
    if (typeof toastr !== 'undefined') {
        const method = type === 'success' ? 'success' : type === 'error' ? 'error' : 'info';
        toastr[method](body, title, { timeOut: 4000 });
    } else {
        console.log(`[StoryProgressExtended] [${type}] ${title}: ${body}`);
    }
}

export function injectSteeringPrompt(context, settings) {
    if (!context || typeof context.setExtensionPrompt !== 'function') return;
    if (!settings?.enabled || !settings?.autoInject) { removeSteeringPrompt(); return; }

    const storyData = getStoryData(context);
    if (!storyData?.isActive || storyData.storyComplete) { removeSteeringPrompt(); return; }

    const task = storyData.storySteps[storyData.currentStepIndex];
    if (!task) { removeSteeringPrompt(); return; }

    const remainingSteps = storyData.storySteps.slice(storyData.currentStepIndex + 1, storyData.currentStepIndex + 3).map(s => ({ title: s.title, description: s.description }));

    const goalsText = buildGoalsSummaryText(task, storyData.currentStepIndex, storyData.storySteps.length, storyData.storyGoal);
    const steeringText = buildSteeringPromptText(task, storyData.currentStepIndex, storyData.storySteps.length, storyData.storyGoal, remainingSteps);

    try {
        context.setExtensionPrompt(EXTENSION_PROMPT_KEY_GOALS, goalsText, PROMPT_POSITION_BEFORE, PROMPT_DEPTH_BEFORE, true, PROMPT_ROLE_SYSTEM);
        context.setExtensionPrompt(EXTENSION_PROMPT_KEY, steeringText, PROMPT_POSITION_AFTER, PROMPT_DEPTH, true, PROMPT_ROLE_SYSTEM);
    } catch (err) {
        console.error('[StoryProgressExtended] Failed to inject steering prompt:', err);
    }
}

export function removeSteeringPrompt() {
    const ctx = globalThis.SillyTavern?.getContext?.() || null;
    if (!ctx || typeof ctx.setExtensionPrompt !== 'function') return;
    try { ctx.setExtensionPrompt(EXTENSION_PROMPT_KEY_GOALS, '', 0, 0, false, 0); } catch { /* */ }
    try { ctx.setExtensionPrompt(EXTENSION_PROMPT_KEY, '', 0, 0, false, 0); } catch { /* */ }
}
