# AI Context Editor

This is a context editor for working with AI models. Every AI reply is the product of an edited conversation. Runs on your own machine, with threads stored in a local database.

Many tools automatically manage context for you as a token budget to keep an agent running, but this approach leads to summaries of summaries that degrade to a trite average. Here context is treated as more valuable than the AI answer itself. Iteratively refined context becomes more powerful as your thoughts become more accurately represented in it.

You can easily add reference material, constraints, and half-formed thoughts first, then ask AI once the context represents what you mean. Messages can be edited in place, pinned, cut, folded, and shared across threads through a library. Summarize multiple messages into one, with prompt control and manual final editing. The model always responds to the current state of the thread, not the true chronological reality. However, every AI response's provenance is retained even as the thread morphs. You can also branch threads at any point.

Additionally, the difference between what the AI first wrote and what you kept, excluded, or reworded is itself a record of your judgment and voice. This data is retained across the thread's life. It is data about you that can serve as raw material for any future individualized model alignment use cases.

To add agent functionality connect Claude Code CLI, this defaults to off in settings. An agent can be launched from within the thread to run a task against your workspace. It can edit files, search code, or answer research questions, streaming its progress live. Its final output lands as a message you can pin, exclude, or build on.

All UI buttons have an explanation of their action, accessed by holding Alt (⌥ on Mac) and clicking.

## Setup

Requires [Node.js](https://nodejs.org/) 22 or newer.
```bash
git clone https://github.com/MeganKern/ai-context-editor
cd ai-context-editor
npm install
npm run build        # builds the web client
npm run server       # serves the app at http://localhost:3710
```

Run the two dev servers in separate terminals:

```bash
npm run server       # the API on :3710
npm run client       # Vite on :3711, proxying the API — open this one
```

### Agents (optional)

Agents run [Claude Code](https://docs.anthropic.com/en/docs/claude-code) on your own computer, against a workspace folder, and can read and change files. They are **off by default**. To enable them, install the Claude Code CLI and start the server with `DESK_AGENTS=1`. 