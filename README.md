# Quill

Electron desktop app **Quill**: **Meeting Analyzer** (summary, actions, owners, deadlines, follow-up email) and **Email Generator** (tone-aware replies). Calls the OpenAI API from the main process using your API key.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Add your OpenAI API key (project root):

```bash
cp .env.example .env
```

Edit `.env` and set `OPENAI_API_KEY`.

3. Start the app:

```bash
npm start
```

Without a valid key, actions show a clear error; you can still use **Load Sample Meeting** / **Load Sample Email** to pre-fill inputs.

## Files

| File        | Role                                      |
| ----------- | ----------------------------------------- |
| `main.js`   | Electron window, OpenAI `fetch`, IPC      |
| `preload.js`| Secure `electronAPI.openaiChat` bridge    |
| `renderer.js` | Tabs, UI, prompts, JSON parsing       |
| `index.html`| Layout                                    |
| `styles.css`| Theme and layout                          |
