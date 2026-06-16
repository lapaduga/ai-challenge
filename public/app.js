/* ===== LLMAgent — инкапсулированный агент с приватной историей и стратегиями управления контекстом ===== */
class LLMAgent {
  #history;
  #meta;
  #totalTokensUsed = 0;
  #messageCounter = 0;
  #strategy;

  // Sliding Window
  #windowSize;
  #discardedCount;

  // Sticky Facts
  #facts;
  #factsWindowSize;

  // Branching
  #branches;
  #activeBranch;

  // Summary Compression
  #summaries;
  #totalCompressedMessages;
  #keepLastN;
  #compressEvery;

  constructor({ endpoint, model, systemPrompt, modelKey, strategy = 'sliding' }) {
    this.endpoint = endpoint;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.modelKey = modelKey;
    this.#strategy = strategy;

    this.#history = [{ role: 'system', content: systemPrompt }];
    this.#meta = [null];
    this.#totalTokensUsed = 0;
    this.#messageCounter = 0;

    // Sliding Window defaults
    this.#windowSize = 6;
    this.#discardedCount = 0;

    // Sticky Facts defaults
    this.#facts = {};
    this.#factsWindowSize = 4;

    // Branching defaults
    this.#branches = {};
    this.#activeBranch = 'main';
    this.#branches['main'] = { history: [{ role: 'system', content: systemPrompt }], meta: [null] };
    this.#syncHistoryFromBranch();

    // Summary Compression defaults
    this.#summaries = [];
    this.#totalCompressedMessages = 0;
    this.#keepLastN = 6;
    this.#compressEvery = 10;
  }

  getStrategy() {
    return this.#strategy;
  }

  setStrategy(strategy) {
    this.#strategy = strategy;
  }

  /* ===== Стратегия: Sliding Window ===== */

  setWindowSize(n) {
    this.#windowSize = Math.max(2, n);
  }

  getWindowSize() {
    return this.#windowSize;
  }

  getDiscardedCount() {
    return this.#discardedCount;
  }

  #applySlidingWindow() {
    const nonSystemIndices = [];
    for (let i = 0; i < this.#history.length; i++) {
      if (this.#history[i].role !== 'system') nonSystemIndices.push(i);
    }
    if (nonSystemIndices.length > this.#windowSize) {
      const toRemove = nonSystemIndices.length - this.#windowSize;
      const removeSet = new Set(nonSystemIndices.slice(0, toRemove));
      this.#history = this.#history.filter((_, i) => !removeSet.has(i));
      this.#meta = this.#meta.filter((_, i) => !removeSet.has(i));
      this.#discardedCount += toRemove;
    }
  }

  /* ===== Стратегия: Sticky Facts ===== */

  getFacts() {
    return { ...this.#facts };
  }

  getFactsWindowSize() {
    return this.#factsWindowSize;
  }

  async #extractFacts(userMessage) {
    const factsBefore = Object.entries(this.#facts).map(([k, v]) => `${k}: ${v}`).join('\n') || '(нет)';
    const lastMessages = this.#history
      .filter(m => m.role !== 'system')
      .slice(-6)
      .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
      .join('\n');

    const prompt = `Извлеки/обнови факты из этого диалога. Формат: ключ: значение.
Сохраняй: цель, ограничения, предпочтения, решения, договорённости.
Не дублируй существующие факты, обновляй изменённые.

Текущие факты:
${factsBefore}

Новое сообщение пользователя: ${userMessage}

Последний контекст диалога:
${lastMessages}

Ответь только списком фактов, каждый с новой строки в формате "ключ: значение". Если новых фактов нет, напиши "Нет новых фактов."`;

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: 'Ты — ассистент, извлекающий факты из диалога. Отвечай только списком ключ: значение.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0,
          max_tokens: 500,
        }),
      });

      if (!res.ok) return;

      const data = await res.json();
      const text = (data.choices?.[0]?.message?.content || '').trim();
      if (!text || text === 'Нет новых фактов.') return;

      const lines = text.split('\n');
      let updated = false;
      for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim();
          const value = line.slice(colonIdx + 1).trim();
          if (key && value) {
            if (this.#facts[key] !== value) {
              this.#facts[key] = value;
              updated = true;
            }
          }
        }
      }
      if (updated) {
        try {
          localStorage.setItem('ai-challenge-facts-' + this.modelKey, JSON.stringify(this.#facts));
        } catch (e) { /* ignore */ }
      }
    } catch (e) {
      console.warn('Fact extraction failed:', e.message);
    }
  }

  /* ===== Стратегия: Branching ===== */

  getBranches() {
    return Object.keys(this.#branches);
  }

  getActiveBranch() {
    return this.#activeBranch;
  }

  #syncHistoryFromBranch() {
    const branch = this.#branches[this.#activeBranch];
    if (branch) {
      this.#history = branch.history;
      this.#meta = branch.meta;
    }
  }

  #syncBranchFromHistory() {
    const branch = this.#branches[this.#activeBranch];
    if (branch) {
      branch.history = [...this.#history];
      branch.meta = [...this.#meta];
    }
  }

  createBranch(name) {
    if (this.#branches[name]) throw new Error(`Ветка "${name}" уже существует`);
    this.#syncBranchFromHistory();
    this.#branches[name] = {
      history: JSON.parse(JSON.stringify(this.#history)),
      meta: JSON.parse(JSON.stringify(this.#meta)),
    };
    return name;
  }

  switchBranch(name) {
    if (!this.#branches[name]) throw new Error(`Ветка "${name}" не найдена`);
    this.#syncBranchFromHistory();
    this.#activeBranch = name;
    this.#syncHistoryFromBranch();
  }

  /* ===== Стратегия: Summary Compression ===== */

  async #callSummary(text) {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'Ты — ассистент, который сжимает историю диалога в краткий пересказ. ВАЖНО: ответ пиши полностью в content, не используй reasoning. Сохрани ключевые факты, намерения пользователя, решения модели. Ответ должен быть связным текстом на русском языке, не более 200 слов.',
          },
          {
            role: 'user',
            content: `Сделай краткий пересказ следующего диалога:\n\n${text}`,
          },
        ],
        temperature: 0,
        max_tokens: 300,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    const msg = data.choices?.[0]?.message;
    const summaryText = (msg?.content || msg?.reasoning_content || '').trim();
    if (!summaryText) {
      console.warn('Unexpected summary response:', JSON.stringify(data).slice(0, 500));
      throw new Error('Empty summary from API');
    }
    return summaryText;
  }

  async #compressHistory(force = false) {
    const nonSystemCount = this.#history.filter(m => m.role !== 'system').length;
    if (nonSystemCount <= this.#keepLastN) return;
    if (!force && (this.#messageCounter === 0 || this.#messageCounter % this.#compressEvery !== 0)) return;

    const compressEnd = this.#history.length - this.#keepLastN;
    if (compressEnd <= 1) return;

    const toCompress = this.#history.slice(1, compressEnd);

    let textToCompress = '';
    for (const msg of toCompress) {
      textToCompress += `${msg.role}: ${msg.content}\n\n`;
    }

    const originalTokens = Math.ceil(textToCompress.length / 4);

    try {
      const summaryText = await this.#callSummary(textToCompress);
      const summaryTokens = Math.ceil(summaryText.length / 4);
      const ratio = originalTokens > 0
        ? Math.max(0, Math.min(100, Number(((originalTokens - summaryTokens) / originalTokens * 100).toFixed(1))))
        : 0;

      this.#totalCompressedMessages += compressEnd - 1;

      this.#summaries = [{
        text: summaryText,
        tokenCount: summaryTokens,
        compressionRatio: ratio,
      }];

      const systemMsg = this.#history[0];
      const lastNMessages = this.#history.slice(compressEnd);
      const lastNMeta = this.#meta.slice(compressEnd);

      this.#history = [systemMsg, ...lastNMessages];
      this.#meta = [null, ...lastNMeta];
    } catch (e) {
      console.warn('Compression failed, keeping full history:', e.message);
    }
  }

  /* ===== Получение сообщений для запроса ===== */

  getMessagesForRequest() {
    switch (this.#strategy) {
      case 'sliding':
        return [...this.#history];

      case 'facts': {
        const messages = [this.#history[0]];
        for (const [key, value] of Object.entries(this.#facts)) {
          messages.push({ role: 'system', content: `[Факт] ${key}: ${value}` });
        }
        const nonSystem = this.#history.filter(m => m.role !== 'system').slice(-this.#factsWindowSize);
        messages.push(...nonSystem);
        return messages;
      }

      case 'branching': {
        return [...this.#history];
      }

      case 'summary': {
        const result = [];
        for (const s of this.#summaries) {
          result.push({ role: 'system', content: `[Краткий пересказ предыдущей части диалога: ${s.text}]` });
        }
        for (let i = 0; i < this.#history.length; i++) {
          result.push(this.#history[i]);
        }
        return result;
      }

      default:
        return [...this.#history];
    }
  }

  /* ===== Отправка сообщения ===== */

  async send(userMessage, options = {}) {
    const start = Date.now();
    const temp = options.temperature ?? 0.7;
    const isConstrained = options.isConstrained ?? false;
    const skipStrategy = options.skipStrategy ?? false;

    let messages;
    if (isConstrained) {
      const constraint = '\n\nОтветь в виде маркированного списка (каждый пункт с новой строки, начинается с "- "). Максимум 5 пунктов. Заверши ответ ровно символом END.';
      messages = [
        ...this.getMessagesForRequest(),
        { role: 'user', content: `${userMessage}${constraint}` },
      ];
    } else {
      messages = [...this.getMessagesForRequest(), { role: 'user', content: userMessage }];
    }

    const body = {
      model: this.model,
      messages,
      temperature: temp,
    };

    if (isConstrained) {
      body.max_tokens = options.maxTokens ?? 500;
      body.stop = options.stop ?? ['END'];
    }

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const time = Date.now() - start;

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        res.status === 413
          ? 'Payload Too Large: запрос превысил лимит сервера'
          : `HTTP ${res.status}: ${text.slice(0, 200)}`
      );
    }

    const data = await res.json();

    if (data.error) throw new Error(data.error.message);

    const reply = data.choices[0].message.content;
    const usage = data.usage || {};
    const prompt = usage.prompt_tokens || 0;
    const completion = usage.completion_tokens || 0;
    const cost = COST[this.modelKey](prompt, completion);
    this.#totalTokensUsed += prompt + completion;

    if (this.#strategy === 'branching') {
      const branch = this.#branches[this.#activeBranch];
      branch.history.push({ role: 'user', content: userMessage });
      branch.history.push({ role: 'assistant', content: reply });
      branch.meta.push({ isConstrained });
      branch.meta.push({ time, prompt, completion, cost, isConstrained });
      this.#syncHistoryFromBranch();
    } else {
      this.#history.push({ role: 'user', content: userMessage });
      this.#history.push({ role: 'assistant', content: reply });
      this.#meta.push({ isConstrained });
      this.#meta.push({ time, prompt, completion, cost, isConstrained });
    }
    this.#messageCounter += 2;

    // Strategy-specific post-processing (skip for compareAll / scenario)
    if (!skipStrategy) {
      if (this.#strategy === 'sliding') {
        this.#applySlidingWindow();
      } else if (this.#strategy === 'facts') {
        await this.#extractFacts(userMessage);
      } else if (this.#strategy === 'summary') {
        if (this.#messageCounter > 0 && this.#messageCounter % this.#compressEvery === 0) {
          try {
            localStorage.setItem('ai-challenge-metrics-' + this.modelKey, JSON.stringify({ prompt, completion, time, cost }));
          } catch (e) { /* ignore */ }
        }
        await this.#compressHistory();
      }
    }

    return {
      reply,
      usage: { prompt, completion },
      time,
      cost,
    };
  }

  /* ===== Управление историей ===== */

  clearHistory() {
    this.#history = [{ role: 'system', content: this.systemPrompt }];
    this.#meta = [null];
    this.#totalTokensUsed = 0;
    this.#summaries = [];
    this.#messageCounter = 0;
    this.#totalCompressedMessages = 0;
    this.#discardedCount = 0;
    this.#facts = {};
    this.#branches = {
      main: { history: [{ role: 'system', content: this.systemPrompt }], meta: [null] }
    };
    this.#activeBranch = 'main';
    this.#syncHistoryFromBranch();
    try {
      localStorage.removeItem('ai-challenge-metrics-' + this.modelKey);
      localStorage.removeItem('ai-challenge-facts-' + this.modelKey);
    } catch (e) { /* ignore */ }
  }

  getTotalTokensUsed() {
    return this.#totalTokensUsed;
  }

  setSystemPrompt(newPrompt) {
    this.systemPrompt = newPrompt;
    this.clearHistory();
  }

  getHistory() {
    return this.#history;
  }

  getAllMeta() {
    return this.#meta;
  }

  getSummaries() {
    return this.#summaries;
  }

  getMessageCounter() {
    return this.#messageCounter;
  }

  getTotalCompressedMessages() {
    return this.#totalCompressedMessages;
  }

  loadState(data) {
    if (!data) return;
    if (data.history) this.#history = data.history;
    if (data.meta) this.#meta = data.meta;
    if (data.totalTokensUsed !== undefined) this.#totalTokensUsed = data.totalTokensUsed;
    if (data.messageCounter !== undefined) this.#messageCounter = data.messageCounter;
    if (data.windowSize !== undefined) this.#windowSize = data.windowSize;
    if (data.discardedCount !== undefined) this.#discardedCount = data.discardedCount;
    if (data.facts) this.#facts = data.facts;
    if (data.factsWindowSize !== undefined) this.#factsWindowSize = data.factsWindowSize;
    if (data.branches) {
      this.#branches = data.branches;
      // Ensure main exists
      if (!this.#branches['main']) {
        this.#branches['main'] = { history: [this.#history[0]], meta: [null] };
      }
    }
    if (data.activeBranch) {
      this.#activeBranch = data.activeBranch;
      this.#syncHistoryFromBranch();
    }
    if (data.summaries) this.#summaries = data.summaries;
    if (data.totalCompressedMessages !== undefined) this.#totalCompressedMessages = data.totalCompressedMessages;
  }

  getState() {
    const base = {
      totalTokensUsed: this.#totalTokensUsed,
      messageCounter: this.#messageCounter,
    };

    switch (this.#strategy) {
      case 'sliding':
        return {
          ...base,
          history: this.#history,
          meta: this.#meta,
          windowSize: this.#windowSize,
          discardedCount: this.#discardedCount,
        };
      case 'facts':
        return {
          ...base,
          history: this.#history,
          meta: this.#meta,
          facts: this.#facts,
          factsWindowSize: this.#factsWindowSize,
        };
      case 'branching':
        return {
          ...base,
          branches: this.#branches,
          activeBranch: this.#activeBranch,
        };
      case 'summary':
        return {
          ...base,
          history: this.#history,
          meta: this.#meta,
          summaries: this.#summaries,
          totalCompressedMessages: this.#totalCompressedMessages,
        };
      default:
        return { ...base, history: this.#history, meta: this.#meta };
    }
  }

  getLastMetricsBeforeCompression() {
    try {
      const raw = localStorage.getItem('ai-challenge-metrics-' + this.modelKey);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  estimateCompressionQuality() {
    if (this.#summaries.length === 0) return null;
    const last = this.#summaries[this.#summaries.length - 1];
    return {
      summaryTokens: last.tokenCount,
      compressionRatio: Math.max(0, last.compressionRatio),
    };
  }
}

/* ===== Конфигурация ===== */
const ENDPOINTS = {
  deepseek: '/api/chat',
  qwen: '/api/qwen',
  giga: '/api/giga',
};

const MODEL_API_NAMES = {
  deepseek: 'deepseek-v4-flash',
  qwen: 'qwen-turbo',
  giga: 'GigaChat',
};

const TEMP_OPTIONS = {
  deepseek: ['0', '0.7', '1.2', '2.0'],
  qwen: ['0', '0.3', '0.7', '1.0'],
  giga: ['0', '0.5', '0.7', '1.0'],
};

const COST = {
  deepseek: (p, c) => p * 0.0000001 + c * 0.0000005,
  qwen: (p, c) => p * 0.0000005 + c * 0.000001,
  giga: () => 'Бесплатно',
};

const MODEL_NAMES = { deepseek: 'DeepSeek', qwen: 'Qwen', giga: 'GigaChat' };

const STRATEGY_NAMES = {
  sliding: 'Sliding Window',
  facts: 'Sticky Facts',
  branching: 'Branching',
  summary: 'Summary Compression',
};

const SYSTEM_PROMPT = 'Ты полезный ассистент.';

/* ===== Состояние ===== */
let currentMode = 'free';
let currentAgent = null;
let currentStrategy = 'sliding';

const STRATEGY_KEYS = ['sliding', 'facts', 'branching', 'summary'];

const chatHistories = {};
for (const mk of ['deepseek', 'qwen', 'giga']) {
  chatHistories[mk] = {};
  for (const sk of STRATEGY_KEYS) {
    chatHistories[mk][sk] = null;
  }
}

/* ===== DOM ===== */
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const compareBtn = document.getElementById('compareBtn');
const modelSelect = document.getElementById('modelSelect');
const strategySelect = document.getElementById('strategySelect');
const tempSelect = document.getElementById('tempSelect');
const modeFree = document.getElementById('modeFree');
const modeConstrained = document.getElementById('modeConstrained');
const chat = document.querySelector('.chat');
const compareSection = document.getElementById('compareSection');
const compareGrid = document.getElementById('compareGrid');

/* Элементы сайдбара */
const statLastPrompt = document.getElementById('statLastPrompt');
const statTotalTokens = document.getElementById('statTotalTokens');
const statLastCompletion = document.getElementById('statLastCompletion');
const statHistoryCount = document.getElementById('statHistoryCount');
const statStrategyInfo = document.getElementById('statStrategyInfo');
const statStrategyDetail = document.getElementById('statStrategyDetail');

/* Элементы ветвления */
const branchControls = document.getElementById('branchControls');
const branchSelect = document.getElementById('branchSelect');
const createBranchBtn = document.getElementById('createBranchBtn');
/* Элементы фактов */
const factsDisplay = document.getElementById('factsDisplay');
const factsToggle = document.getElementById('factsToggle');
const factsList = document.getElementById('factsList');

/* ===== localStorage: сохранение / загрузка / очистка истории ===== */
const STORAGE_KEYS = {
  deepseek: 'ai-challenge-history-deepseek',
  qwen: 'ai-challenge-history-qwen',
  giga: 'ai-challenge-history-giga',
};

const STRATEGY_STORAGE_KEY = 'ai-challenge-current-strategy';

function saveCurrentStrategy() {
  try {
    localStorage.setItem(STRATEGY_STORAGE_KEY, currentStrategy);
  } catch (e) { /* ignore */ }
}

function loadCurrentStrategy() {
  try {
    const saved = localStorage.getItem(STRATEGY_STORAGE_KEY);
    if (saved && STRATEGY_KEYS.includes(saved)) {
      currentStrategy = saved;
    }
  } catch (e) { /* ignore */ }
}

function migrateHistoryIfNeeded(data) {
  if (!data) return null;
  // Version 2 format: { version: 2, sliding: {...}, facts: {...}, branching: {...} }
  if (data.version === 2) {
    return {
      sliding: data.sliding || null,
      facts: data.facts || null,
      branching: data.branching || null,
      summary: data.summary || null,
    };
  }
  // Unversioned new format: directly has strategy keys
  if (data.sliding !== undefined || data.facts !== undefined || data.branching !== undefined || data.summary !== undefined) {
    return {
      sliding: data.sliding || null,
      facts: data.facts || null,
      branching: data.branching || null,
      summary: data.summary || null,
    };
  }
  // Old format — has history directly
  if (data.history && Array.isArray(data.history)) {
    return {
      sliding: {
        history: data.history,
        meta: data.meta || null,
        totalTokensUsed: data.totalTokensUsed || 0,
        messageCounter: data.messageCounter || 0,
        windowSize: 6,
        discardedCount: data.totalCompressedMessages || 0,
      },
      facts: null,
      branching: null,
      summary: null,
    };
  }
  return null;
}

function saveAllHistories() {
  try {
    if (currentAgent) {
      const key = modelSelect.value;
      chatHistories[key][currentStrategy] = currentAgent.getState();
      const payload = { version: 2 };
      for (const sk of STRATEGY_KEYS) {
        payload[sk] = chatHistories[key][sk] || null;
      }
      localStorage.setItem(STORAGE_KEYS[key], JSON.stringify(payload));
    }
  } catch (e) {
    console.warn('Не удалось сохранить историю:', e.message);
  }
}

function loadAllHistories() {
  for (const mk of ['deepseek', 'qwen', 'giga']) {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS[mk]);
      if (raw) {
        const data = JSON.parse(raw);
        const migrated = migrateHistoryIfNeeded(data);
        if (migrated) {
          for (const sk of STRATEGY_KEYS) {
            chatHistories[mk][sk] = migrated[sk] || null;
          }
        }
      }
    } catch (e) {
      console.warn(`Не удалось загрузить историю для ${mk}:`, e.message);
    }
  }
}

function clearAllHistories() {
  for (const mk of ['deepseek', 'qwen', 'giga']) {
    localStorage.removeItem(STORAGE_KEYS[mk]);
    for (const sk of STRATEGY_KEYS) {
      chatHistories[mk][sk] = null;
    }
  }
  if (currentAgent) {
    currentAgent.clearHistory();
  }
  renderHistory();
  updateTokenStats();
  updateStrategyUI();
}

/* ===== Создание агента ===== */
function createAgent(modelKey, strategy) {
  const endpoint = ENDPOINTS[modelKey];
  const modelApiName = MODEL_API_NAMES[modelKey];
  return new LLMAgent({ endpoint, model: modelApiName, systemPrompt: SYSTEM_PROMPT, modelKey, strategy: strategy || currentStrategy });
}

function rebuildAgent() {
  const previous = modelSelect.dataset.previous;
  const newModel = modelSelect.value;
  const newStrategy = strategySelect ? strategySelect.value : currentStrategy;

  if (newStrategy !== currentStrategy) {
    currentStrategy = newStrategy;
    saveCurrentStrategy();
  }

  // Save current agent state
  if (currentAgent && previous) {
    chatHistories[previous][currentAgent.getStrategy()] = currentAgent.getState();
  }

  currentAgent = createAgent(newModel, newStrategy);

  // Load state for this model+strategy combination
  const saved = chatHistories[newModel]?.[newStrategy];
  if (saved) {
    currentAgent.loadState(saved);
  }

  modelSelect.dataset.previous = newModel;
  compareSection.classList.remove('show');
  renderHistory();
  updateTokenStats();
  updateStrategyUI();
}

/* ===== Стратегии ===== */
function onStrategyChange() {
  if (!strategySelect) return;
  const newStrategy = strategySelect.value;
  if (newStrategy === currentStrategy) return;

  // Save current state
  if (currentAgent) {
    const modelKey = modelSelect.value;
    chatHistories[modelKey][currentStrategy] = currentAgent.getState();
  }

  currentStrategy = newStrategy;
  saveCurrentStrategy();

  // Create new agent with new strategy
  const modelKey = modelSelect.value;
  currentAgent = createAgent(modelKey, currentStrategy);

  // Load saved state for this strategy
  const saved = chatHistories[modelKey]?.[currentStrategy];
  if (saved) {
    currentAgent.loadState(saved);
  }

  renderHistory();
  updateTokenStats();
  updateStrategyUI();
}

function updateStrategyUI() {
  // Branch controls
  if (branchControls) {
    branchControls.style.display = currentStrategy === 'branching' ? 'flex' : 'none';
  }

  // Facts display
  if (factsDisplay) {
    factsDisplay.style.display = currentStrategy === 'facts' ? 'block' : 'none';
  }

  // Update branch dropdown if visible
  if (currentStrategy === 'branching' && currentAgent) {
    updateBranchSelect();
  }

  // Update facts list if visible
  if (currentStrategy === 'facts' && currentAgent) {
    updateFactsList();
  }

  // Update strategy stats
  updateTokenStats();
}

/* ===== Branching UI ===== */
function updateBranchSelect() {
  if (!branchSelect || !currentAgent) return;
  const branches = currentAgent.getBranches();
  const active = currentAgent.getActiveBranch();
  branchSelect.innerHTML = branches.map(name =>
    `<option value="${name}"${name === active ? ' selected' : ''}>${name}${name === active ? ' ✓' : ''}</option>`
  ).join('');
}

function onBranchChange() {
  if (!branchSelect || !currentAgent) return;
  const name = branchSelect.value;
  if (name === currentAgent.getActiveBranch()) return;
  try {
    currentAgent.switchBranch(name);
    renderHistory();
    updateTokenStats();
    updateBranchSelect();
    saveAllHistories();
  } catch (e) {
    console.warn(e.message);
  }
}

function onCreateBranch() {
  if (!currentAgent) return;
  const name = prompt('Имя новой ветки:');
  if (!name || !name.trim()) return;
  try {
    currentAgent.createBranch(name.trim());
    currentAgent.switchBranch(name.trim());
    updateBranchSelect();
    renderHistory();
    updateTokenStats();
    saveAllHistories();
  } catch (e) {
    alert(e.message);
  }
}

/* ===== Facts UI ===== */
function updateFactsList() {
  if (!factsList || !currentAgent) return;
  const facts = currentAgent.getFacts();
  const entries = Object.entries(facts);
  if (entries.length === 0) {
    factsList.innerHTML = '<div class="facts-empty">Фактов пока нет</div>';
    return;
  }
  factsList.innerHTML = entries.map(([key, value]) =>
    `<div class="facts-item"><strong>${escapeHtml(key)}</strong>: ${escapeHtml(value)}</div>`
  ).join('');
}

/* ===== Рендеринг истории ===== */
function renderHistory() {
  messagesEl.innerHTML = '';
  const history = currentAgent.getHistory();
  const allMeta = currentAgent.getAllMeta();
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    if (msg.role === 'system') continue;

    const msgMeta = allMeta[i];
    const displayRole = msg.role === 'assistant' ? 'bot' : msg.role;
    const isConstrained = msgMeta?.isConstrained ?? false;

    fragment.appendChild(buildMessageEl(displayRole, msg.content, isConstrained, msgMeta));
  }

  messagesEl.appendChild(fragment);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* ===== Температура ===== */
function updateTempOptions() {
  const model = modelSelect.value;
  const options = TEMP_OPTIONS[model] || TEMP_OPTIONS.deepseek;
  const currentVal = options.includes(tempSelect.value) ? tempSelect.value : '0.7';
  tempSelect.innerHTML = options.map(v =>
    `<option value="${v}"${v === currentVal ? ' selected' : ''}>${v}</option>`
  ).join('');
}

/* ===== Переключение режима ===== */
function setMode(mode) {
  currentMode = mode;
  modeFree.classList.toggle('active', mode === 'free');
  modeConstrained.classList.toggle('active', mode === 'constrained');
  chat.classList.toggle('constrained-active', mode === 'constrained');
}

/* ===== Обновление сайдбара статистики ===== */
function updateTokenStats(lastRequestMeta) {
  let lastMeta = lastRequestMeta;

  if (!lastMeta) {
    const meta = currentAgent ? currentAgent.getAllMeta() : null;
    if (meta) {
      for (let i = meta.length - 1; i >= 0; i--) {
        if (meta[i] && meta[i].prompt !== undefined) {
          lastMeta = meta[i];
          break;
        }
      }
    }
  }

  if (lastMeta) {
    const total = currentAgent ? currentAgent.getTotalTokensUsed() : 0;
    statTotalTokens.textContent = total.toLocaleString('ru-RU');
    statLastPrompt.textContent = lastMeta.prompt;
    statLastCompletion.textContent = lastMeta.completion;
  } else {
    statTotalTokens.textContent = '0';
    statLastPrompt.textContent = '—';
    statLastCompletion.textContent = '—';
  }

  if (currentAgent) {
    const historyCount = currentAgent.getHistory().filter(m => m.role !== 'system').length;
    statHistoryCount.textContent = historyCount.toLocaleString('ru-RU');
  } else {
    statHistoryCount.textContent = '—';
  }

  // Strategy-specific stats
  if (statStrategyInfo && statStrategyDetail && currentAgent) {
    const s = currentStrategy;
    statStrategyInfo.textContent = STRATEGY_NAMES[s] || s;

    switch (s) {
      case 'sliding':
        statStrategyDetail.textContent =
          `Окно: ${currentAgent.getWindowSize()} | Отброшено: ${currentAgent.getDiscardedCount()}`;
        break;
      case 'facts': {
        const factCount = Object.keys(currentAgent.getFacts()).length;
        statStrategyDetail.textContent = `Фактов: ${factCount}`;
        break;
      }
      case 'branching': {
        const branches = currentAgent.getBranches();
        const active = currentAgent.getActiveBranch();
        statStrategyDetail.textContent = `Активная: ${active} | Всего веток: ${branches.length}`;
        break;
      }
      case 'summary': {
        const compressed = currentAgent.getTotalCompressedMessages();
        const summaryCount = currentAgent.getSummaries().length;
        statStrategyDetail.textContent = `Сжато сообщений: ${compressed} | Summary: ${summaryCount} шт.`;
        break;
      }
      default:
        statStrategyDetail.textContent = '—';
    }
  }
}

/* ===== Вспомогательные ===== */
function getModelName(key) {
  return MODEL_NAMES[key] || key;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const langAttr = lang ? ` class="lang-${lang}"` : '';
    return `<pre><code${langAttr}>${code.trim()}</code></pre>`;
  });
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ol>$&</ol>');
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/<\/(pre|ol|ul|h[1-3])><br>/g, '</$1>');
  html = html.replace(/<br><(pre|ol|ul|h[1-3])>/g, '<$1>');
  return html;
}

function buildMessageEl(role, text, constrained, metrics) {
  const div = document.createElement('div');
  div.className = `msg ${role}${constrained ? ' constrained' : ''}`;

  if (role === 'bot') {
    div.innerHTML = renderMarkdown(text);
  } else {
    div.textContent = text;
  }

  if (constrained && role === 'bot') {
    const badge = document.createElement('small');
    badge.className = 'badge';
    badge.textContent = '⚡ с ограничением';
    div.appendChild(badge);
  }

  if (metrics && role === 'bot' && metrics.time !== undefined) {
    const m = document.createElement('div');
    m.className = 'metrics';

    const costStr = (metrics.cost !== undefined && typeof metrics.cost === 'number')
      ? `$${metrics.cost.toFixed(4)}`
      : (metrics.cost || '—');

    m.innerHTML = `⏱️ ${metrics.time}мс · 📊 ${metrics.prompt || 0} / ${metrics.completion || 0} · 💰 ${costStr}`;
    div.appendChild(m);
  }

  return div;
}

function addMessage(role, text, constrained, metrics) {
  messagesEl.appendChild(buildMessageEl(role, text, constrained, metrics));
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showTyping() {
  const div = document.createElement('div');
  div.className = 'typing';
  div.id = 'typing';
  div.innerHTML = '<span></span><span></span><span></span>';
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function hideTyping() {
  const el = document.getElementById('typing');
  if (el) el.remove();
}

/* ===== Отправка сообщения ===== */
async function send() {
  const text = inputEl.value.trim();
  if (!text || sendBtn.disabled || !currentAgent) return;

  const isConstrained = currentMode === 'constrained';
  const temp = parseFloat(tempSelect.value);

  inputEl.value = '';
  inputEl.style.height = 'auto';
  addMessage('user', text, isConstrained);

  sendBtn.disabled = true;
  compareBtn.disabled = true;
  showTyping();

  try {
    const result = await currentAgent.send(text, {
      temperature: temp,
      isConstrained,
    });

    hideTyping();

    addMessage('bot', result.reply, isConstrained, {
      time: result.time,
      prompt: result.usage.prompt,
      completion: result.usage.completion,
      cost: result.cost,
    });

    updateTokenStats({
      prompt: result.usage.prompt,
      completion: result.usage.completion,
    });

    updateStrategyUI();
    saveAllHistories();
  } catch (e) {
    hideTyping();
    const isOverflow = /context length|too long|Payload Too Large|413/i.test(e.message);
    addMessage('error', isOverflow ? '💥 Переполнение контекста! История слишком длинная. Очистите историю (🗑️) или отправьте короткое сообщение.' : `Ошибка: ${e.message}`, isConstrained);
  } finally {
    sendBtn.disabled = false;
    compareBtn.disabled = false;
    inputEl.focus();
  }
}

/* ===== Сравнить все — по стратегиям ===== */
async function compareAll() {
  const text = inputEl.value.trim();
  if (!text || compareBtn.disabled) return;

  const isConstrained = currentMode === 'constrained';
  const temp = parseFloat(tempSelect.value);

  inputEl.value = '';
  inputEl.style.height = 'auto';
  compareBtn.disabled = true;
  sendBtn.disabled = true;

  const strategies = ['sliding', 'facts', 'branching', 'summary'];

  compareGrid.innerHTML = strategies.map(sk =>
    `<div class="compare-card" id="cmp-${sk}">` +
    `<div class="model-name">${STRATEGY_NAMES[sk]}</div>` +
    `<div class="model-body" style="color:#999">⏳ Запрос...</div></div>`
  ).join('');
  compareSection.classList.add('show');
  compareSection.scrollIntoView({ behavior: 'smooth' });

  try {
    const results = await Promise.all(strategies.map(async (sk) => {
      const modelKey = modelSelect.value;
      const agent = createAgent(modelKey, sk);
      const result = await agent.send(text, { temperature: temp, isConstrained, skipStrategy: true });
      return { key: sk, ...result };
    }));

    for (const { key, reply, time, cost, usage } of results) {
      const card = document.getElementById(`cmp-${key}`);
      if (!card) continue;

      const bodyEl = card.querySelector('.model-body');
      bodyEl.textContent = reply;

      const costStr = (typeof cost === 'number') ? `$${cost.toFixed(4)}` : (cost || '—');

      const met = document.createElement('div');
      met.className = 'metrics';
      met.innerHTML = `⏱️ ${time}мс · 📊 ${usage.prompt} / ${usage.completion} · 💰 ${costStr}`;
      card.appendChild(met);
    }
  } catch (e) {
    const isOverflow = /context length|too long|Payload Too Large|413/i.test(e.message);
    const msg = isOverflow ? '💥 Переполнение контекста! История слишком длинная. Очистите историю (🗑️) или отправьте короткое сообщение.' : e.message;
    for (const sk of strategies) {
      const card = document.getElementById(`cmp-${sk}`);
      if (card) {
        card.querySelector('.model-body').className = 'model-body model-error';
        card.querySelector('.model-body').textContent = msg;
      }
    }
  } finally {
    compareBtn.disabled = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

/* ===== Модальное окно сравнения сжатия (legacy) ===== */
function openCompareModal() {
  const modal = document.getElementById('compareModal');
  if (!modal) return;

  const meta = currentAgent ? currentAgent.getAllMeta() : null;
  let lastMeta = null;
  if (meta) {
    for (let i = meta.length - 1; i >= 0; i--) {
      if (meta[i] && meta[i].prompt !== undefined) {
        lastMeta = meta[i];
        break;
      }
    }
  }

  const before = currentAgent ? currentAgent.getLastMetricsBeforeCompression() : null;
  const after = lastMeta;

  if (before) {
    document.getElementById('cmpPromptNo').textContent = before.prompt;
    document.getElementById('cmpCompNo').textContent = before.completion;
    document.getElementById('cmpTimeNo').textContent = before.time + 'мс';
    document.getElementById('cmpCostNo').textContent = typeof before.cost === 'number' ? '$' + before.cost.toFixed(4) : before.cost || '—';
  } else {
    document.getElementById('cmpPromptNo').textContent = '0';
    document.getElementById('cmpCompNo').textContent = '0';
    document.getElementById('cmpTimeNo').textContent = '0мс';
    document.getElementById('cmpCostNo').textContent = '—';
  }

  if (after) {
    document.getElementById('cmpPromptYes').textContent = after.prompt || 0;
    document.getElementById('cmpCompYes').textContent = after.completion || 0;
    document.getElementById('cmpTimeYes').textContent = after.time !== undefined ? after.time + 'мс' : '—';
    const costStr = (after.cost !== undefined && typeof after.cost === 'number')
      ? '$' + after.cost.toFixed(4)
      : (after.cost || '—');
    document.getElementById('cmpCostYes').textContent = costStr;
  } else {
    document.getElementById('cmpPromptYes').textContent = '—';
    document.getElementById('cmpCompYes').textContent = '—';
    document.getElementById('cmpTimeYes').textContent = '—';
    document.getElementById('cmpCostYes').textContent = '—';
  }

  if (before && after) {
    const diffPrompt = after.prompt - before.prompt;
    const diffComp = after.completion - before.completion;
    const diffTime = after.time - before.time;
    const diffCost = (typeof after.cost === 'number' && typeof before.cost === 'number')
      ? (after.cost - before.cost).toFixed(4)
      : '—';

    document.getElementById('cmpPromptDiff').textContent = (diffPrompt > 0 ? '+' : '') + diffPrompt;
    document.getElementById('cmpCompDiff').textContent = (diffComp > 0 ? '+' : '') + diffComp;
    document.getElementById('cmpTimeDiff').textContent = (diffTime > 0 ? '+' : '') + diffTime + 'мс';
    document.getElementById('cmpCostDiff').textContent = typeof diffCost === 'number' ? '$' + diffCost : diffCost;
  } else {
    document.getElementById('cmpPromptDiff').textContent = '—';
    document.getElementById('cmpCompDiff').textContent = '—';
    document.getElementById('cmpTimeDiff').textContent = '—';
    document.getElementById('cmpCostDiff').textContent = '—';
  }

  modal.style.display = 'flex';
}

function closeCompareModal() {
  const modal = document.getElementById('compareModal');
  if (modal) modal.style.display = 'none';
}

/* ===== Event Listeners ===== */
inputEl.addEventListener('input', () => {
  inputEl.style.cssText = `height:auto;height:${Math.min(inputEl.scrollHeight, 140)}px`;
});

inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

modelSelect.addEventListener('change', () => {
  updateTempOptions();
  rebuildAgent();
});

if (strategySelect) {
  strategySelect.addEventListener('change', onStrategyChange);
}

modeFree.addEventListener('click', () => setMode('free'));
modeConstrained.addEventListener('click', () => setMode('constrained'));
compareBtn.addEventListener('click', compareAll);
sendBtn.addEventListener('click', send);
document.getElementById('clearBtn').addEventListener('click', clearAllHistories);

document.getElementById('openCompareModalBtn').addEventListener('click', openCompareModal);
document.getElementById('closeModalBtn').addEventListener('click', closeCompareModal);
document.getElementById('compareModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeCompareModal();
});

if (branchSelect) branchSelect.addEventListener('change', onBranchChange);
if (createBranchBtn) createBranchBtn.addEventListener('click', onCreateBranch);
if (factsToggle) {
  const factsBaseLabel = 'Факты (Sticky Facts)';
  factsToggle.addEventListener('click', () => {
    const isOpen = factsList.classList.toggle('show');
    factsToggle.textContent = isOpen ? `▼ ${factsBaseLabel}` : `▶ ${factsBaseLabel}`;
  });
}
/* ===== Инициализация ===== */
loadCurrentStrategy();
updateTempOptions();
loadAllHistories();

// Init strategy select
if (strategySelect) {
  strategySelect.value = currentStrategy;
}

rebuildAgent();
