const MODULE_NAME = 'storyProgressExtended';

const defaultSettings = Object.freeze({
    enabled: true,
});

function getContextSafely() {
    if (!globalThis.SillyTavern || typeof globalThis.SillyTavern.getContext !== 'function') {
        console.warn('[StoryProgressExtended] SillyTavern context is not available yet.');
        return null;
    }

    return globalThis.SillyTavern.getContext();
}

function getSettings(context) {
    if (!context?.extensionSettings) {
        return structuredClone(defaultSettings);
    }

    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }

    const settings = context.extensionSettings[MODULE_NAME];

    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = defaultSettings[key];
        }
    }

    context.saveSettingsDebounced?.();

    return settings;
}

export function onActivate() {
    const context = getContextSafely();
    const settings = getSettings(context);

    console.info('[StoryProgressExtended] Activated.', { settings });
}
