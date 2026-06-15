/* ===== Инициализация и связывание модулей ===== */

/* ===== Создание MemoryManager ===== */
const memoryManager = new MemoryManager(modelSelect.value);
window.memoryManager = memoryManager;

/* ===== Загрузка UI памятей ===== */
loadWorkingMemoryUI(memoryManager);
loadLongTermMemoryUI(memoryManager);

/* ===== Memory Panel Event Listeners ===== */
if (saveWorkingBtn) {
  saveWorkingBtn.addEventListener('click', function () {
    saveWorkingMemoryUI(memoryManager);
  });
}

if (clearWorkingBtn) {
  clearWorkingBtn.addEventListener('click', function () {
    clearWorkingMemoryUI(memoryManager);
  });
}

if (saveLongTermBtn) {
  saveLongTermBtn.addEventListener('click', function () {
    downloadLongTermMemory(memoryManager);
    autoSaveLongTermDraft(memoryManager);
  });
}

if (clearLongTermBtn) {
  clearLongTermBtn.addEventListener('click', function () {
    clearLongTermMemoryUI(memoryManager);
  });
}

/* ===== Drag-n-drop и автосохранение долговременной памяти ===== */
setupLongTermDropZone(memoryManager);
setupMemoryAutoSave(memoryManager);

/* ===== Model-change sync ===== */
modelSelect.addEventListener('change', function () {
  updateTempOptions();
  rebuildAgent();
  if (window.memoryManager) {
    window.memoryManager.modelKey = this.value;
    window.memoryManager.loadEnableFlags();
    syncEnableCheckboxes(window.memoryManager);
    loadWorkingMemoryUI(window.memoryManager);
  }
});

/* ===== Загрузка флагов включения слоёв ===== */
memoryManager.loadEnableFlags();
syncEnableCheckboxes(memoryManager);
setupEnableToggles(memoryManager);

/* ===== Инициализация ===== */
loadCurrentStrategy();
updateTempOptions();
loadAllHistories();

if (strategySelect) {
  strategySelect.value = currentStrategy;
}

rebuildAgent();
