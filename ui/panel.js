import { SETTINGS_PANEL_ID, PROFILE_SELECT_ID, PROFILE_STATUS_ID } from '../lib/constants.js';

export function makeRow(labelText, htmlFor, children, options) {
    const row = document.createElement('div');
    row.className = 'story-progress-extended__row' + (options?.setting ? ' story-progress-extended__row--setting' : '');
    const label = document.createElement('label');
    label.htmlFor = htmlFor;
    label.textContent = labelText;
    row.append(label);
    for (const child of children) row.append(child);
    return row;
}

export function createSettingsPanel() {
    const wrapper = document.createElement('div');
    wrapper.id = SETTINGS_PANEL_ID;
    wrapper.className = 'story-progress-extended';

    const drawer = document.createElement('div');
    drawer.className = 'inline-drawer';

    const toggle = document.createElement('div');
    toggle.className = 'inline-drawer-toggle inline-drawer-header';
    const title = document.createElement('b');
    title.textContent = 'Story Progress Extended';
    const icon = document.createElement('div');
    icon.className = 'inline-drawer-icon fa-solid fa-circle-chevron-down down';
    toggle.append(title, icon);

    const content = document.createElement('div');
    content.className = 'inline-drawer-content';

    // Enable
    const enableCb = document.createElement('input');
    enableCb.id = 'story_progress_extended_enabled';
    enableCb.type = 'checkbox';
    enableCb.className = 'story-progress-extended__checkbox';
    content.append(makeRow('Enabled', enableCb.id, [enableCb], { setting: true }));

    // Profile
    const profileSelect = document.createElement('select');
    profileSelect.id = PROFILE_SELECT_ID;
    profileSelect.className = 'text_pole story-progress-extended__select';
    const profileStatus = document.createElement('small');
    profileStatus.id = PROFILE_STATUS_ID;
    profileStatus.className = 'story-progress-extended__status';
    const profileWrapper = document.createElement('div');
    profileWrapper.append(makeRow('Connection Profile', PROFILE_SELECT_ID, [profileSelect], { setting: true }), profileStatus);
    content.append(profileWrapper);

    // Number of Steps
    const stepsInput = document.createElement('input');
    stepsInput.id = 'story_progress_extended_steps';
    stepsInput.type = 'number';
    stepsInput.min = '1';
    stepsInput.max = '20';
    stepsInput.value = '5';
    stepsInput.className = 'text_pole story-progress-extended__number-input';
    content.append(makeRow('Number of Tasks', stepsInput.id, [stepsInput], { setting: true }));

    // Check Interval
    const intervalInput = document.createElement('input');
    intervalInput.id = 'story_progress_extended_interval';
    intervalInput.type = 'number';
    intervalInput.min = '1';
    intervalInput.max = '20';
    intervalInput.value = '5';
    intervalInput.className = 'text_pole story-progress-extended__number-input';
    const intervalHint = document.createElement('small');
    intervalHint.className = 'story-progress-extended__hint';
    intervalHint.textContent = 'AI messages between checks';
    const intervalWrapper = document.createElement('div');
    intervalWrapper.append(makeRow('Check Interval', intervalInput.id, [intervalInput], { setting: true }), intervalHint);
    content.append(intervalWrapper);

    // Max Attempts Per Task
    const maxAttemptsInput = document.createElement('input');
    maxAttemptsInput.id = 'story_progress_extended_max_attempts';
    maxAttemptsInput.type = 'number';
    maxAttemptsInput.min = '1';
    maxAttemptsInput.max = '50';
    maxAttemptsInput.value = '10';
    maxAttemptsInput.className = 'text_pole story-progress-extended__number-input';
    const maxAttemptsHint = document.createElement('small');
    maxAttemptsHint.className = 'story-progress-extended__hint';
    maxAttemptsHint.textContent = 'Auto-complete after N failed checks';
    const maxAttemptsWrapper = document.createElement('div');
    maxAttemptsWrapper.append(makeRow('Max Retry Count', maxAttemptsInput.id, [maxAttemptsInput], { setting: true }), maxAttemptsHint);
    content.append(maxAttemptsWrapper);

    // Auto Inject
    const autoInjectCb = document.createElement('input');
    autoInjectCb.id = 'story_progress_extended_auto_inject';
    autoInjectCb.type = 'checkbox';
    autoInjectCb.className = 'story-progress-extended__checkbox';
    content.append(makeRow('Auto-Inject Steering', autoInjectCb.id, [autoInjectCb], { setting: true }));

    // Generate Subtasks
    const subtasksCb = document.createElement('input');
    subtasksCb.id = 'story_progress_extended_subtasks';
    subtasksCb.type = 'checkbox';
    subtasksCb.className = 'story-progress-extended__checkbox';
    content.append(makeRow('Generate Subtasks', subtasksCb.id, [subtasksCb], { setting: true }));

    // Divider
    const divider = document.createElement('hr');
    divider.className = 'story-progress-extended__divider';
    content.append(divider);

    // Goal section
    const goalSection = document.createElement('div');
    goalSection.className = 'story-progress-extended__goal-section';

    const goalLabel = document.createElement('label');
    goalLabel.htmlFor = 'story_progress_extended_goal';
    goalLabel.textContent = 'Quest';
    goalLabel.className = 'story-progress-extended__goal-label';

    const goalTextarea = document.createElement('textarea');
    goalTextarea.id = 'story_progress_extended_goal';
    goalTextarea.className = 'text_pole story-progress-extended__goal-input';
    goalTextarea.placeholder = "Describe the character's quest \u2014 what is the character actively trying to achieve? (e.g., convince someone to go somewhere, obtain an item, make someone understand something)";
    goalTextarea.rows = 3;

    const buttonRow = document.createElement('div');
    buttonRow.className = 'story-progress-extended__button-row';

    const generateBtn = document.createElement('button');
    generateBtn.id = 'story_progress_extended_generate';
    generateBtn.className = 'menu_button story-progress-extended__btn story-progress-extended__btn--generate';
    generateBtn.textContent = 'Generate Tasks';

    const addMoreBtn = document.createElement('button');
    addMoreBtn.id = 'story_progress_extended_add_more';
    addMoreBtn.className = 'menu_button story-progress-extended__btn story-progress-extended__btn--add-more';
    addMoreBtn.textContent = 'Add Tasks';
    addMoreBtn.style.display = 'none';

    const resetBtn = document.createElement('button');
    resetBtn.id = 'story_progress_extended_reset';
    resetBtn.className = 'menu_button story-progress-extended__btn story-progress-extended__btn--reset';
    resetBtn.textContent = 'Reset';

    buttonRow.append(generateBtn, addMoreBtn, resetBtn);
    goalSection.append(goalLabel, goalTextarea, buttonRow);
    content.append(goalSection);

    // Progress section
    const progressSection = document.createElement('div');
    progressSection.id = 'story_progress_extended_progress';
    progressSection.className = 'story-progress-extended__progress';

    const progressHeader = document.createElement('div');
    progressHeader.className = 'story-progress-extended__progress-header';
    const progressTitle = document.createElement('b');
    progressTitle.textContent = 'Task Progress';
    const progressFraction = document.createElement('span');
    progressFraction.id = 'story_progress_extended_fraction';
    progressFraction.className = 'story-progress-extended__progress-fraction';
    progressHeader.append(progressTitle, progressFraction);

    const progressBarContainer = document.createElement('div');
    progressBarContainer.className = 'story-progress-extended__progress-bar-container';
    const progressBar = document.createElement('div');
    progressBar.id = 'story_progress_extended_bar';
    progressBar.className = 'story-progress-extended__progress-bar';
    progressBar.style.width = '0%';
    progressBarContainer.append(progressBar);

    const goalBanner = document.createElement('div');
    goalBanner.id = 'story_progress_extended_goal_banner';
    goalBanner.className = 'story-progress-extended__goal-banner';
    goalBanner.style.display = 'none';

    const tasksList = document.createElement('div');
    tasksList.id = 'story_progress_extended_steps_list';
    tasksList.className = 'story-progress-extended__steps-list';

    const checkBtn = document.createElement('button');
    checkBtn.id = 'story_progress_extended_check';
    checkBtn.className = 'menu_button story-progress-extended__btn story-progress-extended__btn--check';
    checkBtn.textContent = 'Check Now';

    const skipBtn = document.createElement('button');
    skipBtn.id = 'story_progress_extended_skip';
    skipBtn.className = 'menu_button story-progress-extended__btn story-progress-extended__btn--skip';
    skipBtn.textContent = 'Skip \u2192';

    const backBtn = document.createElement('button');
    backBtn.id = 'story_progress_extended_back';
    backBtn.className = 'menu_button story-progress-extended__btn story-progress-extended__btn--back';
    backBtn.textContent = '\u25C0 Back';

    const actionRow = document.createElement('div');
    actionRow.className = 'story-progress-extended__action-row';
    actionRow.append(backBtn, checkBtn, skipBtn);

    const filterRow = document.createElement('div');
    filterRow.className = 'story-progress-extended__filter-row';

    const filterBtn = document.createElement('button');
    filterBtn.id = 'story_progress_extended_filter';
    filterBtn.className = 'menu_button story-progress-extended__btn story-progress-extended__btn--filter';
    filterBtn.textContent = 'Hide Completed';
    filterRow.append(filterBtn);

    const spinner = document.createElement('div');
    spinner.id = 'story_progress_extended_spinner';
    spinner.className = 'story-progress-extended__spinner';
    spinner.style.display = 'none';
    const spinnerDot = document.createElement('span');
    spinnerDot.className = 'story-progress-extended__spinner-dot';
    const spinnerText = document.createElement('span');
    spinnerText.id = 'story_progress_extended_spinner_text';
    spinnerText.className = 'story-progress-extended__spinner-text';
    spinnerText.textContent = 'Processing...';
    spinner.append(spinnerDot, spinnerText);

    const statusText = document.createElement('small');
    statusText.id = 'story_progress_extended_progress_status';
    statusText.className = 'story-progress-extended__status';

    progressSection.append(progressHeader, progressBarContainer, goalBanner, filterRow, tasksList, actionRow, spinner, statusText);
    content.append(progressSection);

    drawer.append(toggle, content);
    wrapper.append(drawer);
    return wrapper;
}
