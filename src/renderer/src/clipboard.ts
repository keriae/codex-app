// app-shared.qyn sends plain text through appServices.clipboard.writeText.
// Use the native service in Electron; Chromium clipboard-write stays denied.
export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof window !== 'undefined' && window.codex?.copyText) {
    await window.codex.copyText(text)
    return
  }
  if (!globalThis.navigator?.clipboard) throw new Error('Clipboard is unavailable')
  await navigator.clipboard.writeText(text)
}
