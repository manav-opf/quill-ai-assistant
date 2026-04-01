/**
 * Electron main process — window lifecycle and secure OpenAI proxy.
 * API key is read from environment (use .env via dotenv or system env).
 */
const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const PptxGenJS = require('pptxgenjs');

/** Encrypted password vault (AES-256-GCM + PBKDF2); file lives in userData. */
const VAULT_FILE = 'quill-password-vault.dat';
const VAULT_INNER_VERSION = 1;
const PBKDF2_ITERATIONS = 310000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';
const SALT_LEN = 16;
const GCM_IV_LEN = 12;
const MIN_MASTER_LEN = 8;

let vaultSalt = null;
let vaultKey = null;
let vaultEntries = [];

function vaultFilePath() {
  return path.join(app.getPath('userData'), VAULT_FILE);
}

function deriveKey(masterPassword, saltBuf) {
  return crypto.pbkdf2Sync(Buffer.from(masterPassword, 'utf8'), saltBuf, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
}

function encryptInner(innerObj, key) {
  const iv = crypto.randomBytes(GCM_IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const json = JSON.stringify(innerObj);
  const enc = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  };
}

function decryptInner(payload, key) {
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const data = Buffer.from(payload.data, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

async function vaultFileExists() {
  try {
    await fs.access(vaultFilePath());
    return true;
  } catch {
    return false;
  }
}

function isVaultUnlocked() {
  return !!(vaultKey && vaultSalt);
}

function normalizeEntry(e) {
  return {
    id: String(e?.id || '').trim() || crypto.randomUUID(),
    title: String(e?.title ?? '').trim(),
    username: String(e?.username ?? '').trim(),
    password: String(e?.password ?? ''),
    url: String(e?.url ?? '').trim(),
    notes: String(e?.notes ?? '').trim(),
    updatedAt: typeof e?.updatedAt === 'number' ? e.updatedAt : Date.now(),
  };
}

function toPublicEntry(e) {
  return {
    id: e.id,
    title: e.title,
    username: e.username,
    url: e.url,
    notes: e.notes,
    updatedAt: e.updatedAt,
  };
}

async function readVaultFromDisk() {
  const raw = await fs.readFile(vaultFilePath(), 'utf8');
  return JSON.parse(raw);
}

async function persistVaultLocked() {
  if (!vaultKey || !vaultSalt) {
    throw new Error('Vault is locked.');
  }
  const inner = { v: VAULT_INNER_VERSION, entries: vaultEntries };
  const enc = encryptInner(inner, vaultKey);
  const outer = {
    v: 1,
    salt: vaultSalt.toString('base64'),
    iv: enc.iv,
    tag: enc.tag,
    data: enc.data,
    kdf: { name: 'pbkdf2', iterations: PBKDF2_ITERATIONS, digest: PBKDF2_DIGEST },
  };
  await fs.writeFile(vaultFilePath(), JSON.stringify(outer), 'utf8');
}

function lockVault() {
  vaultSalt = null;
  vaultKey = null;
  vaultEntries = [];
}

async function unlockVaultWithMaster(masterPassword) {
  const outer = await readVaultFromDisk();
  if (!outer?.salt || !outer.iv || !outer.tag || !outer.data) {
    throw new Error('Vault file is damaged or not initialized.');
  }
  const saltBuf = Buffer.from(outer.salt, 'base64');
  const key = deriveKey(masterPassword, saltBuf);
  let inner;
  try {
    inner = decryptInner({ iv: outer.iv, tag: outer.tag, data: outer.data }, key);
  } catch {
    throw new Error('Incorrect master password or vault is corrupted.');
  }
  if (!inner || inner.v !== VAULT_INNER_VERSION || !Array.isArray(inner.entries)) {
    throw new Error('Vault data format is not supported.');
  }
  vaultSalt = saltBuf;
  vaultKey = key;
  vaultEntries = inner.entries.map((x) => normalizeEntry(x));
}

function generatePassword(length = 20) {
  const len = Math.min(64, Math.max(8, Number(length) || 20));
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*-_.?';
  const all = upper + lower + digits + symbols;
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += all[bytes[i] % all.length];
  }
  return out;
}

// Load .env from project root when present
require('dotenv').config({ path: path.join(__dirname, '.env') });

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

let mainWindow;

function pptTemplateConfig(template) {
  const key = String(template || 'modern').toLowerCase();
  if (key === 'minimal') {
    return {
      key,
      theme: {
        bgColor: 'F8FAFC',
        titleColor: '0F172A',
        bodyColor: '334155',
        accentColor: '0EA5E9',
      },
    };
  }
  if (key === 'dark') {
    return {
      key,
      theme: {
        bgColor: '0F172A',
        titleColor: 'E2E8F0',
        bodyColor: 'CBD5E1',
        accentColor: '22D3EE',
      },
    };
  }
  return {
    key: 'modern',
    theme: {
      bgColor: 'EEF2FF',
      titleColor: '312E81',
      bodyColor: '3730A3',
      accentColor: '06B6D4',
    },
  };
}

function createWindow() {
  const winIconPath = path.join(__dirname, 'assets', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    icon: winIconPath,
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
function generatePPT(slides, filePath, options = {}) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  const list = Array.isArray(slides) ? slides : [];
  const cfg = pptTemplateConfig(options.template);

  list.forEach((slide) => {
    const s = pptx.addSlide();
    s.background = { color: cfg.theme.bgColor };
    s.addShape(pptx.ShapeType.line, {
      x: 0.5,
      y: 1.28,
      w: 12.1,
      h: 0,
      line: { color: cfg.theme.accentColor, pt: 1.4 },
    });

    const title = String(slide?.title ?? '').trim() || 'Slide';
    s.addText(title, {
      x: 0.5,
      y: 0.5,
      w: 12,
      h: 0.85,
      fontSize: 28,
      bold: true,
      color: cfg.theme.titleColor,
    });

    const rawBullets = Array.isArray(slide?.bullets) ? slide.bullets : [];
    const bullets = rawBullets.map((b) => String(b ?? '').trim()).filter(Boolean);
    if (bullets.length === 0) {
      s.addText('—', { x: 0.9, y: 1.7, w: 11, h: 4, fontSize: 18, color: cfg.theme.bodyColor });
      return;
    }
    const runs = bullets.map((text) => ({
      text,
      options: { bullet: true, breakLine: true },
    }));
    s.addText(runs, {
      x: 0.9,
      y: 1.7,
      w: 11.1,
      h: 5.1,
      fontSize: 20,
      paraSpaceAfterPt: 14,
      color: cfg.theme.bodyColor,
      valign: 'top',
    });
  });

  return pptx.writeFile({ fileName: filePath });
}

/** Show save dialog, generate .pptx from slides JSON, write to chosen path. */
ipcMain.handle('save-pptx', async (_event, payload) => {
  if (!mainWindow) {
    return { ok: false, error: 'Window not ready.' };
  }

  const slides = Array.isArray(payload) ? payload : payload?.slides;
  const options = Array.isArray(payload) ? {} : payload?.options || {};

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save PowerPoint presentation',
    defaultPath: path.join(app.getPath('downloads'), 'AI_Presentation.pptx'),
    filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
  });

  if (canceled || !filePath) {
    return { ok: false, canceled: true };
  }

  try {
    await generatePPT(slides, filePath, options);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

// --- Password vault (local encrypted file; unlock keeps key in memory until Lock or quit) ---
ipcMain.handle('password-vault-status', async () => {
  const exists = await vaultFileExists();
  return { ok: true, exists, unlocked: isVaultUnlocked() };
});

ipcMain.handle('password-vault-create', async (_event, payload) => {
  const masterPassword = String(payload?.masterPassword ?? '');
  const confirm = String(payload?.confirmPassword ?? '');
  try {
    if (await vaultFileExists()) {
      return { ok: false, error: 'A vault already exists on this device. Unlock it instead.' };
    }
    if (masterPassword.length < MIN_MASTER_LEN) {
      return { ok: false, error: `Master password must be at least ${MIN_MASTER_LEN} characters.` };
    }
    if (masterPassword !== confirm) {
      return { ok: false, error: 'Passwords do not match.' };
    }
    vaultSalt = crypto.randomBytes(SALT_LEN);
    vaultKey = deriveKey(masterPassword, vaultSalt);
    vaultEntries = [];
    await persistVaultLocked();
    return { ok: true, entries: vaultEntries.map(toPublicEntry) };
  } catch (err) {
    lockVault();
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('password-vault-unlock', async (_event, payload) => {
  const masterPassword = String(payload?.masterPassword ?? '');
  try {
    if (!masterPassword) {
      return { ok: false, error: 'Enter your master password.' };
    }
    if (!(await vaultFileExists())) {
      return { ok: false, error: 'No vault found. Create one first.' };
    }
    await unlockVaultWithMaster(masterPassword);
    return { ok: true, entries: vaultEntries.map(toPublicEntry) };
  } catch (err) {
    lockVault();
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('password-vault-lock', async () => {
  lockVault();
  return { ok: true };
});

ipcMain.handle('password-vault-list', async () => {
  if (!isVaultUnlocked()) {
    return { ok: false, error: 'Vault is locked.' };
  }
  return { ok: true, entries: vaultEntries.map(toPublicEntry) };
});

ipcMain.handle('password-vault-get-password', async (_event, payload) => {
  if (!isVaultUnlocked()) {
    return { ok: false, error: 'Vault is locked.' };
  }
  const id = String(payload?.id ?? '').trim();
  const entry = vaultEntries.find((e) => e.id === id);
  if (!entry) {
    return { ok: false, error: 'Entry not found.' };
  }
  return { ok: true, password: entry.password };
});

ipcMain.handle('password-vault-save-entry', async (_event, payload) => {
  if (!isVaultUnlocked()) {
    return { ok: false, error: 'Vault is locked.' };
  }
  try {
    const incoming = normalizeEntry(payload || {});
    if (!incoming.title) {
      return { ok: false, error: 'Title is required.' };
    }
    const idx = incoming.id ? vaultEntries.findIndex((e) => e.id === incoming.id) : -1;
    incoming.updatedAt = Date.now();
    if (idx >= 0) {
      const prev = vaultEntries[idx];
      const merged = { ...prev, ...incoming };
      if (!String(payload?.password ?? '').trim() && prev.password) {
        merged.password = prev.password;
      }
      vaultEntries[idx] = merged;
    } else {
      vaultEntries.push(incoming);
    }
    await persistVaultLocked();
    return { ok: true, entry: toPublicEntry(idx >= 0 ? vaultEntries[idx] : vaultEntries[vaultEntries.length - 1]) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('password-vault-delete', async (_event, payload) => {
  if (!isVaultUnlocked()) {
    return { ok: false, error: 'Vault is locked.' };
  }
  try {
    const id = String(payload?.id ?? '').trim();
    const before = vaultEntries.length;
    vaultEntries = vaultEntries.filter((e) => e.id !== id);
    if (vaultEntries.length === before) {
      return { ok: false, error: 'Entry not found.' };
    }
    await persistVaultLocked();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('password-vault-copy-password', async (_event, payload) => {
  if (!isVaultUnlocked()) {
    return { ok: false, error: 'Vault is locked.' };
  }
  const id = String(payload?.id ?? '').trim();
  const entry = vaultEntries.find((e) => e.id === id);
  if (!entry) {
    return { ok: false, error: 'Entry not found.' };
  }
  clipboard.writeText(entry.password);
  return { ok: true };
});

ipcMain.handle('password-vault-generate', async (_event, payload) => {
  const pwd = generatePassword(payload?.length);
  return { ok: true, password: pwd };
});

app.on('before-quit', () => {
  lockVault();
});

app.whenReady().then(() => {
  // Ensures proper taskbar grouping/icon resolution on Windows installs.
  app.setAppUserModelId('com.manavprajapati.quill');
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
