# Quill

Electron desktop app **Quill**: **Meeting Analyzer**, **Email Generator** (tone-aware replies), and **PPT Generator** (AI outline → slide preview → downloadable `.pptx` via [pptxgenjs](https://github.com/gitbrent/PptxGenJS)). OpenAI is called from the main process; your API key stays out of the renderer.

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

Without a valid key, AI actions show an error; you can still use **Sample** buttons to pre-fill inputs. **Download PPT** opens a save dialog and writes the file locally (no upload).

## Files

| File        | Role                                      |
| ----------- | ----------------------------------------- |
| `main.js`   | Window, OpenAI `fetch`, PPT build + save dialog |
| `preload.js`| `openaiChat`, `savePPTX` bridge           |
| `renderer.js` | Tabs, UI, prompts, JSON parsing       |
| `index.html`| Layout                                    |
| `styles.css`| Theme and layout                          |
