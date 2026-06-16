export function parseTasksFromResponse(responseText) {
    if (!responseText || typeof responseText !== 'string') return null;
    let cleaned = responseText.trim();

    const jsonMatch = cleaned.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
    let parsed = null;
    if (jsonMatch) {
        cleaned = jsonMatch[0];
    }

    let completionSentence = '';

    try {
        parsed = JSON.parse(cleaned);
    } catch {
        const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            try { parsed = JSON.parse(arrayMatch[0]); } catch { /* fall through */ }
        }
    }

    if (parsed) {
        if (typeof parsed.goalCompletionSentence === 'string' && parsed.goalCompletionSentence.trim()) {
            completionSentence = parsed.goalCompletionSentence.trim();
        }
        let tasks = null;
        if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
            tasks = parsed.tasks;
        } else if (Array.isArray(parsed) && parsed.length > 0) {
            tasks = parsed;
        }
        if (tasks) {
            return {
                tasks: tasks.map((t, i) => {
                    if (typeof t === 'string') return { title: `Task ${i + 1}`, description: t, npcs: [] };
                    return {
                        title: t.title || `Task ${i + 1}`,
                        description: t.description || t.title || `Task ${i + 1}`,
                        npcs: Array.isArray(t.npcs) ? t.npcs.filter(n => typeof n === 'string') : [],
                    };
                }),
                completionSentence,
            };
        }
    }

    const lines = cleaned.split('\n').filter(l => l.trim().length > 0);
    const taskLines = lines.filter(l => /^\d+[\.\):]\s/.test(l.trim()));
    if (taskLines.length > 0) {
        const tasks = taskLines.map((l, i) => {
            const text = l.trim().replace(/^\d+[\.\):]\s*/, '');
            return { title: `Task ${i + 1}`, description: text, npcs: [] };
        });
        return { tasks, completionSentence: '' };
    }

    if (lines.length > 1) {
        const tasks = lines.filter(l => l.trim().length > 5).map((l, i) => ({
            title: `Task ${i + 1}`,
            description: l.trim(),
            npcs: [],
        }));
        return { tasks, completionSentence: '' };
    }
    return null;
}

export function parseCompletionFromResponse(responseText) {
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
