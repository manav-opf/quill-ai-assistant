/**
 * Electron main process — window lifecycle and secure OpenAI proxy.
 * API key is read from environment (use .env via dotenv or system env).
 */
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const PptxGenJS = require('pptxgenjs');

// Load .env from project root when present
require('dotenv').config({ path: path.join(__dirname, '.env') });

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: 'Quill',
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile('index.html');
}

/**
 * Call OpenAI Chat Completions from main process (keeps API key out of renderer).
 */
async function openaiChat({ messages, temperature = 0.4 }) {
  const apiKey = process.env.OPENAI_API_KEY ;
  if (!apiKey || !String(apiKey).trim()) {
    return {
      ok: false,
      error:
        'Missing OPENAI_API_KEY. Copy .env.example to .env and add your key, or set the variable in your environment.',
    };
  }

  try {
    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        messages,
        temperature,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data.error?.message || res.statusText || 'OpenAI request failed';
      return { ok: false, error: msg };
    }

    const text = data.choices?.[0]?.message?.content?.trim() || '';
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err.message || 'Network error' };
  }
}

ipcMain.handle('openai-chat', async (_event, payload) => {
  return openaiChat(payload);
});

/**
 * Build a .pptx from slide objects { title, bullets[] } and write to disk.
 * Runs in main process (pptxgenjs + fs).
 */
function generatePPT(slides, filePath) {
  const pptx = new PptxGenJS();
  const list = Array.isArray(slides) ? slides : [];

  list.forEach((slide) => {
    const s = pptx.addSlide();
    const title = String(slide?.title ?? '').trim() || 'Slide';
    s.addText(title, {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.85,
      fontSize: 24,
      bold: true,
      color: '363636',
    });

    const rawBullets = Array.isArray(slide?.bullets) ? slide.bullets : [];
    const bullets = rawBullets.map((b) => String(b ?? '').trim()).filter(Boolean);
    if (bullets.length === 0) {
      s.addText('—', { x: 0.7, y: 1.5, w: 8.5, h: 4, fontSize: 16, color: '666666' });
      return;
    }
    const runs = bullets.map((text) => ({
      text,
      options: { bullet: true, breakLine: true },
    }));
    s.addText(runs, {
      x: 0.7,
      y: 1.5,
      w: 8.5,
      h: 4.5,
      fontSize: 16,
      color: '363636',
      valign: 'top',
    });
  });

  return pptx.writeFile({ fileName: filePath });
}

/** Show save dialog, generate .pptx from slides JSON, write to chosen path. */
ipcMain.handle('save-pptx', async (_event, slides) => {
  if (!mainWindow) {
    return { ok: false, error: 'Window not ready.' };
  }

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save PowerPoint presentation',
    defaultPath: path.join(app.getPath('downloads'), 'AI_Presentation.pptx'),
    filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
  });

  if (canceled || !filePath) {
    return { ok: false, canceled: true };
  }

  try {
    await generatePPT(slides, filePath);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
