// ===== State =====
let rawData = [];
let headers = [];

// ===== Tabs =====
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');

    if (tab.dataset.tab === 'tabSend') refreshSendSummary();
  });
});

// ===== Tab 1: Excel Upload & Mapping =====
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');

uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.style.borderColor = '#25d366'; });
uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = '#333'; });
uploadArea.addEventListener('drop', e => {
  e.preventDefault();
  uploadArea.style.borderColor = '#333';
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  document.getElementById('fileName').textContent = file.name;
  const reader = new FileReader();
  reader.onload = function(e) {
    const data = new Uint8Array(e.target.result);
    const wb = XLSX.read(data, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (json.length < 2) {
      showToast('El archivo no tiene datos suficientes');
      return;
    }

    headers = json[0].map(String);
    rawData = json.slice(1);
    populateSelects();
    renderPreview();
    document.getElementById('mappingSection').style.display = 'block';
    document.getElementById('contactsSaved').style.display = 'none';
  };
  reader.readAsArrayBuffer(file);
}

function populateSelects() {
  const ids = ['mapNumber', 'mapPrefix', 'mapFirstName', 'mapLastName', 'mapOther1', 'mapOther2'];
  ids.forEach(id => {
    const sel = document.getElementById(id);
    const isReq = id === 'mapNumber';
    sel.innerHTML = isReq ? '<option value="">-- Seleccionar --</option>' : '<option value="">-- No usar --</option>';
    headers.forEach((h, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = h;
      sel.appendChild(opt);
    });
  });
  togglePrefixManual();
  updateSaveBtn();
}

function renderPreview() {
  const max = 20;
  const shown = rawData.slice(0, max);
  let html = '<table><thead><tr>';
  headers.forEach(h => { html += '<th>' + esc(h) + '</th>'; });
  html += '</tr></thead><tbody>';
  shown.forEach(row => {
    html += '<tr>';
    headers.forEach((_, i) => { html += '<td>' + esc(String(row[i] ?? '')) + '</td>'; });
    html += '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('previewTable').innerHTML = html;
  document.getElementById('rowInfo').textContent = rawData.length + ' filas' + (rawData.length > max ? ' (mostrando ' + max + ')' : '');
}

// Prefix toggle
document.getElementById('mapPrefix').addEventListener('change', togglePrefixManual);
function togglePrefixManual() {
  document.getElementById('prefixManualRow').style.display =
    document.getElementById('mapPrefix').value ? 'none' : 'flex';
}

// Enable save button - ONLY requires Number column
document.getElementById('mapNumber').addEventListener('change', updateSaveBtn);
document.getElementById('mapNumber').addEventListener('input', updateSaveBtn);
function updateSaveBtn() {
  const hasNumber = document.getElementById('mapNumber').value !== '';
  document.getElementById('btnSaveContacts').disabled = !hasNumber;
}

// Save contacts
document.getElementById('btnSaveContacts').addEventListener('click', saveContacts);

function saveContacts() {
  const numIdx = parseInt(document.getElementById('mapNumber').value);
  const prefixColIdx = document.getElementById('mapPrefix').value;
  const fnIdx = document.getElementById('mapFirstName').value;
  const lnIdx = document.getElementById('mapLastName').value;
  const o1Idx = document.getElementById('mapOther1').value;
  const o2Idx = document.getElementById('mapOther2').value;
  const manualPrefix = document.getElementById('prefixInput').value.trim();

  const contacts = [];
  rawData.forEach(row => {
    let phone = String(row[numIdx] ?? '').trim();
    if (!phone) return;
    phone = phone.replace(/[\s\-\.()]/g, '');

    let prefix = '';
    if (prefixColIdx !== '') {
      prefix = String(row[parseInt(prefixColIdx)] ?? '').trim().replace(/[\s\-\.()]/g, '');
      if (prefix && !prefix.startsWith('+')) prefix = '+' + prefix;
    } else {
      prefix = manualPrefix;
    }

    if (prefix && !phone.startsWith('+')) {
      phone = prefix + phone;
    }

    contacts.push({
      phone,
      firstName: fnIdx !== '' ? String(row[parseInt(fnIdx)] ?? '') : '',
      lastName: lnIdx !== '' ? String(row[parseInt(lnIdx)] ?? '') : '',
      other1: o1Idx !== '' ? String(row[parseInt(o1Idx)] ?? '') : '',
      other2: o2Idx !== '' ? String(row[parseInt(o2Idx)] ?? '') : ''
    });
  });

  chrome.storage.local.set({ contacts }, () => {
    document.getElementById('mappingSection').style.display = 'none';
    document.getElementById('contactsSaved').style.display = 'flex';
    document.getElementById('savedCount').textContent = contacts.length;
    showToast(contacts.length + ' contactos guardados');
  });
}

// Clear contacts
document.getElementById('btnClearContacts').addEventListener('click', () => {
  chrome.storage.local.remove('contacts', () => {
    document.getElementById('contactsSaved').style.display = 'none';
    document.getElementById('mappingSection').style.display = 'none';
    document.getElementById('fileName').textContent = '';
    fileInput.value = '';
    rawData = [];
    headers = [];
    showToast('Contactos borrados');
  });
});

// ===== Tab 2: Templates =====
document.getElementById('btnSaveTemplates').addEventListener('click', () => {
  const templates = [];
  for (let i = 1; i <= 5; i++) {
    const val = document.getElementById('tpl' + i).value.trim();
    if (val) templates.push(val);
  }
  if (templates.length === 0) {
    showToast('Necesitás al menos 1 plantilla');
    return;
  }
  chrome.storage.local.set({ templates }, () => {
    showToast(templates.length + ' plantilla(s) guardada(s)');
  });
});

// ===== Tab 3: Config =====
document.getElementById('btnSaveConfig').addEventListener('click', () => {
  const config = {
    minInterval: Math.max(5, parseInt(document.getElementById('cfgMinInterval').value) || 30),
    maxInterval: Math.max(10, parseInt(document.getElementById('cfgMaxInterval').value) || 60),
    restEvery: Math.max(1, parseInt(document.getElementById('cfgRestEvery').value) || 20),
    restMinutes: Math.max(1, parseInt(document.getElementById('cfgRestMinutes').value) || 5)
  };
  if (config.minInterval > config.maxInterval) config.maxInterval = config.minInterval + 10;
  chrome.storage.local.set({ config }, () => {
    showToast('Configuración guardada');
  });
});

// ===== Tab 4: Send =====
function refreshSendSummary() {
  chrome.storage.local.get(['contacts', 'templates', 'config', 'sendState'], res => {
    const contacts = res.contacts || [];
    const templates = res.templates || [];
    const config = res.config || { minInterval: 30, maxInterval: 60, restEvery: 20, restMinutes: 5 };
    const state = res.sendState || { status: 'idle', current: 0, log: [] };

    document.getElementById('sumContacts').textContent = contacts.length;
    document.getElementById('sumTemplates').textContent = templates.length;
    document.getElementById('sumInterval').textContent = config.minInterval + '-' + config.maxInterval + 's';
    document.getElementById('sumRest').textContent = 'cada ' + config.restEvery + ', ' + config.restMinutes + 'min';

    const canStart = contacts.length > 0 && templates.length > 0;
    document.getElementById('btnStart').disabled = !canStart;

    updateSendUI(state, contacts.length);
  });
}

function updateSendUI(state, total) {
  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnStop = document.getElementById('btnStop');
  const progressSection = document.getElementById('progressSection');

  if (state.status === 'running') {
    btnStart.style.display = 'none';
    btnPause.style.display = 'block';
    btnStop.style.display = 'block';
    progressSection.style.display = 'block';
  } else if (state.status === 'paused') {
    btnStart.style.display = 'block';
    btnStart.textContent = 'Reanudar';
    btnStart.disabled = false;
    btnPause.style.display = 'none';
    btnStop.style.display = 'block';
    progressSection.style.display = 'block';
  } else {
    btnStart.style.display = 'block';
    btnStart.textContent = 'Iniciar envío';
    btnPause.style.display = 'none';
    btnStop.style.display = 'none';
    if (state.current === 0) progressSection.style.display = 'none';
  }

  if (total > 0) {
    const pct = Math.round((state.current / total) * 100);
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressText').textContent = state.current + ' / ' + total + ' (' + pct + '%)';
  }

  renderLog(state.log || []);
}

function renderLog(log) {
  const logList = document.getElementById('logList');
  if (log.length === 0) {
    logList.innerHTML = '<div class="log-empty">Sin actividad aún</div>';
    return;
  }
  const recent = log.slice(-50).reverse();
  logList.innerHTML = recent.map(entry =>
    '<div class="log-entry ' + entry.type + '">' + esc(entry.text) + '</div>'
  ).join('');
}

// Send controls
document.getElementById('btnStart').addEventListener('click', () => {
  chrome.storage.local.get('sendState', res => {
    const state = res.sendState || { status: 'idle', current: 0, log: [] };
    if (state.status === 'paused') {
      sendCommand('resume');
    } else {
      // Reset state for new run
      chrome.storage.local.set({
        sendState: { status: 'running', current: 0, log: [] }
      }, () => {
        sendCommand('start');
      });
    }
  });
});

document.getElementById('btnPause').addEventListener('click', () => sendCommand('pause'));
document.getElementById('btnStop').addEventListener('click', () => sendCommand('stop'));

function sendCommand(command) {
  chrome.runtime.sendMessage({ type: 'command', command });
  setTimeout(refreshSendSummary, 500);
}

// Poll for updates when on send tab
let pollInterval = null;
function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(() => {
    const sendTab = document.querySelector('.tab[data-tab="tabSend"]');
    if (sendTab.classList.contains('active')) {
      refreshSendSummary();
    }
  }, 1000);
}
startPolling();

// ===== Init: Load saved data =====
chrome.storage.local.get(['contacts', 'templates', 'config'], res => {
  // Show saved contacts count
  if (res.contacts && res.contacts.length > 0) {
    document.getElementById('contactsSaved').style.display = 'flex';
    document.getElementById('savedCount').textContent = res.contacts.length;
  }

  // Restore templates
  if (res.templates) {
    res.templates.forEach((t, i) => {
      const el = document.getElementById('tpl' + (i + 1));
      if (el) el.value = t;
    });
  }

  // Restore config
  if (res.config) {
    document.getElementById('cfgMinInterval').value = res.config.minInterval || 30;
    document.getElementById('cfgMaxInterval').value = res.config.maxInterval || 60;
    document.getElementById('cfgRestEvery').value = res.config.restEvery || 20;
    document.getElementById('cfgRestMinutes').value = res.config.restMinutes || 5;
  }
});

// Check connection to WhatsApp Web
function checkConnection() {
  chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, tabs => {
    const dot = document.getElementById('statusDot');
    if (tabs.length > 0) {
      dot.classList.add('connected');
      dot.title = 'WhatsApp Web abierto';
    } else {
      dot.classList.remove('connected');
      dot.title = 'WhatsApp Web no detectado';
    }
  });
}
checkConnection();
setInterval(checkConnection, 3000);

// ===== Utils =====
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}
