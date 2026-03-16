// ===== WA Sender - Content Script for WhatsApp Web =====
// Strategy: use a pendingSend flag in storage.
// Before navigating to /send?phone=X, we set pendingSend=true.
// WhatsApp Web processes the URL and redirects to the chat (URL changes).
// On every load, if pendingSend is true, we wait for the input and click send.

console.log('[WA Sender] Content script loaded');

// Listen for commands from popup/background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'start' || msg.type === 'resume') {
    navigateToCurrentContact();
  }
  sendResponse({ ok: true });
  return true;
});

// On every page load, check if there's a pending send
(async function init() {
  await sleep(3000);

  const { sendState } = await chrome.storage.local.get('sendState');
  if (!sendState || sendState.status !== 'running' || !sendState.pendingSend) return;

  await handlePendingSend();
})();

// ===== Handle a pending send (chat should be open with pre-filled message) =====
async function handlePendingSend() {
  const { sendState, contacts, templates, config } = await chrome.storage.local.get([
    'sendState', 'contacts', 'templates', 'config'
  ]);

  if (!sendState || sendState.status !== 'running') return;
  if (!contacts || !templates) return;

  const cfg = config || { minInterval: 30, maxInterval: 60, restEvery: 20, restMinutes: 5 };
  const current = sendState.current;
  const contact = contacts[current];
  const templateIdx = current % templates.length;

  // Clear the pending flag
  sendState.pendingSend = false;
  await chrome.storage.local.set({ sendState });

  // Wait for the message input to appear (text was pre-filled by the /send URL)
  const inputBox = await waitForElement(
    'div[contenteditable="true"][data-tab="10"]',
    30000
  );

  if (!inputBox) {
    // Check for error popup (invalid number)
    const errorPopup = document.querySelector('[data-testid="popup-contents"]');
    if (errorPopup) {
      const okBtn = errorPopup.querySelector('button');
      if (okBtn) okBtn.click();
    }
    await logEntry('error', ts() + ' X ' + maskPhone(contact.phone) + ' - Numero invalido o chat no cargo');
    await advanceAndContinue(cfg, contacts, templates);
    return;
  }

  // Wait for everything to settle
  await sleep(2000);

  // Click send
  const sent = await clickSend();

  if (sent) {
    await logEntry('success', ts() + ' OK ' + maskPhone(contact.phone) + ' - Enviado (plantilla ' + (templateIdx + 1) + ')');
  } else {
    await logEntry('error', ts() + ' X ' + maskPhone(contact.phone) + ' - No se encontro boton enviar');
  }

  await advanceAndContinue(cfg, contacts, templates);
}

// ===== Click the send button =====
async function clickSend() {
  // Try multiple selectors (WhatsApp Web updates these)
  const selectors = [
    'span[data-icon="send"]',
    'button[data-testid="send"]',
    'button[aria-label="Send"]',
    'button[aria-label="Enviar"]'
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const btn = el.closest('button') || el;
      btn.click();
      await sleep(2000);
      return true;
    }
  }

  // Fallback: press Enter
  const input = document.querySelector('div[contenteditable="true"][data-tab="10"]');
  if (input) {
    input.focus();
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
    });
    input.dispatchEvent(enter);
    await sleep(2000);
    return true;
  }

  return false;
}

// ===== Advance to next contact =====
async function advanceAndContinue(cfg, contacts, templates) {
  // Re-read state (might have changed during send)
  const { sendState } = await chrome.storage.local.get('sendState');
  if (!sendState) return;

  sendState.current += 1;

  // Done?
  if (sendState.current >= contacts.length) {
    sendState.status = 'done';
    sendState.log.push({ type: 'success', text: ts() + ' Envio completado!' });
    await chrome.storage.local.set({ sendState });
    return;
  }

  await chrome.storage.local.set({ sendState });

  // Rest period
  if (cfg.restEvery > 0 && sendState.current > 0 && sendState.current % cfg.restEvery === 0) {
    await logEntry('rest', ts() + ' Descansando ' + cfg.restMinutes + ' minuto(s)...');
    const ok = await interruptableSleep(cfg.restMinutes * 60 * 1000);
    if (!ok) return;
    await logEntry('info', ts() + ' Reanudando envio');
  }

  // Wait interval
  const waitSec = randomBetween(cfg.minInterval, cfg.maxInterval);
  await logEntry('info', ts() + ' Esperando ' + waitSec + 's...');
  const ok = await interruptableSleep(waitSec * 1000);
  if (!ok) return;

  // Navigate to next
  await navigateToCurrentContact();
}

// ===== Navigate to current contact's send URL =====
async function navigateToCurrentContact() {
  const { sendState, contacts, templates } = await chrome.storage.local.get([
    'sendState', 'contacts', 'templates'
  ]);

  if (!sendState || sendState.status !== 'running') return;
  if (!contacts || !templates) return;
  if (sendState.current >= contacts.length) return;

  const contact = contacts[sendState.current];
  const templateIdx = sendState.current % templates.length;
  const message = templates[templateIdx];
  const cleanPhone = contact.phone.replace(/\+/g, '');

  const url = 'https://web.whatsapp.com/send?phone='
    + encodeURIComponent(cleanPhone)
    + '&text=' + encodeURIComponent(message);

  await logEntry('info', ts() + ' Abriendo chat ' + maskPhone(contact.phone) + '...');

  // Set pending flag BEFORE navigating
  sendState.pendingSend = true;
  await chrome.storage.local.set({ sendState });

  // Navigate — WA Web will process the URL and open the chat
  // The content script reloads, init() sees pendingSend=true, handles it
  window.location.href = url;
}

// ===== Wait for a DOM element =====
function waitForElement(selector, timeout = 30000) {
  return new Promise(resolve => {
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

// ===== Logging =====
async function logEntry(type, text) {
  const { sendState } = await chrome.storage.local.get('sendState');
  if (!sendState) return;
  sendState.log.push({ type, text });
  if (sendState.log.length > 200) sendState.log = sendState.log.slice(-200);
  await chrome.storage.local.set({ sendState });
}

// ===== Interruptable sleep (polls storage for pause/stop) =====
async function interruptableSleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const { sendState } = await chrome.storage.local.get('sendState');
    if (!sendState || sendState.status !== 'running') return false;
    await sleep(Math.min(1000, end - Date.now()));
  }
  return true;
}

// ===== Utilities =====
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function maskPhone(phone) {
  if (phone.length > 6) return phone.substring(0, phone.length - 4) + '****';
  return phone;
}

function ts() {
  return new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
