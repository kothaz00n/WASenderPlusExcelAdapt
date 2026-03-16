// ===== WA Sender - Content Script for WhatsApp Web =====

let isRunning = false;
let isPaused = false;

// Listen for commands from background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'start') {
    isRunning = true;
    isPaused = false;
    startSending();
  } else if (msg.type === 'resume') {
    isPaused = false;
    isRunning = true;
  } else if (msg.type === 'pause') {
    isPaused = true;
  } else if (msg.type === 'stop') {
    isRunning = false;
    isPaused = false;
  }
  sendResponse({ ok: true });
  return true;
});

async function startSending() {
  const { contacts, templates, config, sendState } = await chrome.storage.local.get([
    'contacts', 'templates', 'config', 'sendState'
  ]);

  if (!contacts || !contacts.length || !templates || !templates.length) {
    await addLog('error', 'No hay contactos o plantillas configurados');
    return;
  }

  const cfg = config || { minInterval: 30, maxInterval: 60, restEvery: 20, restMinutes: 5 };
  const startIdx = sendState?.current || 0;

  await addLog('info', ts() + ' Iniciando envío desde contacto #' + (startIdx + 1));

  for (let i = startIdx; i < contacts.length; i++) {
    // Check if stopped
    if (!isRunning) {
      await addLog('info', ts() + ' Envío detenido');
      return;
    }

    // Wait while paused
    while (isPaused) {
      await sleep(1000);
      if (!isRunning) return;
    }

    const contact = contacts[i];
    const templateIdx = i % templates.length;
    const message = templates[templateIdx];

    try {
      await sendMessage(contact.phone, message);
      await updateState('running', i + 1, 'success',
        ts() + ' ✓ ' + maskPhone(contact.phone) + ' - Enviado (plantilla ' + (templateIdx + 1) + ')');
    } catch (err) {
      await updateState('running', i + 1, 'error',
        ts() + ' ✗ ' + maskPhone(contact.phone) + ' - Error: ' + err.message);
    }

    // Rest period check
    const sentCount = i - startIdx + 1;
    if (cfg.restEvery > 0 && sentCount % cfg.restEvery === 0 && i < contacts.length - 1) {
      if (!isRunning) return;
      const restMs = cfg.restMinutes * 60 * 1000;
      await addLog('rest', ts() + ' ⏸ Descansando ' + cfg.restMinutes + ' minuto(s)...');
      await interruptableSleep(restMs);
      if (!isRunning) return;
      await addLog('info', ts() + ' ▶ Reanudando envío');
    }

    // Wait interval before next message (not after last)
    if (i < contacts.length - 1 && isRunning && !isPaused) {
      const waitSec = randomBetween(cfg.minInterval, cfg.maxInterval);
      await addLog('info', ts() + ' ⏳ Esperando ' + waitSec + 's...');
      await interruptableSleep(waitSec * 1000);
    }
  }

  // Done
  if (isRunning) {
    await updateState('done', contacts.length, 'success', ts() + ' 🏁 Envío completado');
    isRunning = false;
  }
}

async function sendMessage(phone, text) {
  // Navigate to WhatsApp send URL
  const cleanPhone = phone.replace(/\+/g, '');
  const url = 'https://web.whatsapp.com/send?phone=' + encodeURIComponent(cleanPhone) + '&text=' + encodeURIComponent(text);
  window.location.href = url;

  // Wait for the chat to load and message input to appear
  const inputBox = await waitForElement(
    'div[contenteditable="true"][data-tab="10"]',
    30000
  );

  if (!inputBox) {
    // Check if there's an error (invalid number)
    const errorPopup = document.querySelector('[data-testid="popup-contents"]');
    if (errorPopup) {
      // Click OK to dismiss
      const okBtn = errorPopup.querySelector('button');
      if (okBtn) okBtn.click();
      throw new Error('Número inválido');
    }
    throw new Error('Chat no cargó (timeout)');
  }

  // Small delay to ensure everything is ready
  await sleep(1500);

  // Find and click the send button
  const sendBtn = document.querySelector('button[data-testid="send"], span[data-icon="send"]');
  if (sendBtn) {
    const button = sendBtn.closest('button') || sendBtn;
    button.click();
    await sleep(2000); // Wait for message to send
  } else {
    // Fallback: press Enter
    inputBox.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true
    }));
    await sleep(2000);
  }
}

function waitForElement(selector, timeout = 30000) {
  return new Promise((resolve) => {
    const start = Date.now();

    function check() {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      if (Date.now() - start > timeout) return resolve(null);
      setTimeout(check, 500);
    }
    check();
  });
}

// ===== State Management =====
async function updateState(status, current, logType, logText) {
  const { sendState } = await chrome.storage.local.get('sendState');
  const state = sendState || { status: 'idle', current: 0, log: [] };
  state.status = status;
  state.current = current;
  if (logText) state.log.push({ type: logType, text: logText });
  // Keep log limited to last 200 entries
  if (state.log.length > 200) state.log = state.log.slice(-200);
  await chrome.storage.local.set({ sendState: state });
}

async function addLog(type, text) {
  const { sendState } = await chrome.storage.local.get('sendState');
  const state = sendState || { status: 'idle', current: 0, log: [] };
  state.log.push({ type, text });
  if (state.log.length > 200) state.log = state.log.slice(-200);
  await chrome.storage.local.set({ sendState: state });
}

// ===== Utilities =====
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function interruptableSleep(ms) {
  const interval = 1000;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!isRunning || isPaused) return;
    await sleep(Math.min(interval, end - Date.now()));
  }
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function maskPhone(phone) {
  if (phone.length > 6) {
    return phone.substring(0, phone.length - 4) + '****';
  }
  return phone;
}

function ts() {
  return new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

console.log('[WA Sender] Content script loaded on WhatsApp Web');
