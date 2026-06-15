const MODULE_NAME = 'storyProgressExtended';

const MAX_CHAT_MESSAGES_FOR_CONTEXT = 30;

function getContextSafely() {
    if (!globalThis.SillyTavern || typeof globalThis.SillyTavern.getContext !== 'function') {
        return null;
    }
    return globalThis.SillyTavern.getContext();
}

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

    if (data.name) {
        parts.push(`Character Name: ${data.name}`);
    }
    if (data.description) {
        parts.push(`Character Description: ${data.description}`);
    }
    if (data.personality) {
        parts.push(`Character Personality: ${data.personality}`);
    }
    if (data.scenario) {
        parts.push(`Scenario: ${data.scenario}`);
    }
    if (data.first_mes) {
        parts.push(`First Message: ${data.first_mes}`);
    }
    if (data.mes_example) {
        parts.push(`Example Messages: ${data.mes_example}`);
    }
    if (data.system_prompt) {
        parts.push(`Character System Prompt: ${data.system_prompt}`);
    }
    if (data.post_history_instructions) {
        parts.push(`Post-History Instructions: ${data.post_history_instructions}`);
    }

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
    const charName = context.name2 || 'the character';

    let systemContent = `You are a story planning assistant. Your task is to break down a story goal into sequential story steps for a roleplay scenario.

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

    if (characterContext) {
        userContent += `--- Character Context ---\n${characterContext}\n\n`;
    }

    if (chatContext) {
        userContent += `--- Recent Chat History ---\n${chatContext}\n\n`;
    }

    userContent += `Based on the above context, generate ${numberOfSteps} sequential story steps that will progress toward the story goal: "${storyGoal}". Respond with JSON only.`;

    const messages = [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
    ];

    return messages;
}

function buildCompletionCheckMessages(context, currentStepDescription, currentStepIndex) {
    const characterContext = getCharacterContext(context);
    const chatContext = getChatContext(context);
    const charName = context.name2 || 'the character';

    let systemContent = `You are a story analysis assistant. Your task is to determine if a specific story step has been accomplished in the ongoing roleplay conversation.

IMPORTANT: You must respond ONLY with valid JSON in the following format:
{"completed": true/false, "reasoning": "Brief explanation of why the step is or isn't completed"}

A step is "completed" when the narrative events described in the step have clearly occurred or been achieved in the conversation. Partial progress does not count as completed.`;

    let userContent = `Current Story Step (${currentStepIndex + 1}): ${currentStepDescription}\n\n`;

    if (characterContext) {
        userContent += `--- Character Context ---\n${characterContext}\n\n`;
    }

    userContent += `--- Recent Chat History ---\n${chatContext}\n\n`;

    userContent += `Has the story step "${currentStepDescription}" been accomplished in the conversation above? Respond with JSON only.`;

    const messages = [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
    ];

    return messages;
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
    if (jsonMatch) {
        cleaned = jsonMatch[0];
    }

    try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed.steps) && parsed.steps.length > 0 && typeof parsed.steps[0] === 'string') {
            return parsed.steps;
        }
    } catch {
        // Try to extract array
        const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            try {
                const arr = JSON.parse(arrayMatch[0]);
                if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'string') {
                    return arr;
                }
            } catch {
                // Fall through to text parsing
            }
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
    if (jsonMatch) {
        cleaned = jsonMatch[0];
    }

    try {
        const parsed = JSON.parse(cleaned);
        if (typeof parsed.completed === 'boolean') {
            return {
                completed: parsed.completed,
                reasoning: parsed.reasoning || 'No reasoning provided',
            };
        }
    } catch {
        // Fall through
    }

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

export {
    getContextSafely,
    getCharacterContext,
    getChatContext,
    buildStepGenerationMessages,
    buildCompletionCheckMessages,
    buildSteeringPromptText,
    parseStepsFromResponse,
    parseCompletionFromResponse,
    MAX_CHAT_MESSAGES_FOR_CONTEXT,
};