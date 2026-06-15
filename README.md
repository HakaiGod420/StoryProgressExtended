# Story Progress Extended

A SillyTavern extension that turns your narrative goals into actionable task lists, tracks progress per-chat, auto-checks completion, and steers the AI toward your story objectives.

## Features

- **Goal-to-Task Generation** — Enter a narrative goal and let AI break it down into concrete, sequential tasks with titles and descriptions
- **Per-Chat Progress Tracking** — Each chat maintains its own task list and progress state; starting a new chat requires regenerating
- **Automatic Completion Checking** — Every N AI messages, the extension evaluates whether the current task has been achieved in the conversation
- **Smart Overlapping Windows** — Completion checks use sliding message windows (e.g., messages 1-3, then 3-6, then 6-9) so the AI evaluator only sees fresh context each time
- **Dual Context Injection** — Goals are injected before the chat history (so the AI sees them first) and a steering reminder is injected after (so the AI doesn't drift)
- **Pre-Send Goal Injection** — Goals are re-injected before every user message via the `MESSAGE_SENT` event, guaranteeing the AI always has context
- **Manual Skip** — Skip the current task and move to the next without waiting for AI verification
- **Add More Tasks** — Append additional tasks to an existing plan without regenerating from scratch
- **Delete Tasks** — Remove individual tasks from the list with automatic index adjustment
- **Pagination** — Long task lists are paginated (5 per page) with prev/next navigation
- **Toast Notifications** — Non-blocking notifications via SillyTavern's built-in toastr (top-center, auto-dismiss)
- **Connection Profile Support** — Uses SillyTavern's Connection Manager for API calls; falls back to `generateQuietPrompt` if unavailable

## Installation

### Via SillyTavern Extension Manager

1. Open SillyTavern
2. Go to **Extensions** > **Install from URL**
3. Paste the repository URL:
   ```
   https://github.com/StoryProgressExtended/StoryProgressExtended
   ```
4. Click **Install**
5. Restart or reload SillyTavern

### Manual Installation

1. Clone or download this repository into your SillyTavern third-party extensions directory:
   ```
   public/scripts/extensions/third-party/StoryProgressExtended/
   ```
   Or for user-scoped installations:
   ```
   data/<user-handle>/extensions/StoryProgressExtended/
   ```
2. Restart or reload SillyTavern
3. Open **Extensions** and confirm **Story Progress Extended** appears in the extension manager

## Usage

### Basic Workflow

1. **Open the extension panel** — Find "Story Progress Extended" in the Extensions settings drawer
2. **Select a connection profile** — Choose the API profile to use for task generation and completion checks
3. **Enter a narrative goal** — Describe what should happen in the story (e.g., "The hero must find the lost artifact and return it to the village elder")
4. **Click "Generate Tasks"** — The AI breaks your goal into sequential tasks
5. **Chat normally** — The extension automatically:
   - Injects the current task/goal into the AI context before each message
   - Checks completion every N AI messages (configurable)
   - Advances to the next task when the current one is achieved
6. **When all tasks are complete** — You'll see a success toast and the steering prompt is removed

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Enabled** | On | Master toggle for the extension |
| **Connection Profile** | — | Which API profile to use for AI calls |
| **Number of Tasks** | 5 | How many tasks to generate from your goal |
| **Check Interval** | 5 | AI messages between automatic completion checks |
| **Auto-Inject Steering** | On | Automatically inject goal/task context into the AI prompt |

### Buttons

| Button | Description |
|--------|-------------|
| **Generate Tasks** | Generates a new task list from the narrative goal |
| **Add Tasks** | Appends N more tasks to the existing list (uses "Number of Tasks" setting) |
| **Reset** | Clears all tasks and progress for the current chat |
| **Check Now** | Manually trigger a completion check for the current task |
| **Skip →** | Skip the current task and advance to the next (no AI verification) |

### Task Cards

Each task card shows:
- **Task number** — Sequential position in the list
- **Status label** — `▸ Current`, `Done`, or `Pending`
- **Title** — Editable (bold input)
- **Description** — Editable (textarea)
- **Delete button** (✕) — Remove the task from the list

### Pagination

When there are more than 5 tasks, pagination controls appear below the task list:
- `◀ Prev` / `Next ▶` buttons
- `Page X/Y` indicator

### Goal Banner

A colored banner at the top of the progress section shows:
- The narrative goal text
- `Goal:` label (blue) while active
- `Goal Achieved:` label (green) when all tasks are complete

## How It Works

### Context Injection

The extension uses two injection points in SillyTavern's prompt assembly:

1. **Before Chat History** (position 1) — A brief goals summary:
   ```
   [Story Progress — Narrative Goal]
   Goal: The hero must find the lost artifact
   Current Task (2/5): Reach the Ancient Temple — Travel through the forest to reach the temple entrance
   ```
   This ensures the AI knows the objective before reading the conversation.

2. **After Chat History** (position 2) — A detailed steering reminder:
   ```
   [Story Progress — Task 2/5: "Reach the Ancient Temple"]
   Overall Goal: The hero must find the lost artifact
   Current Task: Reach the Ancient Temple — Travel through the forest to reach the temple entrance

   Upcoming Tasks:
   → Solve the Temple Puzzle: Navigate the puzzle chambers
   → Retrieve the Artifact: Find and take the artifact
   → Return to Village: Bring the artifact back to the elder

   You MUST actively steer the roleplay toward completing the current task...
   ```
   This reminds the AI of the full roadmap right before generating a response.

### Completion Checking

- Every N AI messages (configurable), the extension sends the recent chat history to the AI and asks whether the current task has been completed
- **Overlapping windows**: Instead of re-evaluating all messages each time, the extension checks only new messages since the last check, with an overlap of ~50% of the check interval for context continuity
- First check: evaluates the full conversation
- Subsequent checks: evaluates messages from `lastCheckedIndex - overlap` to current
- The evaluator AI responds with `{"completed": true/false, "reasoning": "..."}`

### Data Storage

- **Settings**: Stored in `context.extensionSettings.storyProgressExtended` (global, persists across chats)
- **Task data**: Stored in `context.chatMetadata.storyProgressExtended` (per-chat, resets on new chat)
- **No server-side storage**: All data lives in SillyTavern's existing data structures

## Troubleshooting

### Extension doesn't appear in the extension list

- Check the browser console for `[StoryProgressExtended]` messages
- Ensure the folder is named correctly and contains `manifest.json`, `index.js`, and `style.css`
- Try hard-refreshing SillyTavern (Ctrl+Shift+R)

### "No connection profile selected" error

- Install and configure the **Connection Manager** extension (ships with SillyTavern)
- Create a connection profile in Connection Manager settings
- Select it in the Story Progress Extended settings

### Tasks not advancing

- Ensure **Auto-Inject Steering** is enabled
- Check that the **Check Interval** isn't too high (try 3 for faster checks)
- Use **Check Now** to manually trigger a completion check
- Check the browser console for API errors

### Goals not appearing in AI context

- Ensure **Auto-Inject Steering** is enabled
- The extension injects via `setExtensionPrompt` — this appears in the prompt context but not as a visible chat bubble
- Check that the extension is **Enabled** in settings

## Requirements

- SillyTavern 1.12+ (with extension support)
- A connection profile configured in Connection Manager (or SillyTavern's built-in `generateQuietPrompt` as fallback)
- `toastr` for toast notifications (included in SillyTavern)

## License

MIT
