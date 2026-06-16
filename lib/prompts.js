import { MAX_CHAT_MESSAGES_FOR_CONTEXT } from './constants.js';

export function getCharacterContext(context) {
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

export function getChatContext(context, maxMessages) {
    const chat = context.chat;
    if (!Array.isArray(chat) || chat.length === 0) return '';
    const limit = maxMessages || MAX_CHAT_MESSAGES_FOR_CONTEXT;
    return chat.slice(-limit).map(msg => {
        const sender = msg.is_user ? context.name1 : msg.name || context.name2;
        return `${sender}: ${msg.mes || ''}`;
    }).join('\n');
}

export function getChatContextRange(context, startIndex, maxMessages) {
    const chat = context.chat;
    if (!Array.isArray(chat) || chat.length === 0) return '';
    const start = Math.max(0, startIndex);
    const limit = maxMessages || MAX_CHAT_MESSAGES_FOR_CONTEXT;
    const end = Math.min(start + limit, chat.length);
    if (start >= chat.length) return '';
    return chat.slice(start, end).map(msg => {
        const sender = msg.is_user ? context.name1 : msg.name || context.name2;
        return `${sender}: ${msg.mes || ''}`;
    }).join('\n');
}

export function buildTaskGenerationMessages(context, storyGoal, numberOfSteps) {
    const characterContext = getCharacterContext(context);
    const chatContext = getChatContext(context);

    const systemContent = `You are a task planning assistant for interactive roleplay. You analyze the CURRENT conversation and break down what the character must actively DO to achieve their quest.

You must respond ONLY with valid JSON, nothing else:
{"tasks": [{"title": "Short Task Title", "description": "What the character must actively do to complete this task"}], "goalCompletionSentence": "One sentence describing what it looks like when the quest has been fully achieved"}

Rules:
- The Goal is a CHARACTER QUEST — something the character is actively trying to achieve. Not a passive story plot, but an objective the character personally pursues.
- Examples of good quest-style tasks: "Convince the guard to let them pass", "Lead the group to the village", "Make the person understand the danger", "Obtain the key from the merchant", "Reach the mountain pass"
- Do NOT describe passive storyline events like "A storm arrives" or "The kingdom falls". Every task must be something the character DOES.
- NEVER reference the user. Tasks are about the character and the world around them, not about a player.
- First, understand what is happening RIGHT NOW in the conversation. What is the character doing this moment?
- Task 1 MUST be a seamless next objective from the current situation. If the character is talking to someone, Task 1 starts from that conversation. NO time skips, no teleporting.
- Each subsequent task flows naturally from the previous one with NO time gaps. One objective leads directly into the next.
- Generate exactly ${numberOfSteps} tasks.
- When all tasks are complete, the character's quest must be fulfilled — the objective described in the goal must have been achieved.
- Write exactly one goalCompletionSentence that describes the final state: what is true now that the character's quest is achieved?`;

    let userContent = '';
    if (chatContext) userContent += `--- Current Conversation (this is where the story is right now) ---\n${chatContext}\n\n`;
    if (characterContext) userContent += `--- Character Context ---\n${characterContext}\n\n`;
    userContent += `Character's Quest: ${storyGoal}\n\n`;
    userContent += `Generate ${numberOfSteps} tasks that the character must actively do to achieve this quest, with no time skips between them. Task 1 must be a seamless next objective from what is happening right now. Include the goalCompletionSentence. Respond with JSON only.`;

    return [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
    ];
}

export function buildAddMoreTasksMessages(context, storyGoal, existingSteps, numberOfNewSteps, customGoal) {
    const characterContext = getCharacterContext(context);
    const chatContext = getChatContext(context);

    const tasksSummary = existingSteps.map((s, i) => `${i + 1}. ${s.title}: ${s.description}`).join('\n');

    const systemContent = `You are a task planning assistant for interactive roleplay. Your job is to generate additional character-driven objectives that continue an existing quest plan.

You must respond ONLY with valid JSON, nothing else:
{"tasks": [{"title": "Short Task Title", "description": "What the character must actively do to complete this task"}]}

Rules:
- Each task must be something the CHARACTER actively does — not a passive story event. Think in quests: "convince X", "reach Y", "obtain Z", "make A understand".
- NEVER reference the user. Tasks are about the character and the world.
- Tasks are strictly sequential: each starts exactly where the prior one ends, with NO time skips or gaps
- Generate exactly ${numberOfNewSteps} tasks that follow naturally from the existing list
- The title should be 2-6 words summarizing the objective
- The description should be 1-3 sentences explaining what the character must do
- The final task should lead to the same quest outcome as the original goal`;

    let userContent = `Character's Quest: ${storyGoal}\n\nExisting Tasks:\n${tasksSummary}\n\n`;
    if (customGoal) userContent += `--- Additional Goal ---\n${customGoal}\n\n`;
    if (characterContext) userContent += `--- Character Context ---\n${characterContext}\n\n`;
    if (chatContext) userContent += `--- Recent Chat History ---\n${chatContext}\n\n`;
    userContent += `Generate ${numberOfNewSteps} more tasks that continue sequentially from the existing ones with no time skips${customGoal ? ' and achieve the additional goal' : ''}. Respond with JSON only.`;

    return [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
    ];
}

export function buildCompletionCheckMessages(context, task, currentStepIndex, checkStartIndex, goalCompletionSentence) {
    const characterContext = getCharacterContext(context);
    const chatContext = (checkStartIndex >= 0)
        ? getChatContextRange(context, checkStartIndex)
        : getChatContext(context);

    const systemContent = `You evaluate whether a specific task has been completed in a roleplay conversation.

You must respond ONLY with valid JSON:
{"completed": true/false, "reasoning": "Brief explanation"}

A task is "completed" only when the character has clearly and fully accomplished the described objective. Partial progress does NOT count.

You are also given a quest completion reference sentence describing what the desired end state looks like. Use this only to understand where the tasks are heading — the check is still on whether the specific CURRENT task has been accomplished.`;

    let userContent = `Task ${currentStepIndex + 1} — "${task.title}"\nObjective: ${task.description}\n\n`;
    if (goalCompletionSentence) userContent += `Quest Completion Reference: ${goalCompletionSentence}\n\n`;
    if (characterContext) userContent += `--- Character Context ---\n${characterContext}\n\n`;
    userContent += `--- Recent Chat History ---\n${chatContext}\n\n`;
    userContent += `Has the task "${task.title}" been fully accomplished? Answer with JSON only.`;

    return [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
    ];
}

export function buildSteeringPromptText(task, currentStepIndex, totalSteps, storyGoal, remainingSteps) {
    const lines = [
        `[Story Progress \u2014 Task ${currentStepIndex + 1}/${totalSteps}: "${task.title}"]`,
        `Quest: ${storyGoal}`,
        `Current Task: ${task.title} \u2014 ${task.description}`,
    ];

    if (remainingSteps && remainingSteps.length > 0) {
        lines.push('');
        lines.push('Upcoming Tasks:');
        for (const rs of remainingSteps) {
            lines.push(`\u2192 ${rs.title}: ${rs.description}`);
        }
    }

    lines.push('');
    lines.push('You MUST actively steer the roleplay toward completing the current task. The character must pursue this objective \u2014 it is a required quest objective, not optional guidance. Do not ignore it.');

    return lines.join('\n');
}

export function buildGoalsSummaryText(task, currentStepIndex, totalSteps, storyGoal) {
    return [
        `[Story Progress \u2014 Quest]`,
        `Quest: ${storyGoal}`,
        `Current Task (${currentStepIndex + 1}/${totalSteps}): ${task.title} \u2014 ${task.description}`,
    ].join('\n');
}
