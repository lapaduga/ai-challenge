'use strict';

const memoryManager = new MemoryManager(document.getElementById('modelSelect').value);
window.memoryManager = memoryManager;

initSidebar();
initMemoryTabs();
initBurger();

loadWorkingMemoryUI(memoryManager);
loadLongTermMemoryUI(memoryManager);

document.getElementById('saveWorkingBtn').addEventListener('click', () => saveWorkingMemoryUI(memoryManager));
document.getElementById('clearWorkingBtn').addEventListener('click', () => clearWorkingMemoryUI(memoryManager));
document.getElementById('saveLongTermBtn').addEventListener('click', () => { downloadLongTermMemory(memoryManager); autoSaveLongTermDraft(memoryManager); });
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
