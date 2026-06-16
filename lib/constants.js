export const MODULE_NAME = 'storyProgressExtended';
export const STORY_METADATA_KEY = 'storyProgressExtended';
export const SETTINGS_PANEL_ID = 'story_progress_extended_settings';
export const PROFILE_SELECT_ID = 'story_progress_extended_connection_profile';
export const PROFILE_STATUS_ID = 'story_progress_extended_profile_status';
export const EXTENSION_PROMPT_KEY = MODULE_NAME;
export const EXTENSION_PROMPT_KEY_GOALS = MODULE_NAME + '_goals';
export const PROMPT_POSITION_BEFORE = 1;
export const PROMPT_POSITION_AFTER = 2;
export const PROMPT_DEPTH = 2;
export const PROMPT_DEPTH_BEFORE = 0;
export const PROMPT_ROLE_SYSTEM = 0;
export const MAX_CHAT_MESSAGES_FOR_CONTEXT = 20;

export const CONNECTION_PROFILE_EVENTS = [
    'CONNECTION_PROFILE_CREATED',
    'CONNECTION_PROFILE_UPDATED',
    'CONNECTION_PROFILE_DELETED',
];

export const defaultSettings = Object.freeze({
    enabled: true,
    connectionProfileId: '',
    numberOfSteps: 5,
    checkInterval: 5,
    autoInject: true,
    maxAttemptsPerTask: 10,
});

export const state = {
    isGenerating: false,
    isChecking: false,
    chatEventsBound: false,
    profileEventsBound: false,
    uiInitialized: false,
    currentPage: 0,
    showIncompleteOnly: false,
};

export const TASKS_PER_PAGE = 3;
