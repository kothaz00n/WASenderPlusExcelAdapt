// ===== WA Sender - Content Script for WhatsApp Web =====
// Strategy: state-driven via chrome.storage.local
// Each page load checks if there's an active sending session.
// After sending a message, waits the interval, then navigates to the next contact.
// Navigation reloads the script, which picks up from storage and continues.

console.log('[WA Sender] Content script loaded');

// Listen for commands from popup/background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'start' || msg.type === 'resume') {
    navigateToCurrentContact();
  }
  // pause/stop are handled via storage state (updated by background.js)
  sendResponse({ ok: true });
  return true;
});

// On every page load, check if we need to send
(async function init() {
  // Give the page time to settle
  await sleep(3000);

  const { sendState } = await chrome.storage.local.get('sendState');
  if (!sendState || sendState.status !== 'running') return;

  // We're on a /send?phone= URL — the message is pre-filled, we need to click send
  if (window.location.href.includes('/send?phone=')) {
    await handleSendPage();
  }
})();

// ===== Core: handle the current send page =====
async function handleSendPage() {
  const { sendState, contacts, templates, config } = await chrome.storage.local.get([
    'sendState', 'contacts', 'templates', 'config'
  ]);

  if (!sendState || sendState.status !== 'running') return;
  if (!contacts || !templates) return;

  const cfg = config || { minInterval: 30, maxInterval: 60, restEvery: 20, restMinutes: 5 };
  const current = sendState.current;
  const contact = contacts[current];
  const templateIdx = current % templates.length;

  // Wait for the message input (text is pre-filled by the URL)
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
    await logEntry('error', ts() + ' \u2717 ' + maskPhone(contact.phone) + ' - Numero invalido o chat no cargo');
    await advanceAndContinue(sendState, contacts, templates, cfg);
    return;
  }

  // Wait a bit for everything to be ready
  await sleep(2000);

  // Click the send button
  const sent = await clickSend();

  if (sent) {
    await logEntry('success', ts() + ' \u2713 ' + maskPhone(contact.phone) + ' - Enviado (plantilla ' + (templateIdx + 1) + ')');
  } else {
    await logEntry('error', ts() + ' \u2717 ' + maskPhone(contact.phone) + ' - No se encontro boton enviar');
  }

  await advanceAndContinue(sendState, contacts, templates, cfg);
}

// ===== Click the send button =====
async function clickSend() {
  // Try multiple selectors (WhatsApp Web changes these)
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

  // Fallback: try pressing Enter on the input
  const input = document.querySelector('div[contenteditable="true"][data-tab="10"]');
  if (input) {
    input.focus();
    document.execCommand('insertText', false, '');
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
    });
    input.dispatchEvent(enterEvent);
    await sleep(2000);
    return true;
  }

  return false;
}

// ===== Advance to next contact and continue =====
async function advanceAndContinue(sendState, contacts, templates, cfg) {
  sendState.current += 1;

  // Check if done
  if (sendState.current >= contacts.length) {
    sendState.status = 'done';
    sendState.log.push({ type: 'success', text: ts() + ' Envio completado!' });
    await chrome.storage.local.set({ sendState });
    // Navigate back to main WhatsApp page
    window.location.href = 'https://web.whatsapp.com';
    return;
  }

  await chrome.storage.local.set({ sendState });

  // Rest period check
  if (cfg.restEvery > 0 && sendState.current > 0 && sendState.current % cfg.restEvery === 0) {
    await logEntry('rest', ts() + ' Descansando ' + cfg.restMinutes + ' minuto(s)...');
    const shouldContinue = await interruptableSleep(cfg.restMinutes * 60 * 1000);
    if (!shouldContinue) return;
    await logEntry('info', ts() + ' Reanudando envio');
  }

  // Wait interval before next message
  const waitSec = randomBetween(cfg.minInterval, cfg.maxInterval);
  await logEntry('info', ts() + ' Esperando ' + waitSec + 's...');
  const shouldContinue = await interruptableSleep(waitSec * 1000);
  if (!shouldContinue) return;

  // Navigate to next contact (this will reload the content script)
  await navigateToCurrentContact();
}

// ===== Navigate to the current contact's send URL =====
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

  // Navigate — the script will reload and init() will pick up
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

// ===== Interruptable sleep (checks storage for pause/stop) =====
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
