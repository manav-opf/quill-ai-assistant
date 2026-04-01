/**
 * Preload — exposes a minimal, typed-safe bridge to the renderer (no raw Node APIs).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * @param {{ role: string, content: string }[]} messages
   * @param {{ temperature?: number }} [options]
   * @returns {Promise<{ ok: boolean, text?: string, error?: string }>}
   */
  openaiChat(messages, options = {}) {
    return ipcRenderer.invoke('openai-chat', { messages, ...options });
  },

  /**
   * Generate .pptx from slide definitions; opens system save dialog.
   * @param {{ title: string, bullets: string[] }[]} slides
   * @param {{ template?: string }} [options]
   * @returns {Promise<{ ok: boolean, path?: string, canceled?: boolean, error?: string }>}
   */
  savePPTX(slides, options = {}) {
    return ipcRenderer.invoke('save-pptx', { slides, options });
  },

  passwordVaultStatus() {
    return ipcRenderer.invoke('password-vault-status');
  },

  passwordVaultCreate(payload) {
    return ipcRenderer.invoke('password-vault-create', payload);
  },

  passwordVaultUnlock(payload) {
    return ipcRenderer.invoke('password-vault-unlock', payload);
  },

  passwordVaultLock() {
    return ipcRenderer.invoke('password-vault-lock');
  },

  passwordVaultList() {
    return ipcRenderer.invoke('password-vault-list');
  },

  passwordVaultGetPassword(payload) {
    return ipcRenderer.invoke('password-vault-get-password', payload);
  },

  passwordVaultSaveEntry(payload) {
    return ipcRenderer.invoke('password-vault-save-entry', payload);
  },

  passwordVaultDelete(payload) {
    return ipcRenderer.invoke('password-vault-delete', payload);
  },

  passwordVaultCopyPassword(payload) {
    return ipcRenderer.invoke('password-vault-copy-password', payload);
  },

  passwordVaultGenerate(payload) {
    return ipcRenderer.invoke('password-vault-generate', payload);
  },
});
