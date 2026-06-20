'use strict';

const memoryManager = new MemoryManager(document.getElementById('modelSelect').value);
window.memoryManager = memoryManager;

const taskStorage = new TaskStorage();
window.taskStorage = taskStorage;

initSidebar();
initMemoryTabs();
initBurger();

loadWorkingMemoryUI(memoryManager);
loadLongTermMemoryUI(memoryManager);

document.getElementById('saveWorkingBtn').addEventListener('click', () => saveWorkingMemoryUI(memoryManager));
document.getElementById('clearWorkingBtn').addEventListener('click', () => clearWorkingMemoryUI(memoryManager));
document.getElementById('saveLongTermBtn').addEventListener('click', () => { autoSaveLongTermDraft(memoryManager); });
document.getElementById('clearLongTermBtn').addEventListener('click', () => clearLongTermMemoryUI(memoryManager));
document.getElementById('saveProfileBtn').addEventListener('click', () => saveProfileUI(memoryManager));

setupLongTermDropZone(memoryManager);
setupMemoryAutoSave(memoryManager);
initProfiles(memoryManager);
renderProfileSelect(memoryManager);

if (memoryManager.getCurrentProfileId()) {
  const profiles = memoryManager.getProfiles();
  const profile = profiles.find(p => p.id === memoryManager.getCurrentProfileId());
  if (profile) {
    document.getElementById('profileSelect').value = profile.id;
    loadProfileUI(profile);
  }
}

loadCurrentStrategy();
updateTempOptions();
loadAllHistories();

document.getElementById('strategySelect').value = currentStrategy;
rebuildAgent();

/* ===== Orchestrator + Task UI Init ===== */
let orchestrator = null;

function initOrchestrator() {
  const modelKey = document.getElementById('modelSelect').value;
  const settings = { modelKey };
  orchestrator = new OrchestratorAgent(settings, memoryManager, taskStorage);
  orchestrator.createAgents();
  window.orchestrator = orchestrator;

  window.appUI.orchestrator = orchestrator;

  window.appUI.onApproveStage = async () => {
    if (!orchestrator || orchestrator.taskFSM.isIdle()) return;
    sendBtn.disabled = true;
    showTyping();
    try {
      const r = await orchestrator.handleApprove();
      hideTyping();
      if (r.response) addMessage('bot', r.response);
      updateTaskUI(orchestrator, taskStorage);
    } catch (e) {
      hideTyping();
      addMessage('error', 'Ошибка: ' + e.message);
    } finally {
      sendBtn.disabled = false;
    }
  };

  window.appUI.onRejectStage = async (feedback) => {
    if (!orchestrator || orchestrator.taskFSM.isIdle()) return;
    sendBtn.disabled = true;
    showTyping();
    try {
      const r = await orchestrator.processUserInput('переделать, ' + feedback);
      hideTyping();
      if (r.response) addMessage('bot', r.response);
      updateTaskUI(orchestrator, taskStorage);
    } catch (e) {
      hideTyping();
      addMessage('error', 'Ошибка: ' + e.message);
    } finally {
      sendBtn.disabled = false;
    }
  };

  window.appUI.onPauseTask = async () => {
    if (!orchestrator || orchestrator.taskFSM.isIdle()) return;
    sendBtn.disabled = true;
    showTyping();
    try {
      const r = await orchestrator.processUserInput('пауза');
      hideTyping();
      if (r.response) addMessage('bot', r.response);
      updateTaskUI(orchestrator, taskStorage);
    } catch (e) {
      hideTyping();
      addMessage('error', 'Ошибка: ' + e.message);
    } finally {
      sendBtn.disabled = false;
    }
  };

  window.appUI.onResumeTask = async () => {
    if (!orchestrator || !orchestrator.taskFSM.isPaused()) return;
    sendBtn.disabled = true;
    showTyping();
    try {
      const r = await orchestrator.processUserInput('продолжить');
      hideTyping();
      if (r.response) addMessage('bot', r.response);
      updateTaskUI(orchestrator, taskStorage);
    } catch (e) {
      hideTyping();
      addMessage('error', 'Ошибка: ' + e.message);
    } finally {
      sendBtn.disabled = false;
    }
  };

  window.appUI.onLoadTask = async (taskId) => {
    if (!orchestrator) return;
    try {
      const ok = await orchestrator.loadTaskState(taskId);
      if (ok) {
        addMessage('bot', `Продолжаем задачу ${taskId}. Текущий этап: ${orchestrator.taskFSM.getCurrentStage()}.`);
        updateTaskUI(orchestrator, taskStorage);
      } else {
        addMessage('bot', 'Не удалось загрузить задачу. Возможно, она была сохранена в старом формате или повреждена.');
      }
    } catch (e) {
      addMessage('error', 'Ошибка загрузки задачи: ' + e.message);
    }
  };

  window.appUI.onTaskCancelled = () => {
    updateTaskUI(orchestrator, taskStorage);
    addMessage('bot', 'Задача отменена.');
  };

  const autoPilotCheckbox = document.getElementById('autoPilotCheckbox');
  if (autoPilotCheckbox) {
    autoPilotCheckbox.addEventListener('change', function () {
      orchestrator.setAutoPilot(this.checked);
      updateTaskUI(orchestrator, taskStorage);
    });
  }

  updateTaskUI(orchestrator, taskStorage);
  setupTaskUIListeners(orchestrator, taskStorage);

  // auto-restore last active task
  (async () => {
    try {
      const lastId = localStorage.getItem('orch_lastTaskId');
      if (!lastId) return;
      const tasks = await taskStorage.getActiveTasks();
      if (tasks.some(t => t.taskId === lastId)) {
        const ok = await orchestrator.loadTaskState(lastId);
        if (ok) {
          addMessage('bot', `🔄 Восстановлена задача ${lastId}. Этап: ${orchestrator.taskFSM.getCurrentStage()}. Продолжайте с того же места.`);
          updateTaskUI(orchestrator, taskStorage);
        }
      }
    } catch (e) {
      console.warn('Auto-restore task failed:', e.message);
    }
  })();
}

initOrchestrator();

window.addEventListener('memory-ready', () => {
  loadWorkingMemoryUI(memoryManager);
  loadLongTermMemoryUI(memoryManager);
  renderProfileSelect(memoryManager);
  if (memoryManager.getCurrentProfileId()) {
    const profiles = memoryManager.getProfiles();
    const profile = profiles.find(p => p.id === memoryManager.getCurrentProfileId());
    if (profile) loadProfileUI(profile);
  }
  checkStartInterview();
  appReady = true;
});
