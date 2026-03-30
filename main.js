/**
 * Electron main process — window lifecycle and secure OpenAI proxy.
 * API key is read from environment (use .env via dotenv or system env).
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
