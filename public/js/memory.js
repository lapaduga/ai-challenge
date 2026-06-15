/* ===== MemoryManager — три слоя памяти ассистента ===== */

class MemoryManager {
  constructor(modelKey) {
    this.modelKey = modelKey;
    this.longTermEnabled = true;
    this.workingEnabled = true;
  }

  getEnableKey(prefix) {
    return 'ai-challenge-' + prefix + '-enabled-' + this.modelKey;
  }

  loadEnableFlags() {
    try {
      const lt = localStorage.getItem(this.getEnableKey('longterm'));
      if (lt !== null) this.longTermEnabled = lt === 'true';
      const wm = localStorage.getItem(this.getEnableKey('working'));
      if (wm !== null) this.workingEnabled = wm === 'true';
    } catch (e) { /* ignore */ }
  }

  saveEnableFlags() {
    try {
      localStorage.setItem(this.getEnableKey('longterm'), this.longTermEnabled);
      localStorage.setItem(this.getEnableKey('working'), this.workingEnabled);
    } catch (e) { /* ignore */ }
  }

  /* ===== 1. Рабочая память (Working Memory) ===== */

  getWorkingStorageKey() {
    return 'ai-challenge-working-' + this.modelKey;
  }

  getWorkingMemory() {
    try {
      const raw = localStorage.getItem(this.getWorkingStorageKey());
      if (!raw) return { stage: '', taskDescription: '', plan: '', notes: '' };
      return JSON.parse(raw);
    } catch (e) {
      return { stage: '', taskDescription: '', plan: '', notes: '' };
    }
  }

  saveWorkingMemory(data) {
    try {
      localStorage.setItem(this.getWorkingStorageKey(), JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }

  clearWorkingMemory() {
    try {
      localStorage.removeItem(this.getWorkingStorageKey());
    } catch (e) { /* ignore */ }
  }

  isWorkingMemoryEmpty() {
    const wm = this.getWorkingMemory();
    return !wm.stage && !wm.taskDescription && !wm.plan && !wm.notes;
  }

  /* ===== 2. Долговременная память (Long-Term Memory) ===== */

  getLongTermDraftKey() {
    return 'ai-challenge-longterm-draft';
  }

  getLongTermDraft() {
    try {
      const raw = localStorage.getItem(this.getLongTermDraftKey());
      if (!raw) return { stack: '', prohibitions: '', rules: '', style: '' };
      return JSON.parse(raw);
    } catch (e) {
      return { stack: '', prohibitions: '', rules: '', style: '' };
    }
  }

  saveLongTermDraft(data) {
    try {
      localStorage.setItem(this.getLongTermDraftKey(), JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }

  clearLongTermDraft() {
    try {
      localStorage.removeItem(this.getLongTermDraftKey());
    } catch (e) { /* ignore */ }
  }

  isLongTermEmpty(data) {
    if (!data) data = this.getLongTermDraft();
    return !data.stack && !data.prohibitions && !data.rules && !data.style;
  }

  generateMarkdown(data) {
    let md = '# Инварианты (Долговременная память)\n\n';
    md += '> Профиль пользователя и неизменные правила проекта\n\n';
    md += '## Технологический стек\n';
    md += (data.stack || '_не указан_') + '\n\n';
    md += '## Запреты\n';
    md += (data.prohibitions || '_не указаны_') + '\n\n';
    md += '## Правила проекта\n';
    md += (data.rules || '_не указаны_') + '\n\n';
    md += '## Стиль общения\n';
    md += (data.style || '_не указан_') + '\n\n';
    return md;
  }

  parseMarkdown(text) {
    const result = { stack: '', prohibitions: '', rules: '', style: '' };
    const sections = text.split(/^##\s+/m);
    for (const section of sections) {
      const lines = section.split('\n');
      const header = lines[0].trim().toLowerCase();
      const content = lines.slice(1).join('\n').replace(/^>\s?/gm, '').trim();
      if (header === 'технологический стек') {
        result.stack = content.replace(/^_не указан_$/m, '').trim();
      } else if (header === 'запреты') {
        result.prohibitions = content.replace(/^_не указаны_$/m, '').trim();
      } else if (header === 'правила проекта') {
        result.rules = content.replace(/^_не указаны_$/m, '').trim();
      } else if (header === 'стиль общения') {
        result.style = content.replace(/^_не указан_$/m, '').trim();
      }
    }
    return result;
  }

  /* ===== 3. Краткосрочная память (Short-Term Memory) — индикатор ===== */

  getShortTermMessageCount(agent) {
    if (!agent) return 0;
    return agent.getHistory().filter(m => m.role !== 'system').length;
  }

  /* ===== 4. Интеграция: построение промпта с memory layers ===== */

  formatLongTermPrompt(data) {
    const parts = [];
    if (data.stack) parts.push('Стек: ' + data.stack);
    if (data.prohibitions) parts.push('Запреты: ' + data.prohibitions);
    if (data.rules) parts.push('Правила: ' + data.rules);
    if (data.style) parts.push('Стиль: ' + data.style);
    return 'ИНВАРИАНТЫ (долговременная память):\n' + parts.join('\n');
  }

  formatWorkingPrompt(data) {
    let text = 'РАБОЧАЯ ПАМЯТЬ (текущая задача):\n';
    if (data.stage) text += 'Этап: ' + data.stage + '\n';
    if (data.taskDescription) text += 'Описание: ' + data.taskDescription + '\n';
    if (data.plan) text += 'План: ' + data.plan + '\n';
    if (data.notes) text += 'Заметки: ' + data.notes;
    return text.trim();
  }

  wrapMessages(baseMessages) {
    if (!baseMessages || baseMessages.length === 0) return baseMessages;

    const first = baseMessages[0];
    const rest = baseMessages.slice(1);
    const inserts = [];

    if (this.longTermEnabled) {
      const lt = this.getLongTermDraft();
      if (!this.isLongTermEmpty(lt)) {
        inserts.push({ role: 'system', content: this.formatLongTermPrompt(lt) });
      }
    }

    if (this.workingEnabled) {
      const wm = this.getWorkingMemory();
      if (wm.stage) {
        inserts.push({ role: 'system', content: this.formatWorkingPrompt(wm) });
      }
    }

    return [first, ...inserts, ...rest];
  }
}
