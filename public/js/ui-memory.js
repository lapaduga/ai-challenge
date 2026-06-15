/* ===== UI Memory Panels — контроллеры для трёх блоков памяти ===== */

/* ===== Working Memory UI ===== */
const workingStage = document.getElementById('workingStage');
const workingTaskDescription = document.getElementById('workingTaskDescription');
const workingPlan = document.getElementById('workingPlan');
const workingNotes = document.getElementById('workingNotes');
const saveWorkingBtn = document.getElementById('saveWorkingBtn');
const clearWorkingBtn = document.getElementById('clearWorkingBtn');
const workingMemoryIndicator = document.getElementById('workingMemoryIndicator');

function loadWorkingMemoryUI(memoryManager) {
  const wm = memoryManager.getWorkingMemory();
  workingStage.value = wm.stage || '';
  workingTaskDescription.value = wm.taskDescription || '';
  workingPlan.value = wm.plan || '';
  workingNotes.value = wm.notes || '';
  updateWorkingMemoryIndicator(memoryManager);
}

function saveWorkingMemoryUI(memoryManager) {
  const data = {
    stage: workingStage.value,
    taskDescription: workingTaskDescription.value,
    plan: workingPlan.value,
    notes: workingNotes.value,
  };
  memoryManager.saveWorkingMemory(data);
  updateWorkingMemoryIndicator(memoryManager);
}

function clearWorkingMemoryUI(memoryManager) {
  workingStage.value = '';
  workingTaskDescription.value = '';
  workingPlan.value = '';
  workingNotes.value = '';
  memoryManager.clearWorkingMemory();
  updateWorkingMemoryIndicator(memoryManager);
}

function updateWorkingMemoryIndicator(memoryManager) {
  if (!workingMemoryIndicator) return;
  const empty = memoryManager.isWorkingMemoryEmpty();
  workingMemoryIndicator.textContent = empty ? 'Пусто' : 'Есть данные';
  workingMemoryIndicator.className = 'memory-indicator' + (empty ? '' : ' memory-indicator--active');
}

/* ===== Long-Term Memory UI ===== */
const ltStack = document.getElementById('ltStack');
const ltProhibitions = document.getElementById('ltProhibitions');
const ltRules = document.getElementById('ltRules');
const ltStyle = document.getElementById('ltStyle');
const saveLongTermBtn = document.getElementById('saveLongTermBtn');
const clearLongTermBtn = document.getElementById('clearLongTermBtn');
const ltFileInput = document.getElementById('ltFileInput');
const ltDropZone = document.getElementById('ltDropZone');
const longTermMemoryIndicator = document.getElementById('longTermMemoryIndicator');

function loadLongTermMemoryUI(memoryManager) {
  const draft = memoryManager.getLongTermDraft();
  ltStack.value = draft.stack || '';
  ltProhibitions.value = draft.prohibitions || '';
  ltRules.value = draft.rules || '';
  ltStyle.value = draft.style || '';
  updateLongTermMemoryIndicator(memoryManager);
}

function autoSaveLongTermDraft(memoryManager) {
  const data = {
    stack: ltStack.value,
    prohibitions: ltProhibitions.value,
    rules: ltRules.value,
    style: ltStyle.value,
  };
  memoryManager.saveLongTermDraft(data);
  updateLongTermMemoryIndicator(memoryManager);
}

function updateLongTermMemoryIndicator(memoryManager) {
  if (!longTermMemoryIndicator) return;
  const draft = memoryManager.getLongTermDraft();
  const empty = memoryManager.isLongTermEmpty(draft);
  if (!empty) {
    const filled = [];
    if (draft.stack) filled.push('стек');
    if (draft.prohibitions) filled.push('запреты');
    if (draft.rules) filled.push('правила');
    if (draft.style) filled.push('стиль');
    longTermMemoryIndicator.textContent = 'Заполнено: ' + filled.join(', ');
    longTermMemoryIndicator.className = 'memory-indicator memory-indicator--active';
  } else {
    longTermMemoryIndicator.textContent = 'Не заполнена';
    longTermMemoryIndicator.className = 'memory-indicator';
  }
}

function downloadLongTermMemory(memoryManager) {
  const data = {
    stack: ltStack.value,
    prohibitions: ltProhibitions.value,
    rules: ltRules.value,
    style: ltStyle.value,
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

function uploadLongTermMemoryFromText(text, memoryManager) {
  const data = memoryManager.parseMarkdown(text);
  ltStack.value = data.stack || '';
  ltProhibitions.value = data.prohibitions || '';
  ltRules.value = data.rules || '';
  ltStyle.value = data.style || '';
  memoryManager.saveLongTermDraft(data);
  updateLongTermMemoryIndicator(memoryManager);
}

function clearLongTermMemoryUI(memoryManager) {
  ltStack.value = '';
  ltProhibitions.value = '';
  ltRules.value = '';
  ltStyle.value = '';
  memoryManager.clearLongTermDraft();
  updateLongTermMemoryIndicator(memoryManager);
}

/* ===== File upload handlers ===== */

function handleLongTermFile(file, memoryManager) {
  const reader = new FileReader();
  reader.onload = function (e) {
    const text = e.target.result;
    uploadLongTermMemoryFromText(text, memoryManager);
  };
  reader.readAsText(file);
}

function setupLongTermDropZone(memoryManager) {
  if (!ltDropZone) return;

  ltDropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    this.classList.add('drop-zone--over');
  });

  ltDropZone.addEventListener('dragleave', function (e) {
    e.preventDefault();
    this.classList.remove('drop-zone--over');
  });

  ltDropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    this.classList.remove('drop-zone--over');
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].name.endsWith('.md')) {
      handleLongTermFile(files[0], memoryManager);
    } else {
      alert('Пожалуйста, загрузите файл с расширением .md');
    }
  });

  if (ltFileInput) {
    ltFileInput.addEventListener('change', function () {
      if (this.files.length > 0) {
        handleLongTermFile(this.files[0], memoryManager);
      }
    });
  }
}

/* ===== Memory Panel Enable/Disable Toggles ===== */

function syncEnableCheckboxes(memoryManager) {
  const ltCb = document.getElementById('longTermEnabledCb');
  const wmCb = document.getElementById('workingEnabledCb');
  if (ltCb) ltCb.checked = memoryManager.longTermEnabled;
  if (wmCb) wmCb.checked = memoryManager.workingEnabled;
}

function setupEnableToggles(memoryManager) {
  const ltCb = document.getElementById('longTermEnabledCb');
  const wmCb = document.getElementById('workingEnabledCb');
  if (ltCb) {
    ltCb.addEventListener('change', function () {
      memoryManager.longTermEnabled = this.checked;
      memoryManager.saveEnableFlags();
    });
  }
  if (wmCb) {
    wmCb.addEventListener('change', function () {
      memoryManager.workingEnabled = this.checked;
      memoryManager.saveEnableFlags();
    });
  }
}

/* ===== Memory Panel Auto-save ===== */

function setupMemoryAutoSave(memoryManager) {
  const autoSaveFields = [ltStack, ltProhibitions, ltRules, ltStyle];
  let autoSaveTimer = null;
  for (const field of autoSaveFields) {
    if (!field) continue;
    field.addEventListener('input', function () {
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(function () {
        autoSaveLongTermDraft(memoryManager);
      }, 500);
    });
  }
}
