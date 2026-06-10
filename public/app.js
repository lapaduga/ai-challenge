/* ===== LLMAgent — инкапсулированный агент с приватной историей и метаданными ===== */
class LLMAgent {
  #history;
  #meta;

  constructor({ endpoint, model, systemPrompt, modelKey }) {
    this.endpoint = endpoint;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.modelKey = modelKey;
    this.#history = [{ role: 'system', content: systemPrompt }];
    this.#meta = [null];
  }

  async send(userMessage, options = {}) {
    const start = Date.now();
    const temp = options.temperature ?? 0.7;
    const isConstrained = options.isConstrained ?? false;

    let messages;
    if (isConstrained) {
      const constraint = '\n\nОтветь в виде маркированного списка (каждый пункт с новой строки, начинается с "- "). Максимум 5 пунктов. Заверши ответ ровно символом END.';
      messages = [
        ...this.#history,
        { role: 'user', content: userMessage + constraint },
      ];
    } else {
      messages = [...this.#history, { role: 'user', content: userMessage }];
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
    const data = await res.json();

    if (data.error) throw new Error(data.error.message);

    const reply = data.choices[0].message.content;
    const usage = data.usage || {};
    const prompt = usage.prompt_tokens || 0;
    const completion = usage.completion_tokens || 0;
    const cost = COST[this.modelKey](prompt, completion);

    this.#history.push({ role: 'user', content: userMessage });
    this.#history.push({ role: 'assistant', content: reply });
    this.#meta.push({ isConstrained });
    this.#meta.push({ time, prompt, completion, cost, isConstrained });

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
  }

  setSystemPrompt(newPrompt) {
    this.systemPrompt = newPrompt;
    this.clearHistory();
  }

  getHistory() {
    return this.#history.map(m => ({ ...m }));
  }

  getAllMeta() {
    return this.#meta.map(m => m ? { ...m } : null);
  }

  loadHistory(history, meta) {
    this.#history = history.map(m => ({ ...m }));
    this.#meta = meta ? meta.map(m => m ? { ...m } : null) : history.map(() => null);
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
  deepseek: (p, c) => '$' + (p * 0.0000001 + c * 0.0000005).toFixed(4),
  qwen: (p, c) => '$' + (p * 0.0000005 + c * 0.000001).toFixed(4),
  giga: () => 'Бесплатно',
};

const SYSTEM_PROMPT = 'Ты полезный ассистент. Отвечай кратко и по делу.';

/* ===== Состояние ===== */
let currentMode = 'free';
let currentAgent = null;

// Теперь всё сохраняется в сессионной переменной chatHistories
// При перезагрузке страницы история всех чатов обнуляется (т.к. грохается переменная)
// Но пока страница не обновлена, можно переключать, объект жив
const chatHistories = {
  deepseek: { history: null, meta: null },
  qwen: { history: null, meta: null },
  giga: { history: null, meta: null },
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

/* ===== localStorage: сохранение / загрузка / очистка ===== */
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
      };
    }
    for (const k of ['deepseek', 'qwen', 'giga']) {
      const data = chatHistories[k];
      if (data.history) {
        localStorage.setItem(STORAGE_KEYS[k], JSON.stringify(data));
      } else {
        localStorage.removeItem(STORAGE_KEYS[k]);
      }
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
          chatHistories[k] = { history: data.history, meta: data.meta || null };
        }
      }
    } catch (e) {
      console.warn('Не удалось загрузить историю для ' + k + ':', e.message);
    }
  }
}

function clearAllHistories() {
  for (const k of ['deepseek', 'qwen', 'giga']) {
    localStorage.removeItem(STORAGE_KEYS[k]);
    chatHistories[k] = { history: null, meta: null };
  }
  if (currentAgent) {
    currentAgent.clearHistory();
  }
  renderHistory();
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
    };
  }

  currentAgent = createAgent(newModel);

  if (chatHistories[newModel]?.history) {
    currentAgent.loadHistory(chatHistories[newModel].history, chatHistories[newModel].meta);
  }

  modelSelect.dataset.previous = newModel;
  compareSection.classList.remove('show');
  renderHistory();
}

function renderHistory() {
  messagesEl.innerHTML = '';
  const history = currentAgent.getHistory();
  const allMeta = currentAgent.getAllMeta();

  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    if (msg.role === 'system') continue;

    const msgMeta = allMeta[i];
    const displayRole = msg.role === 'assistant' ? 'bot' : msg.role;
    const isConstrained = msgMeta?.isConstrained ?? false;

    addMessage(displayRole, msg.content, isConstrained, msgMeta);
  }
}

/* ===== Температура: динамические опции ===== */
function updateTempOptions() {
  const model = modelSelect.value;
  const options = TEMP_OPTIONS[model] || TEMP_OPTIONS.deepseek;
  const currentVal = options.includes(tempSelect.value) ? tempSelect.value : '0.7';
  tempSelect.innerHTML = options.map(v =>
    '<option value="' + v + '"' + (v === currentVal ? ' selected' : '') + '>' + v + '</option>'
  ).join('');
}

/* ===== Переключение режима ===== */
function setMode(mode) {
  currentMode = mode;
  modeFree.classList.toggle('active', mode === 'free');
  modeConstrained.classList.toggle('active', mode === 'constrained');
  chat.classList.toggle('constrained-active', mode === 'constrained');
}

/* ===== Вспомогательные ===== */
function getModelName(key) {
  return { deepseek: 'DeepSeek', qwen: 'Qwen', giga: 'GigaChat' }[key] || key;
}

function addMessage(role, text, constrained, metrics) {
  const div = document.createElement('div');
  div.className = 'msg ' + role + (constrained ? ' constrained' : '');
  div.textContent = text;

  if (constrained && role === 'bot') {
    const badge = document.createElement('small');
    badge.className = 'badge';
    badge.textContent = '⚡ с ограничением';
    div.appendChild(badge);
  }

  if (metrics && role === 'bot' && metrics.time !== undefined) {
    const m = document.createElement('div');
    m.className = 'metrics';
    m.innerHTML = '⏱️ ' + metrics.time + 'мс' +
      ' &middot; 📊 ' + (metrics.prompt || 0) + ' / ' + (metrics.completion || 0) +
      ' &middot; 💰 ' + (metrics.cost || '-');
    div.appendChild(m);
  }

  messagesEl.appendChild(div);
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

    saveAllHistories();
  } catch (e) {
    hideTyping();
    addMessage('error', 'Ошибка: ' + e.message, isConstrained);
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
    '<div class="compare-card" id="cmp-' + k + '">' +
    '<div class="model-name">' + getModelName(k) + '</div>' +
    '<div class="model-body" style="color:#999">⏳ Запрос...</div></div>'
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
      const card = document.getElementById('cmp-' + key);
      if (!card) continue;

      const bodyEl = card.querySelector('.model-body');
      bodyEl.textContent = reply;

      const met = document.createElement('div');
      met.className = 'metrics';
      met.innerHTML = '⏱️ ' + time + 'мс &middot; 📊 ' + usage.prompt + ' / ' + usage.completion + ' &middot; 💰 ' + cost;
      card.appendChild(met);
    }
  } catch (e) {
    for (const k of modelKeys) {
      const card = document.getElementById('cmp-' + k);
      if (card) {
        card.querySelector('.model-body').className = 'model-body model-error';
        card.querySelector('.model-body').textContent = e.message;
      }
    }
  } finally {
    compareBtn.disabled = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

/* ===== Event Listeners ===== */
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
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

/* ===== Инициализация ===== */
updateTempOptions();
loadAllHistories();
rebuildAgent();
