/* ===== LLMAgent — инкапсулированный агент с приватной историей и метаданными ===== */
class LLMAgent {
  #history;
  #meta;
  #totalTokensUsed = 0;
  #summaries = [];
  #keepLastN = 6;
  #compressEvery = 10;
  #messageCounter = 0;
  #totalCompressedMessages = 0;

  constructor({ endpoint, model, systemPrompt, modelKey }) {
    this.endpoint = endpoint;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.modelKey = modelKey;
    this.#history = [{ role: 'system', content: systemPrompt }];
    this.#meta = [null];
  }

  getMessagesForRequest() {
    const result = [];
    for (const s of this.#summaries) {
      result.push({ role: 'system', content: `[Краткий пересказ предыдущей части диалога: ${s.text}]` });
    }
    for (let i = 0; i < this.#history.length; i++) {
      result.push(this.#history[i]);
    }
    return result;
  }

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

  async send(userMessage, options = {}) {
    const start = Date.now();
    const temp = options.temperature ?? 0.7;
    const isConstrained = options.isConstrained ?? false;

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

    this.#history.push({ role: 'user', content: userMessage });
    this.#history.push({ role: 'assistant', content: reply });
    this.#meta.push({ isConstrained });
    this.#meta.push({ time, prompt, completion, cost, isConstrained });
    this.#messageCounter += 2;

    if (this.#messageCounter > 0 && this.#messageCounter % this.#compressEvery === 0) {
      try {
        localStorage.setItem('ai-challenge-metrics-' + this.modelKey, JSON.stringify({ prompt, completion, time, cost }));
      } catch (e) { /* ignore */ }
    }

    await this.#compressHistory();

    return {
      reply,
      usage: { prompt, completion },
      time,
      cost,
    };
  }

  clearHistory() {
    this.#history = [{ role: 'system', content: this.systemPrompt }];
    this.#meta = [null];
    this.#totalTokensUsed = 0;
    this.#summaries = [];
    this.#messageCounter = 0;
    this.#totalCompressedMessages = 0;
    try {
      localStorage.removeItem('ai-challenge-metrics-' + this.modelKey);
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

  getLastMetricsBeforeCompression() {
    try {
      const raw = localStorage.getItem('ai-challenge-metrics-' + this.modelKey);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  loadHistory(history, meta, totalTokensUsed, summaries, messageCounter, totalCompressedMessages) {
    this.#history = history;
    this.#meta = meta || history.map(() => null);
    if (totalTokensUsed !== undefined) this.#totalTokensUsed = totalTokensUsed;
    this.#summaries = summaries || [];
    if (messageCounter !== undefined) this.#messageCounter = messageCounter;
    if (totalCompressedMessages !== undefined) this.#totalCompressedMessages = totalCompressedMessages;
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

const SYSTEM_PROMPT = 'Ты полезный ассистент. Отвечай кратко и по делу.';

/* ===== Состояние ===== */
let currentMode = 'free';
let currentAgent = null;

const chatHistories = {
  deepseek: { history: null, meta: null, totalTokensUsed: 0, summaries: [], messageCounter: 0, totalCompressedMessages: 0 },
  qwen: { history: null, meta: null, totalTokensUsed: 0, summaries: [], messageCounter: 0, totalCompressedMessages: 0 },
  giga: { history: null, meta: null, totalTokensUsed: 0, summaries: [], messageCounter: 0, totalCompressedMessages: 0 },
};

/* ===== DOM ===== */
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const compareBtn = document.getElementById('compareBtn');
const modelSelect = document.getElementById('modelSelect');
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
const statCompressedCount = document.getElementById('statCompressedCount');
const statCompressionRatio = document.getElementById('statCompressionRatio');

/* ===== localStorage: сохранение / загрузка / очистка истории ===== */
const STORAGE_KEYS = {
  deepseek: 'ai-challenge-history-deepseek',
  qwen: 'ai-challenge-history-qwen',
  giga: 'ai-challenge-history-giga',
};

function saveAllHistories() {
  try {
    if (currentAgent) {
      const key = modelSelect.value;
      chatHistories[key] = {
        history: currentAgent.getHistory(),
        meta: currentAgent.getAllMeta(),
        totalTokensUsed: currentAgent.getTotalTokensUsed(),
        summaries: currentAgent.getSummaries(),
        messageCounter: currentAgent.getMessageCounter(),
        totalCompressedMessages: currentAgent.getTotalCompressedMessages(),
      };
      localStorage.setItem(STORAGE_KEYS[key], JSON.stringify(chatHistories[key]));
    }
  } catch (e) {
    console.warn('Не удалось сохранить историю:', e.message);
  }
}

function loadAllHistories() {
  for (const k of ['deepseek', 'qwen', 'giga']) {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS[k]);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && data.history && Array.isArray(data.history)) {
          chatHistories[k] = {
            history: data.history,
            meta: data.meta || null,
            totalTokensUsed: data.totalTokensUsed || 0,
            summaries: data.summaries || [],
            messageCounter: data.messageCounter || 0,
            totalCompressedMessages: data.totalCompressedMessages || 0,
          };
        }
      }
    } catch (e) {
      console.warn(`Не удалось загрузить историю для ${k}:`, e.message);
    }
  }
}

function clearAllHistories() {
  for (const k of ['deepseek', 'qwen', 'giga']) {
    localStorage.removeItem(STORAGE_KEYS[k]);
    chatHistories[k] = { history: null, meta: null, totalTokensUsed: 0, summaries: [], messageCounter: 0, totalCompressedMessages: 0 };
  }
  if (currentAgent) {
    currentAgent.clearHistory();
  }
  renderHistory();
  updateTokenStats();
}

/* ===== Создание агента ===== */
function createAgent(modelKey) {
  const endpoint = ENDPOINTS[modelKey];
  const modelApiName = MODEL_API_NAMES[modelKey];
  return new LLMAgent({ endpoint, model: modelApiName, systemPrompt: SYSTEM_PROMPT, modelKey });
}

function rebuildAgent() {
  const previous = modelSelect.dataset.previous;
  const newModel = modelSelect.value;

  if (currentAgent && previous) {
      chatHistories[previous] = {
        history: currentAgent.getHistory(),
        meta: currentAgent.getAllMeta(),
        totalTokensUsed: currentAgent.getTotalTokensUsed(),
        summaries: currentAgent.getSummaries(),
        messageCounter: currentAgent.getMessageCounter(),
        totalCompressedMessages: currentAgent.getTotalCompressedMessages(),
      };
  }

  currentAgent = createAgent(newModel);

  if (chatHistories[newModel]?.history) {
    currentAgent.loadHistory(
      chatHistories[newModel].history,
      chatHistories[newModel].meta,
      chatHistories[newModel].totalTokensUsed,
      chatHistories[newModel].summaries,
      chatHistories[newModel].messageCounter,
      chatHistories[newModel].totalCompressedMessages,
    );
  }

  modelSelect.dataset.previous = newModel;
  compareSection.classList.remove('show');
  renderHistory();
  updateTokenStats();
}

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
    const historyCount = (currentAgent.getHistory().length - 1) + currentAgent.getTotalCompressedMessages();
    statHistoryCount.textContent = historyCount.toLocaleString('ru-RU');
    statCompressedCount.textContent = currentAgent.getTotalCompressedMessages().toLocaleString('ru-RU');
    const quality = currentAgent.estimateCompressionQuality();
    statCompressionRatio.textContent = quality ? quality.compressionRatio + '%' : '—';
  } else {
    statHistoryCount.textContent = '—';
    statCompressedCount.textContent = '—';
    statCompressionRatio.textContent = '—';
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

  // Кодовые блоки
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const langAttr = lang ? ` class="lang-${lang}"` : '';
    return `<pre><code${langAttr}>${code.trim()}</code></pre>`;
  });

  // Инлайн-код
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Заголовки
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Жирный и курсив
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Нумерованные списки
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ol>$&</ol>');

  // Маркированные списки
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Переносы строк
  html = html.replace(/\n/g, '<br>');

  // Очистка от пустых <br> после блоков
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

    m.innerHTML = `⏱️ ${metrics.time}мс &middot; 📊 ${metrics.prompt || 0} / ${metrics.completion || 0} &middot; 💰 ${costStr}`;
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

/* ===== Сравнить все ===== */
async function compareAll() {
  const text = inputEl.value.trim();
  if (!text || compareBtn.disabled) return;

  const isConstrained = currentMode === 'constrained';
  const temp = parseFloat(tempSelect.value);

  inputEl.value = '';
  inputEl.style.height = 'auto';
  compareBtn.disabled = true;
  sendBtn.disabled = true;

  const modelKeys = ['deepseek', 'qwen', 'giga'];

  compareGrid.innerHTML = modelKeys.map(k =>
    `<div class="compare-card" id="cmp-${k}">` +
    `<div class="model-name">${getModelName(k)}</div>` +
    `<div class="model-body" style="color:#999">⏳ Запрос...</div></div>`
  ).join('');
  compareSection.classList.add('show');
  compareSection.scrollIntoView({ behavior: 'smooth' });

  try {
    const results = await Promise.all(modelKeys.map(async (k) => {
      const agent = createAgent(k);
      const result = await agent.send(text, { temperature: temp, isConstrained });
      return { key: k, ...result };
    }));

    for (const { key, reply, time, cost, usage } of results) {
      const card = document.getElementById(`cmp-${key}`);
      if (!card) continue;

      const bodyEl = card.querySelector('.model-body');
      bodyEl.textContent = reply;

      const costStr = (typeof cost === 'number') ? `$${cost.toFixed(4)}` : (cost || '—');

      const met = document.createElement('div');
      met.className = 'metrics';
      met.innerHTML = `⏱️ ${time}мс &middot; 📊 ${usage.prompt} / ${usage.completion} &middot; 💰 ${costStr}`;
      card.appendChild(met);
    }
  } catch (e) {
    const isOverflow = /context length|too long|Payload Too Large|413/i.test(e.message);
    const msg = isOverflow ? '💥 Переполнение контекста! История слишком длинная. Очистите историю (🗑️) или отправьте короткое сообщение.' : e.message;
    for (const k of modelKeys) {
      const card = document.getElementById(`cmp-${k}`);
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

/* ===== Модальное окно сравнения сжатия ===== */
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

  // Столбец "Без сжатия"
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

  // Столбец "Со сжатием"
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

  // Разница
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

/* ===== Инициализация ===== */
updateTempOptions();
loadAllHistories();
rebuildAgent();
