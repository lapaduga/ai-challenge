'use strict';

const DEFAULT_WINDOW_SIZE = 6;
const DEFAULT_COMPRESS_EVERY = 10;
const DEFAULT_KEEP_LAST_N = 6;

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

  // Memory Manager (optional composition)
  #memoryManager = null;

  #abortController = null;

  lastExtractedFacts = [];

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

    this.#windowSize = DEFAULT_WINDOW_SIZE;
    this.#discardedCount = 0;

    this.#facts = {};
    this.#factsWindowSize = 4;

    this.#branches = {};
    this.#activeBranch = 'main';
    this.#branches['main'] = { history: [{ role: 'system', content: systemPrompt }], meta: [null] };
    this.#syncHistoryFromBranch();

    this.#summaries = [];
    this.#totalCompressedMessages = 0;
    this.#keepLastN = DEFAULT_KEEP_LAST_N;
    this.#compressEvery = DEFAULT_COMPRESS_EVERY;
  }

  setMemoryManager(mm) {
    this.#memoryManager = mm;
  }

  getStrategy() {
    return this.#strategy;
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

      const newFacts = [];
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
              newFacts.push({ key, value });
              updated = true;
            }
          }
        }
      }
      this.lastExtractedFacts = newFacts;
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
    let base;

    switch (this.#strategy) {
      case 'sliding':
        base = [...this.#history];
        break;

      case 'facts': {
        const messages = [this.#history[0]];
        for (const [key, value] of Object.entries(this.#facts)) {
          messages.push({ role: 'system', content: `[Факт] ${key}: ${value}` });
        }
        const nonSystem = this.#history.filter(m => m.role !== 'system').slice(-this.#factsWindowSize);
        messages.push(...nonSystem);
        base = messages;
        break;
      }

      case 'branching': {
        base = [...this.#history];
        break;
      }

      case 'summary': {
        const result = [this.#history[0]];
        for (const s of this.#summaries) {
          result.push({ role: 'system', content: `[Краткий пересказ предыдущей части диалога: ${s.text}]` });
        }
        for (let i = 1; i < this.#history.length; i++) {
          result.push(this.#history[i]);
        }
        base = result;
        break;
      }

      default:
        base = [...this.#history];
    }

    if (this.#memoryManager) {
      return this.#memoryManager.wrapMessages(base);
    }
    return base;
  }

  /* ===== Отправка сообщения ===== */

  async send(userMessage, options = {}) {
    const start = Date.now();
    const temp = options.temperature ?? 0.7;
    const isConstrained = options.isConstrained ?? false;
    const skipStrategy = options.skipStrategy ?? false;

    let messages;
    if (isConstrained) {
      messages = [
        ...this.getMessagesForRequest(),
        { role: 'user', content: `${userMessage}\n\nОтветь в виде маркированного списка (каждый пункт с новой строки, начинается с "- "). Максимум 5 пунктов. Заверши ответ ровно символом END.` },
      ];
    } else {
      messages = [...this.getMessagesForRequest(), { role: 'user', content: userMessage }];
    }

    const maxTokens = options.maxTokens;

    const body = {
      model: this.model,
      messages,
      temperature: temp,
    };

    if (maxTokens !== undefined) {
      body.max_tokens = maxTokens;
    } else if (isConstrained) {
      body.max_tokens = 500;
    }
    if (isConstrained) {
      body.stop = options.stop ?? ['END'];
    }

    if (this.#abortController) {
      this.#abortController.abort();
    }
    this.#abortController = new AbortController();

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this.#abortController.signal,
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

      this.#abortController = null;

      return {
        reply,
        usage: { prompt, completion },
        time,
        cost,
      };
    } catch (e) {
      if (e.name === 'AbortError' || e.message === 'The operation was aborted.' || e.message === 'The user aborted a request.') {
        this.#abortController = null;
        return { reply: '', aborted: true, usage: { prompt: 0, completion: 0 }, time: 0, cost: 0 };
      }
      throw e;
    }
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

  getTotalCompressedMessages() {
    return this.#totalCompressedMessages;
  }

  loadState(data) {
    if (!data) return;
    if (data.history) this.#history = data.history;
    if (data.meta) this.#meta = data.meta;
    if (data.systemPrompt !== undefined) this.systemPrompt = data.systemPrompt;
    if (data.totalTokensUsed !== undefined) this.#totalTokensUsed = data.totalTokensUsed;
    if (data.messageCounter !== undefined) this.#messageCounter = data.messageCounter;
    if (data.windowSize !== undefined) this.#windowSize = data.windowSize;
    if (data.discardedCount !== undefined) this.#discardedCount = data.discardedCount;
    if (data.facts) this.#facts = data.facts;
    if (data.factsWindowSize !== undefined) this.#factsWindowSize = data.factsWindowSize;
    if (data.branches) {
      this.#branches = data.branches;
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
      systemPrompt: this.systemPrompt,
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

const STRATEGY_KEYS = ['sliding', 'facts', 'branching', 'summary'];
