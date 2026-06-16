import { STORY_METADATA_KEY, state } from './constants.js';
import { getContextSafely, getSettings, getStoryData, saveStoryData, createDefaultStoryData } from './data.js';
import { buildTaskGenerationMessages, buildAddMoreTasksMessages, buildCompletionCheckMessages } from './prompts.js';
import { parseTasksFromResponse, parseCompletionFromResponse } from './parsers.js';
import { getProfileApi, injectSteeringPrompt, removeSteeringPrompt, showToast } from './services.js';
import { refreshUI } from '../ui/app.js';

export async function generateStorySteps(storyGoal) {
    const context = getContextSafely();
    if (!context) return { success: false, error: 'Context unavailable' };

    const settings = getSettings(context);
    if (!settings.connectionProfileId) return { success: false, error: 'No connection profile selected' };
    if (!storyGoal?.trim()) return { success: false, error: 'Please describe the quest' };

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
        const parsed = parseTasksFromResponse(responseText);

        if (!parsed || !parsed.tasks || parsed.tasks.length === 0) {
            return { success: false, error: 'Failed to parse tasks from AI response. Try again.' };
        }

        const tasks = parsed.tasks;
        const completionSentence = parsed.completionSentence || '';

        storyData.storyGoal = storyGoal.trim();
        storyData.storySteps = tasks;
        storyData.goalCompletionSentence = completionSentence;
        storyData.currentStepIndex = 0;
        storyData.stepsCompleted = tasks.map(() => false);
        storyData.messagesSinceCheck = 0;
        storyData.aiMessagesSinceCheck = 0;
        storyData.lastCheckedMsgIndex = -1;
        storyData.checkAttempts = 0;
        storyData.storyComplete = false;
        storyData.isActive = true;

        saveStoryData(context);
        injectSteeringPrompt(context, settings);

        return { success: true, data: storyData };
    } catch (error) {
        console.error('[StoryProgressExtended] Error generating tasks:', error);
        return { success: false, error: error.message || 'Unknown error' };
    }
}

export async function addMoreStorySteps(numberOfNewSteps, customGoal) {
    const context = getContextSafely();
    if (!context) return { success: false, error: 'Context unavailable' };

    const settings = getSettings(context);
    if (!settings.connectionProfileId) return { success: false, error: 'No connection profile selected' };

    const storyData = getStoryData(context);
    if (!storyData?.isActive) return { success: false, error: 'No active story' };

    try {
        const messages = buildAddMoreTasksMessages(context, storyData.storyGoal, storyData.storySteps, numberOfNewSteps, customGoal);

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
        const parsed = parseTasksFromResponse(responseText);

        if (!parsed || !parsed.tasks || parsed.tasks.length === 0) {
            return { success: false, error: 'Failed to parse new tasks from AI response. Try again.' };
        }

        const tasks = parsed.tasks;

        storyData.storySteps.push(...tasks);
        for (let i = 0; i < tasks.length; i++) storyData.stepsCompleted.push(false);
        if (storyData.storyComplete) {
            storyData.storyComplete = false;
            storyData.isActive = true;
        }

        saveStoryData(context);
        if (settings.autoInject) injectSteeringPrompt(context, settings);

        return { success: true, data: storyData };
    } catch (error) {
        console.error('[StoryProgressExtended] Error adding more tasks:', error);
        return { success: false, error: error.message || 'Unknown error' };
    }
}

export async function checkStepCompletion() {
    const context = getContextSafely();
    if (!context) return { success: false, error: 'Context unavailable' };

    const settings = getSettings(context);
    const storyData = getStoryData(context);

    if (!storyData?.isActive || storyData.storyComplete) return { success: false, error: 'No active tasks' };
    if (!settings.connectionProfileId) return { success: false, error: 'No connection profile' };

    const task = storyData.storySteps[storyData.currentStepIndex];
    if (!task) return { success: false, error: 'No current task' };

    showToast('Checking...', `Checking if "${task.title}" is complete...`, 'info');

    try {
        const overlapSize = Math.max(2, Math.floor((settings.checkInterval || 5) / 2));
        const lastChecked = storyData.lastCheckedMsgIndex ?? -1;
        const checkStartIndex = (lastChecked >= 0) ? Math.max(0, lastChecked - overlapSize) : -1;

        const messages = buildCompletionCheckMessages(context, task, storyData.currentStepIndex, checkStartIndex, storyData.goalCompletionSentence);

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
            storyData.checkAttempts = 0;
            storyData.stepsCompleted[storyData.currentStepIndex] = true;
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
                showToast('Task Completed', `"${task.title}" is done. Next: "${nextTask.title}"`, 'success');
            }
        } else {
            storyData.checkAttempts = (storyData.checkAttempts || 0) + 1;
            const maxAttempts = settings.maxAttemptsPerTask || 10;
            if (storyData.checkAttempts >= maxAttempts) {
                storyData.checkAttempts = 0;
                storyData.stepsCompleted[storyData.currentStepIndex] = true;
                const next = storyData.currentStepIndex + 1;
                if (next >= storyData.storySteps.length) {
                    storyData.storyComplete = true;
                    storyData.isActive = false;
                    removeSteeringPrompt();
                    showToast('Force Completed', `"${task.title}" auto-completed after ${maxAttempts} checks. All tasks finished.`, 'info');
                } else {
                    storyData.currentStepIndex = next;
                    if (settings.autoInject) injectSteeringPrompt(context, settings);
                    showToast('Force Completed', `"${task.title}" auto-completed after ${maxAttempts} checks.`, 'info');
                }
            } else {
                if (settings.autoInject) injectSteeringPrompt(context, settings);
                showToast('Not Yet Done', `"${task.title}" \u2014 ${cr.reasoning} (${storyData.checkAttempts}/${maxAttempts})`, 'info');
            }
        }

        storyData.aiMessagesSinceCheck = 0;
        storyData.messagesSinceCheck = 0;
        storyData.lastCheckedMsgIndex = (context.chat || []).length;
        saveStoryData(context);
        refreshUI();

        return { success: true, completed: cr.completed, reasoning: cr.reasoning, data: storyData };
    } catch (error) {
        console.error('[StoryProgressExtended] Error checking task:', error);
        return { success: false, error: error.message || 'Unknown error' };
    }
}

export function resetStory() {
    const context = getContextSafely();
    if (!context) return;
    removeSteeringPrompt();
    if (context.chatMetadata) {
        context.chatMetadata[STORY_METADATA_KEY] = createDefaultStoryData();
        saveStoryData(context);
    }
}

export function incrementMessageCounter(isAI) {
    const context = getContextSafely();
    if (!context) return;
    const storyData = getStoryData(context);
    if (!storyData?.isActive) return;
    storyData.messagesSinceCheck = (storyData.messagesSinceCheck || 0) + 1;
    if (isAI) storyData.aiMessagesSinceCheck = (storyData.aiMessagesSinceCheck || 0) + 1;
    saveStoryData(context);
}

export async function onAIMessage() {
    const context = getContextSafely();
    if (!context) return;
    if (state.isChecking || state.isGenerating) return;
    const settings = getSettings(context);
    const storyData = getStoryData(context);
    if (!storyData?.isActive || storyData.storyComplete || !settings.enabled) return;

    incrementMessageCounter(true);

    const checkInterval = settings.checkInterval || 5;
    if (storyData.aiMessagesSinceCheck >= checkInterval) {
        await checkStepCompletion();
    }
}

export function onChatChanged() {
    removeSteeringPrompt();
    const context = getContextSafely();
    if (!context) return;
    const storyData = getStoryData(context);
    const settings = getSettings(context);
    if (storyData?.isActive && !storyData.storyComplete && settings.autoInject) {
        injectSteeringPrompt(context, settings);
    }
}
