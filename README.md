# Story Progress Extended

A SillyTavern extension that turns character quests into actionable task lists, tracks progress per-chat, auto-checks completion, and steers the AI toward the quest objective.

## Features

- **Quest-to-Task Generation** — Describe a character's quest and let AI break it down into concrete, sequential objectives
- **Character-Driven Tasks** — Every task is something the character actively does (e.g., "Convince the guard", "Reach the village"), not a passive story event
- **Per-Chat Progress Tracking** — Each chat maintains its own task list and progress state
- **Automatic Completion Checking** — Every N AI messages, the extension evaluates whether the current task has been achieved
- **Smart Overlapping Windows** — Completion checks use sliding message windows so the evaluator only sees fresh context each time
- **Dual Context Injection** — Quest summary is injected before chat history and a steering reminder after, so the AI never loses sight of the objective
- **Internal Completion Sentence** — At task generation time, the AI produces a hidden one-sentence description of quest completion used for internal verification
- **Notification on Every Check** — Shows "Checking..." toast at the start of every completion check, plus the result (always visible, never silent)
- **Manual Skip** — Skip the current task and move to the next without waiting for AI verification
- **Manual Go Back** — Go back to the previous task and re-open it as pending
- **Add More Tasks** — Append additional objectives to an existing plan without regenerating from scratch
- **Delete Tasks** — Remove individual tasks from the list with automatic index adjustment
- **AI-Generated Subtasks** — Optional guidance hints for each task: enable "Generate Subtasks" and the AI will produce 3-5 sub-steps per task as a mini-guide. Subtasks are hidden by default and expandable per task card
- **Filter: Hide Completed** — Toggle to show only incomplete tasks (3 per page)
- **Auto-Complete Stuck Tasks** — If a task fails N checks (configurable), it is force-completed and the story advances
- **Pagination** — Long task lists are paginated (3 per page) with prev/next navigation
- **Toast Notifications** — Non-blocking notifications via SillyTavern's built-in toastr
- **Connection Profile Support** — Uses SillyTavern's Connection Manager for API calls; falls back to `generateQuietPrompt`
- **Version 1.0.0** — Now with subtask generation support

## Installation

### Via SillyTavern Extension Manager

1. Open SillyTavern
2. Go to **Extensions** > **Install from URL**
3. Paste the repository URL
4. Click **Install**

### Manual Installation

1. Clone this repository into:
   ```
   public/scripts/extensions/third-party/StoryProgressExtended/
   ```
2. Restart SillyTavern

## Usage

### Basic Workflow

1. **Open the extension panel** — "Story Progress Extended" in the Extensions settings drawer
2. **Select a connection profile** — Choose the API profile for task generation and completion checks
3. **Describe the character's quest** — What is the character actively trying to achieve? (e.g., "Convince the village elder to share the secret location of the ancient ruins")
4. **Click "Generate Tasks"** — The AI breaks the quest into sequential objectives the character must accomplish
5. **Chat normally** — The extension automatically:
   - Injects the current task/quest into the AI context before each message
   - Checks completion every N AI messages
   - Advances to the next task when the current one is achieved
6. **When the quest is complete** — A success toast appears and steering prompts are removed

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Enabled** | On | Master toggle |
| **Connection Profile** | — | API profile for AI calls |
| **Number of Tasks** | 5 | How many tasks to generate |
| **Check Interval** | 5 | AI messages between automatic checks |
| **Auto-Inject Steering** | On | Inject quest/task context into the AI prompt |
| **Generate Subtasks** | Off | Generate guiding sub-steps for each task |
| **Max Retry Count** | 10 | Auto-complete after N failed checks |

### Buttons

| Button | Description |
|--------|-------------|
| **Generate Tasks** | Generate a new task list from the quest description |
| **Add Tasks** | Append more objectives to the existing list |
| **Reset** | Clear all tasks and progress |
| **Back** | Go back to the previous task |
| **Check Now** | Manually trigger a completion check |
| **Skip** | Skip current task, no AI verification |
| **Hide Completed** | Toggle filter to show only incomplete tasks |

### Task Cards

Each task card shows: task number, status (`▸ Current`, `Done`, `Pending`), editable title and description, NPC chips, and a delete button. When subtasks are generated, an expandable `▸ Subtasks (N)` toggle appears — click to reveal the guiding sub-steps.

### Quest Banner

A colored banner at the top of the progress section shows:
- The quest text
- `Quest:` label while active
- `Quest Achieved:` label when complete

## How It Works

### Context Injection

Two injection points in SillyTavern's prompt assembly:

1. **Before Chat History** — Brief quest summary:
   ```
   [Story Progress — Quest]
   Quest: Convince the elder to share the secret
   Current Task (2/5): Find the Elder — Locate the village elder in the market square
   ```

2. **After Chat History** — Detailed steering reminder with upcoming tasks and mandatory pursuit directive.

### Completion Checking

- After every N AI messages, recent chat history is sent to AI asking whether the current task has been done
- Overlapping message windows for context continuity
- Auto-complete stuck tasks after N failed checks
- Shows "Checking..." notification at the start of every check, plus result

### Data Storage

- **Settings**: `context.extensionSettings.storyProgressExtended` (global)
- **Task data**: `context.chatMetadata.storyProgressExtended` (per-chat)

## Project Structure

```
StoryProgressExtended/
├── index.js              # Entry point — re-exports onActivate
├── manifest.json          # SillyTavern extension manifest
├── style.css              # All styling
├── init.js                # Extension initialization + onActivate
├── lib/
│   ├── constants.js       # All constants, defaults, shared mutable state
│   ├── data.js            # Context access + settings + story data CRUD
│   ├── prompts.js         # Context extractors + 5 prompt builders
│   ├── parsers.js         # AI response parsers (pure functions)
│   ├── services.js        # Toast, connection profiles, prompt injector
│   └── story-manager.js   # Core async business logic
└── ui/
    ├── panel.js           # DOM factory — createSettingsPanel
    └── app.js             # Rendering, event handlers, event binding, refreshUI
```

## Troubleshooting

### Extension doesn't appear
- Check browser console for `[StoryProgressExtended]` messages
- Ensure the folder contains all required files
- Hard-refresh SillyTavern (Ctrl+Shift+R)

### "No connection profile selected"
- Install/configure the Connection Manager extension
- Create a connection profile and select it in the extension settings

### Tasks not advancing
- Verify Auto-Inject Steering is enabled
- Try a lower Check Interval (e.g., 3)
- Use Check Now to manually trigger a verification
- Check browser console for API errors

## Requirements

- SillyTavern 1.12+
- Connection Manager extension (or built-in `generateQuietPrompt` fallback)

## License

MIT
