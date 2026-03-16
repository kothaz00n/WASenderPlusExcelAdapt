// ===== Background Service Worker =====
// Coordinates popup commands with the content script running on WhatsApp Web

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'command') {
    handleCommand(msg.command);
  }
  return true;
});

async function handleCommand(command) {
  const tab = await getWhatsAppTab();
  if (!tab) {
    addLog('error', 'WhatsApp Web no está abierto. Abrí web.whatsapp.com primero.');
    return;
  }

  if (command === 'start') {
    await chrome.storage.local.set({
      sendState: { status: 'running', current: 0, log: [] }
    });
    sendToContent(tab.id, { type: 'start' });
  } else if (command === 'resume') {
    const { sendState } = await chrome.storage.local.get('sendState');
    if (sendState) {
      sendState.status = 'running';
      await chrome.storage.local.set({ sendState });
    }
    sendToContent(tab.id, { type: 'resume' });
  } else if (command === 'pause') {
    const { sendState } = await chrome.storage.local.get('sendState');
    if (sendState) {
      sendState.status = 'paused';
      sendState.log.push({ type: 'info', text: getTimestamp() + ' Pausado por el usuario' });
      await chrome.storage.local.set({ sendState });
    }
    sendToContent(tab.id, { type: 'pause' });
  } else if (command === 'stop') {
    const { sendState } = await chrome.storage.local.get('sendState');
    if (sendState) {
      sendState.status = 'stopped';
      sendState.log.push({ type: 'info', text: getTimestamp() + ' Detenido por el usuario' });
      await chrome.storage.local.set({ sendState });
    }
    sendToContent(tab.id, { type: 'stop' });
  }
}

function sendToContent(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(err => {
    console.log('Could not reach content script:', err.message);
    addLog('error', 'No se pudo conectar con WhatsApp Web. Recargá la página.');
  });
}

async function getWhatsAppTab() {
  const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
  return tabs.length > 0 ? tabs[0] : null;
}

async function addLog(type, text) {
  const { sendState } = await chrome.storage.local.get('sendState');
  if (sendState) {
    sendState.log.push({ type, text });
    await chrome.storage.local.set({ sendState });
  }
}

function getTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
