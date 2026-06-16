/* ===== Sidebar Navigation ===== */

function initSidebar() {
  const sidebar = document.getElementById('tokenSidebar');
  const tabs = document.querySelectorAll('.sidebar-tab');
  const panes = document.querySelectorAll('.sidebar-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      if (sidebar.classList.contains('expanded') && tab.classList.contains('active')) {
        sidebar.classList.remove('expanded');
        tabs.forEach(t => t.classList.remove('active'));
        document.getElementById('sidebarOverlay').classList.remove('show');
        return;
      }

      sidebar.classList.add('expanded');
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      panes.forEach(p => p.classList.remove('active'));
      const pane = document.querySelector(`.sidebar-pane[data-pane="${target}"]`);
      if (pane) pane.classList.add('active');

      if (window.innerWidth <= 768) {
        document.getElementById('sidebarOverlay').classList.add('show');
      }
    });
  });

  document.getElementById('sidebarOverlay').addEventListener('click', () => {
    sidebar.classList.remove('expanded');
    tabs.forEach(t => t.classList.remove('active'));
    document.getElementById('sidebarOverlay').classList.remove('show');
  });
}

/* ===== Memory Sub-tabs ===== */

function initMemoryTabs() {
  const mtabs = document.querySelectorAll('.memory-tab');
  const contents = document.querySelectorAll('.mtab-content');

  mtabs.forEach(tab => {
    tab.addEventListener('click', () => {
      mtabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      contents.forEach(c => c.classList.remove('active'));
      const content = document.querySelector(`.mtab-content[data-mtab="${tab.dataset.mtab}"]`);
      if (content) content.classList.add('active');
    });
  });
}

/* ===== Burger Menu ===== */

function initBurger() {
  document.getElementById('burgerBtn').addEventListener('click', () => {
    const sidebar = document.getElementById('tokenSidebar');
    sidebar.classList.toggle('expanded');
    if (sidebar.classList.contains('expanded')) {
      document.querySelector('.sidebar-tab[data-tab="explorer"]').click();
    }
  });
}

/* ===== Explorer: Profiles ===== */

function renderProfileSelect(memoryManager) {
  const select = document.getElementById('profileSelect');
  const profiles = memoryManager.getProfiles();
  const currentId = memoryManager.getCurrentProfileId();
  select.innerHTML = '<option value="">— Без профиля —</option>' +
    profiles.map(p =>
      `<option value="${p.id}"${p.id === currentId ? ' selected' : ''}>${escapeHtml(p.name || p.id)}</option>`
    ).join('');
}

function initProfiles(memoryManager) {
  const addBtn = document.getElementById('addProfileBtn');
  const delBtn = document.getElementById('delProfileBtn');
  const select = document.getElementById('profileSelect');

  select.addEventListener('change', () => {
    const id = select.value;
    memoryManager.setCurrentProfileId(id || null);
    if (id) {
      const profiles = memoryManager.getProfiles();
      const profile = profiles.find(p => p.id === id);
      if (profile) loadProfileUI(profile);
    }
  });

  addBtn.addEventListener('click', () => {
    const id = 'profile_' + Date.now();
    const profile = { id, name: 'Новый профиль', role: '', style: 'concise', format: 'text', level: 'middle', goals: '' };
    memoryManager.saveProfile(profile);
    memoryManager.setCurrentProfileId(id);
    renderProfileSelect(memoryManager);
    document.getElementById('profileSelect').value = id;
    loadProfileUI(profile);
  });

  delBtn.addEventListener('click', () => {
    const id = select.value;
    if (!id) return;
    if (!confirm('Удалить профиль?')) return;
    memoryManager.deleteProfile(id);
    if (memoryManager.getCurrentProfileId() === id) {
      memoryManager.setCurrentProfileId(null);
    }
    renderProfileSelect(memoryManager);
    document.getElementById('profileName').value = '';
  });
}

function loadProfileUI(profile) {
  if (!profile) return;
  document.getElementById('profileName').value = profile.name || '';
  document.getElementById('profileRole').value = profile.role || '';
  document.getElementById('profileStyle').value = profile.style || 'concise';
  document.getElementById('profileFormat').value = profile.format || 'text';
  document.getElementById('profileLevel').value = profile.level || 'middle';
  document.getElementById('profileGoals').value = profile.goals || '';
}

function saveProfileUI(memoryManager) {
  const select = document.getElementById('profileSelect');
  const id = select.value;
  if (!id) return;
  const profile = {
    id,
    name: document.getElementById('profileName').value,
    role: document.getElementById('profileRole').value,
    style: document.getElementById('profileStyle').value,
    format: document.getElementById('profileFormat').value,
    level: document.getElementById('profileLevel').value,
    goals: document.getElementById('profileGoals').value,
  };
  memoryManager.saveProfile(profile);
  renderProfileSelect(memoryManager);
}

/* ===== Working Memory UI ===== */

function loadWorkingMemoryUI(memoryManager) {
  const wm = memoryManager.getWorkingMemory();
  document.getElementById('workingStage').value = wm.stage || '';
  document.getElementById('workingTaskDescription').value = wm.taskDescription || '';
  document.getElementById('workingPlan').value = wm.plan || '';
  document.getElementById('workingNotes').value = wm.notes || '';
}

function saveWorkingMemoryUI(memoryManager) {
  memoryManager.saveWorkingMemory({
    stage: document.getElementById('workingStage').value,
    taskDescription: document.getElementById('workingTaskDescription').value,
    plan: document.getElementById('workingPlan').value,
    notes: document.getElementById('workingNotes').value,
  });
}

function clearWorkingMemoryUI(memoryManager) {
  document.getElementById('workingStage').value = '';
  document.getElementById('workingTaskDescription').value = '';
  document.getElementById('workingPlan').value = '';
  document.getElementById('workingNotes').value = '';
  memoryManager.clearWorkingMemory();
}

/* ===== Long-Term Memory UI ===== */

function loadLongTermMemoryUI(memoryManager) {
  const lt = memoryManager.getLongTermDraft();
  document.getElementById('ltStack').value = lt.stack || '';
  document.getElementById('ltProhibitions').value = lt.prohibitions || '';
  document.getElementById('ltRules').value = lt.rules || '';
  document.getElementById('ltStyle').value = lt.style || '';
}

function autoSaveLongTermDraft(memoryManager) {
  memoryManager.saveLongTermDraft({
    stack: document.getElementById('ltStack').value,
    prohibitions: document.getElementById('ltProhibitions').value,
    rules: document.getElementById('ltRules').value,
    style: document.getElementById('ltStyle').value,
  });
}

function downloadLongTermMemory(memoryManager) {
  const data = {
    stack: document.getElementById('ltStack').value,
    prohibitions: document.getElementById('ltProhibitions').value,
    rules: document.getElementById('ltRules').value,
    style: document.getElementById('ltStyle').value,
  };
  const md = memoryManager.generateMarkdown(data);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'invariants.md';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function clearLongTermMemoryUI(memoryManager) {
  document.getElementById('ltStack').value = '';
  document.getElementById('ltProhibitions').value = '';
  document.getElementById('ltRules').value = '';
  document.getElementById('ltStyle').value = '';
  memoryManager.clearLongTermDraft();
}

function uploadLongTermMemoryFromText(text, memoryManager) {
  const data = memoryManager.parseMarkdown(text);
  document.getElementById('ltStack').value = data.stack || '';
  document.getElementById('ltProhibitions').value = data.prohibitions || '';
  document.getElementById('ltRules').value = data.rules || '';
  document.getElementById('ltStyle').value = data.style || '';
  memoryManager.saveLongTermDraft(data);
}

/* ===== File upload handlers ===== */

function handleLongTermFile(file, memoryManager) {
  const reader = new FileReader();
  reader.onload = function (e) {
    uploadLongTermMemoryFromText(e.target.result, memoryManager);
  };
  reader.readAsText(file);
}

function setupLongTermDropZone(memoryManager) {
  const zone = document.getElementById('ltDropZone');
  const input = document.getElementById('ltFileInput');
  if (!zone) return;

  zone.addEventListener('dragover', function (e) {
    e.preventDefault();
    this.classList.add('drop-zone--over');
  });

  zone.addEventListener('dragleave', function (e) {
    e.preventDefault();
    this.classList.remove('drop-zone--over');
  });

  zone.addEventListener('drop', function (e) {
    e.preventDefault();
    this.classList.remove('drop-zone--over');
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].name.endsWith('.md')) {
      handleLongTermFile(files[0], memoryManager);
    } else {
      alert('Пожалуйста, загрузите файл с расширением .md');
    }
  });

  if (input) {
    input.addEventListener('change', function () {
      if (this.files.length > 0) {
        handleLongTermFile(this.files[0], memoryManager);
      }
    });
  }
}

function setupMemoryAutoSave(memoryManager) {
  const fields = [
    document.getElementById('ltStack'),
    document.getElementById('ltProhibitions'),
    document.getElementById('ltRules'),
    document.getElementById('ltStyle'),
  ];
  let timer = null;
  for (const field of fields) {
    if (!field) continue;
    field.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => autoSaveLongTermDraft(memoryManager), 500);
    });
  }
}

/* ===== Short-Term Memory View ===== */

function renderShortTermMessages() {
  const list = document.getElementById('stMessagesList');
  if (!list || !window.currentAgent) return;
  const history = window.currentAgent.getHistory();
  const nonSystem = history.filter(m => m.role !== 'system');
  const last5 = nonSystem.slice(-5);
  if (last5.length === 0) {
    list.innerHTML = '<div class="st-message-item" style="color:var(--text-muted)">Нет сообщений</div>';
    return;
  }
  list.innerHTML = last5.map(m => {
    const role = m.role === 'assistant' ? 'bot' : m.role;
    return `<div class="st-message-item st-message-item--${role}"><strong>${role === 'user' ? 'User' : 'Bot'}:</strong> ${escapeHtml(m.content.slice(0, 150))}${m.content.length > 150 ? '...' : ''}</div>`;
  }).join('');
}

function updateShortTermIndicator() {
  const el = document.getElementById('stMemoryIndicator');
  if (!el || !window.currentAgent) return;
  const count = window.currentAgent.getHistory().filter(m => m.role !== 'system').length;
  el.textContent = 'Сообщений: ' + count;
}
