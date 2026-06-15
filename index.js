const MODULE_NAME = 'storyProgressExtended';
const SETTINGS_PANEL_ID = 'story_progress_extended_settings';
const PROFILE_SELECT_ID = 'story_progress_extended_connection_profile';
const PROFILE_STATUS_ID = 'story_progress_extended_profile_status';

const defaultSettings = Object.freeze({
    enabled: true,
    connectionProfileId: '',
});

const CONNECTION_PROFILE_EVENTS = [
    'CONNECTION_PROFILE_CREATED',
    'CONNECTION_PROFILE_UPDATED',
    'CONNECTION_PROFILE_DELETED',
];

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

function getConnectionManagerState(context) {
    const extensionSettings = context?.extensionSettings;
    const connectionManager = extensionSettings?.connectionManager;
    const disabledExtensions = extensionSettings?.disabledExtensions;
    const isDisabled = Array.isArray(disabledExtensions) && disabledExtensions.includes('connection-manager');
    const profiles = Array.isArray(connectionManager?.profiles) ? connectionManager.profiles : [];

    return {
        available: Boolean(connectionManager) && !isDisabled,
        isDisabled,
        profiles,
    };
}

function getProfileGroupLabel(context, profile) {
    const apiMap = context?.CONNECT_API_MAP?.[profile?.api];

    if (apiMap?.selected === 'openai') {
        return 'Chat Completion';
    }

    if (apiMap?.selected === 'textgenerationwebui') {
        return 'Text Completion';
    }

    return 'Other Profiles';
}

function getSortedProfilesByGroup(context, profiles) {
    const groups = new Map();

    for (const profile of profiles) {
        if (!profile?.id || !profile?.name) {
            continue;
        }

        const label = getProfileGroupLabel(context, profile);
        const groupProfiles = groups.get(label) ?? [];
        groupProfiles.push(profile);
        groups.set(label, groupProfiles);
    }

    for (const groupProfiles of groups.values()) {
        groupProfiles.sort((a, b) => a.name.localeCompare(b.name));
    }

    return groups;
}

function createSettingsPanel() {
    const wrapper = document.createElement('div');
    wrapper.id = SETTINGS_PANEL_ID;
    wrapper.className = 'story-progress-extended inline-drawer';

    const toggle = document.createElement('div');
    toggle.className = 'inline-drawer-toggle inline-drawer-header';

    const title = document.createElement('b');
    title.textContent = 'Story Progress Extended';

    const icon = document.createElement('div');
    icon.className = 'inline-drawer-icon fa-solid fa-circle-chevron-down down';

    toggle.append(title, icon);

    const content = document.createElement('div');
    content.className = 'inline-drawer-content';

    const row = document.createElement('div');
    row.className = 'story-progress-extended__row flex-container alignItemsCenter';

    const label = document.createElement('label');
    label.htmlFor = PROFILE_SELECT_ID;
    label.textContent = 'Connection Profile';

    const select = document.createElement('select');
    select.id = PROFILE_SELECT_ID;
    select.className = 'text_pole flex1';

    row.append(label, select);

    const status = document.createElement('small');
    status.id = PROFILE_STATUS_ID;
    status.className = 'story-progress-extended__status';

    content.append(row, status);
    wrapper.append(toggle, content);

    return wrapper;
}

function getSettingsContainer() {
    return document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
}

function ensureSettingsPanel() {
    let panel = document.getElementById(SETTINGS_PANEL_ID);

    if (panel) {
        return panel;
    }

    const container = getSettingsContainer();
    if (!container) {
        console.warn('[StoryProgressExtended] Extensions settings container was not found.');
        return null;
    }

    panel = createSettingsPanel();
    container.append(panel);

    return panel;
}

function setStatus(text) {
    const status = document.getElementById(PROFILE_STATUS_ID);

    if (status) {
        status.textContent = text;
    }
}

function renderConnectionProfileOptions(context, settings) {
    /** @type {HTMLSelectElement|null} */
    const select = document.getElementById(PROFILE_SELECT_ID);
    if (!select) {
        return;
    }

    const { available, isDisabled, profiles } = getConnectionManagerState(context);

    select.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Select a Connection Profile';
    select.append(defaultOption);

    if (!available) {
        select.disabled = true;
        setStatus(isDisabled ? 'Connection Manager is disabled.' : 'Connection Manager is unavailable.');
        return;
    }

    select.disabled = false;

    const savedProfileExists = !settings.connectionProfileId || profiles.some(profile => profile.id === settings.connectionProfileId);
    if (!savedProfileExists) {
        settings.connectionProfileId = '';
        context.saveSettingsDebounced?.();
    }

    const groupedProfiles = getSortedProfilesByGroup(context, profiles);
    for (const [label, groupProfiles] of groupedProfiles.entries()) {
        const group = document.createElement('optgroup');
        group.label = label;

        for (const profile of groupProfiles) {
            const option = document.createElement('option');
            option.value = profile.id;
            option.textContent = profile.name;
            group.append(option);
        }

        select.append(group);
    }

    select.value = settings.connectionProfileId || '';
    setStatus(profiles.length ? 'Used by Story Progress Extended only.' : 'No connection profiles found.');
}

function bindSettingsPanel(context, settings) {
    /** @type {HTMLSelectElement|null} */
    const select = document.getElementById(PROFILE_SELECT_ID);
    if (!select || select.dataset.storyProgressExtendedBound === 'true') {
        return;
    }

    select.dataset.storyProgressExtendedBound = 'true';
    select.addEventListener('change', () => {
        settings.connectionProfileId = select.value;
        context.saveSettingsDebounced?.();
        console.info('[StoryProgressExtended] Connection profile preference saved.', {
            connectionProfileId: settings.connectionProfileId,
        });
    });
}

function bindConnectionProfileEvents(context, settings) {
    if (!context?.eventSource || !context?.eventTypes || context.eventSource.__storyProgressExtendedProfileEventsBound) {
        return;
    }

    for (const eventName of CONNECTION_PROFILE_EVENTS) {
        const eventType = context.eventTypes[eventName];
        if (!eventType) {
            continue;
        }

        context.eventSource.on(eventType, () => renderConnectionProfileOptions(context, settings));
    }

    context.eventSource.__storyProgressExtendedProfileEventsBound = true;
}

function renderSettings(context, settings) {
    if (!ensureSettingsPanel()) {
        return;
    }

    bindSettingsPanel(context, settings);
    bindConnectionProfileEvents(context, settings);
    renderConnectionProfileOptions(context, settings);
}

export function onActivate() {
    const context = getContextSafely();
    const settings = getSettings(context);

    if (context) {
        renderSettings(context, settings);
    }

    console.info('[StoryProgressExtended] Activated.', { settings });
}
