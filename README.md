# Quill

Quill is an Electron desktop app with three AI workflows:

- **Meeting Analyzer**: extracts summary, actions, owners, and deadlines.
- **Email Generator**: drafts tone-aware replies.
- **PPT Generator**: turns notes into slide outlines and exports `.pptx` files.

OpenAI calls run from the Electron main process, so the API key is not exposed to the renderer.

## Features

- **Tabbed workspace** for Meeting, Email, and PPT flows.
- **Sample content** buttons for quick testing.
- **Custom instruction boxes** for each task to guide output.
- **Theme support**: Light, Dark, and System.
- **PowerPoint controls**:
  - Template selection: `Modern Gradient`, `Minimal Clean`, `Dark Pro`
  - Slide count selection: `3` to `12`
  - Preview before export
  - Local `.pptx` save via system dialog (no cloud upload)

## Tech Stack

- [Electron](https://www.electronjs.org/)
- [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat)
- [PptxGenJS](https://github.com/gitbrent/PptxGenJS)
- [dotenv](https://github.com/motdotla/dotenv)

## Prerequisites

- Node.js 18+ (recommended current LTS)
- npm
- OpenAI API key

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
cp .env.example .env
```

On Windows PowerShell, use:

```powershell
Copy-Item .env.example .env
```

3. Edit `.env`:

```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
```

`OPENAI_MODEL` is optional. If omitted, Quill uses `gpt-4o-mini`.

4. Start the app:

```bash
npm start
```

## Build Windows Installer (Demo Share)

To create a distributable Windows installer (`.exe`):

```bash
npm install
npm run dist
```

Build output is written to the `dist` folder.

Notes:

- The installer does not bundle your local `.env` file by default.
- On the demo machine, set `OPENAI_API_KEY` in environment variables if AI features are needed.

## Model Configuration

The app currently targets OpenAI's Chat Completions endpoint. You can switch models with `OPENAI_MODEL` in `.env`.

Examples:

- `gpt-4o-mini` (default, low cost)
- `gpt-4o`
- `gpt-4.1`
- `gpt-4.1-mini`

## Using the App

### Meeting Analyzer

1. Paste transcript.
2. Optionally add custom analysis instructions.
3. Click **Analyze Meeting**.
4. Optionally click **Follow-up Email** for an email draft from extracted actions.

### Email Generator

1. Paste incoming email/ticket.
2. Choose tone (`Professional`, `Friendly`, `Assertive`).
3. Optionally add custom reply instructions.
4. Click **Generate Reply**.

### PPT Generator

1. Paste outline or source content.
2. Select template style.
3. Select desired slide count.
4. Click **Generate Slides**.
5. Review preview and click **Download PPT** to save locally.

## Project Structure

| File | Purpose |
| --- | --- |
| `main.js` | Electron main process, OpenAI proxy, PPT generation/export |
| `preload.js` | Safe bridge (`openaiChat`, `savePPTX`) to renderer |
| `renderer.js` | UI logic, prompt construction, parsing, button handlers |
| `index.html` | App layout and controls |
| `styles.css` | Visual design, responsive layout, theming |
| `.env.example` | Example environment variable template |

## Security Notes

- Keep `.env` private and never commit real keys.
- API calls are made from the main process.
- Files are saved locally through OS save dialog.

## Troubleshooting

- **"Missing OPENAI_API_KEY"**: ensure `.env` exists and has a valid key.
- **Model/API errors**: verify model access on your OpenAI account and billing status.
- **Could not parse AI response as JSON**: retry generation; prompts enforce JSON but model output can occasionally drift.
- **PPT export not saving**: ensure you completed generation first and selected a valid file path.
