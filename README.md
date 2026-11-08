# ai-context-editor

This UI gives you tools to manage context; every AI reply is the product of an edited conversation. Runs on your own machine, with threads stored in a local database and agents dispatched through your local Claude Code CLI.

Many tools automatically manage context for you as a token budget to keep an agent running, but this approach leads to summaries of summaries that degrade to a trite average. Here context is treated as more valuable than the AI answer itself. Iteratively refined context becomes more powerful as your thoughts become more accurately represented in it.

You can easily lay down reference material, constraints, and half-formed thoughts first, then ask AI once the context represents what you mean. Messages can be edited in place, pinned, cut, folded, and shared across threads through a library. Summarize multiple messages into one, with prompt control and manual final editing. The model always responds to the current state of the thread, not the true chronological reality. However, every AI response's provenance is retained even as the thread morphs. You can also branch threads at any point.

An agent can be launched from within the thread to run a task against your workspace. It can edit files, search code, or answer research questions, streaming its progress live. Its final output lands as a message you can pin, exclude, or build on.

All UI buttons have an explanation of their action, accessed by holding Alt (⌥ on Mac) and clicking.

## Setup

```bash
git clone https://github.com/MeganKern/ai-context-editor.git
cd ai-context-editor
```

### Option A: Docker (sandboxed)

Requires [Docker Desktop](https://docs.docker.com/get-docker/). Agents run inside the container.

```bash
./setup.sh
```

Your data is stored in `./data/` edit `.env` to change ports.

### Option B: Native (full access)

Requires [Node.js](https://nodejs.org/), PostgreSQL, and the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). Agents have full access to your filesystem.

```bash
./setup-local.sh
npm run dev
```

### Model calls

By default, model replies route through the bundled CLIProxy (which uses your Claude subscription). You can switch to [OpenRouter](https://openrouter.ai/) in the app settings (gear icon) by pasting an API key.