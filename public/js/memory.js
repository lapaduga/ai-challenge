'use strict';

class IndexedDBStorage {
  constructor(dbName = 'AIChallenge', storeName = 'memory') {
    this.storeName = storeName;
    this.db = null;
    this.ready = this._open(dbName);
  }

  _open(dbName) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async get(key) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
      req.onerror = () => reject(req.error);
    });
  }

  async set(key, value) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async delete(key) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

class MemoryManager {
  constructor(modelKey) {
    this.modelKey = modelKey;
    this._cache = {
      working: { stage: '', taskDescription: '', plan: '', notes: '' },
      longTerm: { stack: '', prohibitions: '', rules: '', style: '' },
      enableFlags: { longterm: true, working: true },
      profiles: [],
      currentProfileId: null,
    };
    this._interviewState = { active: false, step: 0, answers: {} };
    this._db = new IndexedDBStorage();
    this._initPromise = this._migrateFromLocalStorage();
  }

  static get INTERVIEW_QUESTIONS() {
    return [
      { key: 'style', question: 'Какой стиль ответов тебе удобен? (краткий / подробный / формальный / разговорный)' },
      { key: 'format', question: 'В каком формате удобно получать ответы? (текст / markdown / списки / код)' },
      { key: 'level', question: 'Какой у тебя уровень? (junior / middle / senior / lead)' },
      { key: 'role', question: 'Кем ты работаешь? (developer, designer, менеджер и т.д.)' },
      { key: 'goals', question: 'Какая цель использования ассистента? (кратко)' },
    ];
  }

  startInterview() {
    this._interviewState = { active: true, step: 0, answers: {} };
  }

  getInterviewState() {
    return this._interviewState;
  }

  setInterviewAnswer(answer) {
    const qs = MemoryManager.INTERVIEW_QUESTIONS;
    if (this._interviewState.step < qs.length) {
      this._interviewState.answers[qs[this._interviewState.step].key] = answer;
      this._interviewState.step++;
    }
  }

  finishInterview() {
    const a = this._interviewState.answers;
    const id = 'profile_' + Date.now();
    const profile = {
      id,
      name: a.role || 'Пользователь',
      role: a.role || '',
      style: a.style || 'concise',
      format: a.format || 'text',
      level: a.level || 'middle',
      goals: a.goals || '',
    };
    this.saveProfile(profile);
    this.setCurrentProfileId(id);
    this._interviewState = { active: false, step: 0, answers: {} };
  }

  async _migrateFromLocalStorage() {
    try {
      await this._db.ready;

      const wmKey = this.getWorkingStorageKey();
      let val = await this._db.get(wmKey);
      if (!val) {
        const raw = localStorage.getItem(wmKey);
        if (raw) { val = JSON.parse(raw); await this._db.set(wmKey, val); }
      }
      if (val) this._cache.working = val;

      const ltKey = this.getLongTermDraftKey();
      val = await this._db.get(ltKey);
      if (!val) {
        const raw = localStorage.getItem(ltKey);
        if (raw) { val = JSON.parse(raw); await this._db.set(ltKey, val); }
      }
      if (val) this._cache.longTerm = val;

      const ltFlagKey = this.getEnableKey('longterm');
      let flag = await this._db.get(ltFlagKey);
      if (flag === undefined) {
        const raw = localStorage.getItem(ltFlagKey);
        if (raw !== null) { flag = raw === 'true'; await this._db.set(ltFlagKey, flag); }
      }
      if (flag !== undefined) this._cache.enableFlags.longterm = flag;

      const wmFlagKey = this.getEnableKey('working');
      flag = await this._db.get(wmFlagKey);
      if (flag === undefined) {
        const raw = localStorage.getItem(wmFlagKey);
        if (raw !== null) { flag = raw === 'true'; await this._db.set(wmFlagKey, flag); }
      }
      if (flag !== undefined) this._cache.enableFlags.working = flag;

      const profiles = await this._db.get('ai-challenge-profiles');
      if (profiles) this._cache.profiles = profiles;

      const currentProfileId = await this._db.get('ai-challenge-current-profile');
      if (currentProfileId !== undefined) this._cache.currentProfileId = currentProfileId;

      window.dispatchEvent(new CustomEvent('memory-ready'));
    } catch (e) {
      console.warn('IndexedDB init:', e.message);
    }
  }

  getEnableKey(prefix) {
    return 'ai-challenge-' + prefix + '-enabled-' + this.modelKey;
  }

  getWorkingStorageKey() {
    return 'ai-challenge-working-' + this.modelKey;
  }

  getLongTermDraftKey() {
    return 'ai-challenge-longterm-draft';
  }

  loadEnableFlags() {
    return this._cache.enableFlags;
  }

  saveEnableFlags() {
    this._db.set(this.getEnableKey('longterm'), this._cache.enableFlags.longterm).catch(() => {});
    this._db.set(this.getEnableKey('working'), this._cache.enableFlags.working).catch(() => {});
  }

  get longTermEnabled() { return this._cache.enableFlags.longterm; }
  set longTermEnabled(v) { this._cache.enableFlags.longterm = v; this.saveEnableFlags(); }

  get workingEnabled() { return this._cache.enableFlags.working; }
  set workingEnabled(v) { this._cache.enableFlags.working = v; this.saveEnableFlags(); }

  getWorkingMemory() {
    return { ...this._cache.working };
  }

  saveWorkingMemory(data) {
    this._cache.working = { ...data };
    this._db.set(this.getWorkingStorageKey(), this._cache.working).catch(() => {});
  }

  clearWorkingMemory() {
    this._cache.working = { stage: '', taskDescription: '', plan: '', notes: '' };
    this._db.delete(this.getWorkingStorageKey()).catch(() => {});
  }

  isWorkingMemoryEmpty() {
    const w = this._cache.working;
    return !w.stage && !w.taskDescription && !w.plan && !w.notes;
  }

  getLongTermDraft() {
    return { ...this._cache.longTerm };
  }

  saveLongTermDraft(data) {
    this._cache.longTerm = { ...data };
    this._db.set(this.getLongTermDraftKey(), this._cache.longTerm).catch(() => {});
  }

  clearLongTermDraft() {
    this._cache.longTerm = { stack: '', prohibitions: '', rules: '', style: '' };
    this._db.delete(this.getLongTermDraftKey()).catch(() => {});
  }

  isLongTermEmpty(data) {
    if (!data) data = this._cache.longTerm;
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

  getShortTermMessageCount(agent) {
    if (!agent) return 0;
    return agent.getHistory().filter(m => m.role !== 'system').length;
  }

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

    const profile = this.getCurrentProfile();
    if (profile) {
      const parts = [];
      if (profile.role) parts.push('Роль: ' + profile.role);
      if (profile.level) parts.push('Уровень: ' + profile.level);
      if (profile.style) parts.push('Стиль: ' + profile.style);
      if (profile.format) parts.push('Формат: ' + profile.format);
      if (profile.goals) parts.push('Цели: ' + profile.goals);
      if (parts.length > 0) {
        inserts.push({ role: 'system', content: 'ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ:\n' + parts.join('\n') });
      }
    }

    if (this._cache.enableFlags.longterm) {
      const lt = this._cache.longTerm;
      if (!this.isLongTermEmpty(lt)) {
        inserts.push({ role: 'system', content: this.formatLongTermPrompt(lt) });
      }
    }

    if (this._cache.enableFlags.working) {
      const wm = this._cache.working;
      if (wm.stage) {
        inserts.push({ role: 'system', content: this.formatWorkingPrompt(wm) });
      }
    }

    return [first, ...inserts, ...rest];
  }

  getProfiles() {
    return [...this._cache.profiles];
  }

  getCurrentProfileId() {
    return this._cache.currentProfileId;
  }

  setCurrentProfileId(id) {
    this._cache.currentProfileId = id;
    this._db.set('ai-challenge-current-profile', id).catch(() => {});
  }

  getCurrentProfile() {
    if (!this._cache.currentProfileId) return null;
    return this._cache.profiles.find(p => p.id === this._cache.currentProfileId) || null;
  }

  saveProfile(profile) {
    const idx = this._cache.profiles.findIndex(p => p.id === profile.id);
    if (idx >= 0) {
      this._cache.profiles[idx] = profile;
    } else {
      this._cache.profiles.push(profile);
    }
    this._db.set('ai-challenge-profiles', this._cache.profiles).catch(() => {});
  }

  deleteProfile(id) {
    this._cache.profiles = this._cache.profiles.filter(p => p.id !== id);
    this._db.set('ai-challenge-profiles', this._cache.profiles).catch(() => {});
  }
}
