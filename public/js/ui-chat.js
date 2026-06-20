'use strict';

let appReady = false;
let currentMode = 'free';
let currentAgent = null;
let currentStrategy = 'sliding';
let chatRenderLimit = 20;

const chatHistories = {};
for (const mk of ['deepseek', 'qwen', 'giga']) {
  chatHistories[mk] = {};
  for (const sk of STRATEGY_KEYS) {
    chatHistories[mk][sk] = null;
  }
}

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const compareBtn = document.getElementById('compareBtn');
const modeFree = document.getElementById('modeFree');
const modeConstrained = document.getElementById('modeConstrained');
const chat = document.querySelector('.chat');
const compareSection = document.getElementById('compareSection');
const compareGrid = document.getElementById('compareGrid');

const statLastPrompt = document.getElementById('statLastPrompt');
const statTotalTokens = document.getElementById('statTotalTokens');
const statLastCompletion = document.getElementById('statLastCompletion');
const statHistoryCount = document.getElementById('statHistoryCount');
const statStrategyInfo = document.getElementById('statStrategyInfo');
const statStrategyDetail = document.getElementById('statStrategyDetail');
const statCost = document.getElementById('statCost');
const statTime = document.getElementById('statTime');

const branchControls = document.getElementById('branchControls');
const branchSelect = document.getElementById('branchSelect');
const createBranchBtn = document.getElementById('createBranchBtn');
const factsStats = document.getElementById('factsStats');
const factsList = document.getElementById('factsList');

const STORAGE_KEYS = {
  deepseek: 'ai-challenge-history-deepseek',
  qwen: 'ai-challenge-history-qwen',
  giga: 'ai-challenge-history-giga',
};

const STRATEGY_STORAGE_KEY = 'ai-challenge-current-strategy';

function saveCurrentStrategy() {
  try { localStorage.setItem(STRATEGY_STORAGE_KEY, currentStrategy); } catch (e) { }
}

function loadCurrentStrategy() {
  try {
    const saved = localStorage.getItem(STRATEGY_STORAGE_KEY);
    if (saved && STRATEGY_KEYS.includes(saved)) currentStrategy = saved;
  } catch (e) { }
}

function migrateHistoryIfNeeded(data) {
  if (!data) return null;
  if (data.version === 2) {
    return { sliding: data.sliding || null, facts: data.facts || null, branching: data.branching || null, summary: data.summary || null };
  }
  if (data.sliding !== undefined || data.facts !== undefined || data.branching !== undefined || data.summary !== undefined) {
    return { sliding: data.sliding || null, facts: data.facts || null, branching: data.branching || null, summary: data.summary || null };
  }
  if (data.history && Array.isArray(data.history)) {
    return {
      sliding: { history: data.history, meta: data.meta || null, totalTokensUsed: data.totalTokensUsed || 0, messageCounter: data.messageCounter || 0, windowSize: 6, discardedCount: data.totalCompressedMessages || 0 },
      facts: null, branching: null, summary: null,
    };
  }
  return null;
}

function saveAllHistories() {
  try {
    if (currentAgent) {
      const key = document.getElementById('modelSelect').value;
      chatHistories[key][currentStrategy] = currentAgent.getState();
      const payload = { version: 2 };
      for (const sk of STRATEGY_KEYS) payload[sk] = chatHistories[key][sk] || null;
      localStorage.setItem(STORAGE_KEYS[key], JSON.stringify(payload));
    }
  } catch (e) { console.warn('Не удалось сохранить историю:', e.message); }
}

function loadAllHistories() {
  for (const mk of ['deepseek', 'qwen', 'giga']) {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS[mk]);
      if (raw) {
        const data = JSON.parse(raw);
        const migrated = migrateHistoryIfNeeded(data);
        if (migrated) {
          for (const sk of STRATEGY_KEYS) chatHistories[mk][sk] = migrated[sk] || null;
        }
      }
    } catch (e) { console.warn(`Не удалось загрузить историю для ${mk}:`, e.message); }
  }
}

function clearAllHistories() {
  for (const mk of ['deepseek', 'qwen', 'giga']) {
    localStorage.removeItem(STORAGE_KEYS[mk]);
    for (const sk of STRATEGY_KEYS) chatHistories[mk][sk] = null;
  }
  if (currentAgent) currentAgent.clearHistory();
  if (window.memoryManager) window.memoryManager.clearWorkingMemory();
  chatRenderLimit = 20;
  renderHistory();
  updateTokenStats();
  updateStrategyUI();
}

function createAgent(modelKey, strategy) {
  const endpoint = ENDPOINTS[modelKey];
  const modelApiName = MODEL_API_NAMES[modelKey];
  return new LLMAgent({ endpoint, model: modelApiName, systemPrompt: SYSTEM_PROMPT, modelKey, strategy: strategy || currentStrategy });
}

function rebuildAgent() {
  const modelSelect = document.getElementById('modelSelect');
  const strategySelect = document.getElementById('strategySelect');
  if (!modelSelect.dataset.previous) modelSelect.dataset.previous = modelSelect.value;
  const previous = modelSelect.dataset.previous;
  const newModel = modelSelect.value;
  const newStrategy = strategySelect ? strategySelect.value : currentStrategy;

  if (newStrategy !== currentStrategy) { currentStrategy = newStrategy; saveCurrentStrategy(); }
  if (currentAgent && previous) chatHistories[previous][currentAgent.getStrategy()] = currentAgent.getState();

  currentAgent = createAgent(newModel, newStrategy);
  if (window.memoryManager) currentAgent.setMemoryManager(window.memoryManager);

  const saved = chatHistories[newModel]?.[newStrategy];
  if (saved) currentAgent.loadState(saved);

  modelSelect.dataset.previous = newModel;
  window.currentAgent = currentAgent;
  compareSection.classList.remove('show');
  chatRenderLimit = 20;
  renderHistory();
  updateTokenStats();
  updateStrategyUI();
}

function onStrategyChange() {
  const strategySelect = document.getElementById('strategySelect');
  if (!strategySelect) return;
  const newStrategy = strategySelect.value;
  if (newStrategy === currentStrategy) return;
  if (currentAgent) chatHistories[document.getElementById('modelSelect').value][currentStrategy] = currentAgent.getState();
  currentStrategy = newStrategy;
  saveCurrentStrategy();
  const modelKey = document.getElementById('modelSelect').value;
  currentAgent = createAgent(modelKey, currentStrategy);
  if (window.memoryManager) currentAgent.setMemoryManager(window.memoryManager);
  const saved = chatHistories[modelKey]?.[currentStrategy];
  if (saved) currentAgent.loadState(saved);
  chatRenderLimit = 20;
  renderHistory();
  updateTokenStats();
  updateStrategyUI();
}

function updateStrategyUI() {
  if (branchControls) branchControls.style.display = currentStrategy === 'branching' ? 'flex' : 'none';
  if (factsStats) factsStats.style.display = currentStrategy === 'facts' ? 'block' : 'none';
  if (currentStrategy === 'branching' && currentAgent) updateBranchSelect();
  if (currentStrategy === 'facts' && currentAgent) updateFactsList();
  updateTokenStats();
}

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
    chatRenderLimit = 20;
    renderHistory();
    updateTokenStats();
    updateBranchSelect();
    saveAllHistories();
  } catch (e) { console.warn(e.message); }
}

function onCreateBranch() {
  if (!currentAgent) return;
  const name = prompt('Имя новой ветки:');
  if (!name || !name.trim()) return;
  try {
    currentAgent.createBranch(name.trim());
    currentAgent.switchBranch(name.trim());
    updateBranchSelect();
    chatRenderLimit = 20;
    renderHistory();
    updateTokenStats();
    saveAllHistories();
  } catch (e) { alert(e.message); }
}

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

function renderHistory() {
  messagesEl.innerHTML = '';
  const history = currentAgent.getHistory();
  const allMeta = currentAgent.getAllMeta();

  const entries = [];
  for (let i = 0; i < history.length; i++) {
    if (history[i].role === 'system') continue;
    entries.push({ msg: history[i], meta: allMeta[i] });
  }

  const total = entries.length;
  const showCount = Math.min(total, chatRenderLimit);
  const startIndex = total - showCount;

  const fragment = document.createDocumentFragment();

  if (total > chatRenderLimit) {
    const loadMore = document.createElement('button');
    loadMore.className = 'load-more-btn';
    loadMore.textContent = `📜 Загрузить ещё 20 (${total - chatRenderLimit} скрыто)`;
    loadMore.addEventListener('click', () => {
      chatRenderLimit += 20;
      const prevHeight = messagesEl.scrollHeight;
      renderHistory();
      messagesEl.scrollTop = messagesEl.scrollHeight - prevHeight;
    });
    fragment.appendChild(loadMore);
  }

  for (let i = startIndex; i < total; i++) {
    const entry = entries[i];
    const displayRole = entry.msg.role === 'assistant' ? 'bot' : entry.msg.role;
    const isConstrained = entry.meta?.isConstrained ?? false;
    fragment.appendChild(buildMessageEl(displayRole, entry.msg.content, isConstrained, entry.meta));
  }

  messagesEl.appendChild(fragment);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function updateTempOptions() {
  const modelSelect = document.getElementById('modelSelect');
  const tempSelect = document.getElementById('tempSelect');
  const model = modelSelect.value;
  const options = TEMP_OPTIONS[model] || TEMP_OPTIONS.deepseek;
  const currentVal = options.includes(tempSelect.value) ? tempSelect.value : '0.7';
  tempSelect.innerHTML = options.map(v =>
    `<option value="${v}"${v === currentVal ? ' selected' : ''}>${v}</option>`
  ).join('');
}

function setMode(mode) {
  currentMode = mode;
  modeFree.classList.toggle('active', mode === 'free');
  modeConstrained.classList.toggle('active', mode === 'constrained');
  chat.classList.toggle('constrained-active', mode === 'constrained');
}

function updateTokenStats(lastRequestMeta) {
  let lastMeta = lastRequestMeta;
  if (!lastMeta) {
    const meta = currentAgent ? currentAgent.getAllMeta() : null;
    if (meta) {
      for (let i = meta.length - 1; i >= 0; i--) {
        if (meta[i] && meta[i].prompt !== undefined) { lastMeta = meta[i]; break; }
      }
    }
  }

  if (lastMeta) {
    const total = currentAgent ? currentAgent.getTotalTokensUsed() : 0;
    statTotalTokens.textContent = total.toLocaleString('ru-RU');
    statLastPrompt.textContent = (lastMeta.prompt || 0).toLocaleString('ru-RU');
    statLastCompletion.textContent = (lastMeta.completion || 0).toLocaleString('ru-RU');
    if (statCost) {
      const cost = lastMeta.cost;
      statCost.textContent = typeof cost === 'number' ? '$' + cost.toFixed(4) : (cost || '—');
    }
    if (statTime && lastMeta.time !== undefined) statTime.textContent = lastMeta.time + ' ms';
  } else {
    statTotalTokens.textContent = '0';
    statLastPrompt.textContent = '—';
    statLastCompletion.textContent = '—';
    if (statCost) statCost.textContent = '—';
    if (statTime) statTime.textContent = '—';
  }

  if (currentAgent) {
    const historyCount = currentAgent.getHistory().filter(m => m.role !== 'system').length;
    statHistoryCount.textContent = historyCount.toLocaleString('ru-RU');
  } else {
    statHistoryCount.textContent = '—';
  }

  updateShortTermIndicator();

  if (statStrategyInfo && statStrategyDetail && currentAgent) {
    const s = currentStrategy;
    statStrategyInfo.textContent = STRATEGY_NAMES[s] || s;
    switch (s) {
      case 'sliding':
        statStrategyDetail.textContent = `Window: ${currentAgent.getWindowSize()} | Discarded: ${currentAgent.getDiscardedCount()}`;
        break;
      case 'facts': {
        const factCount = Object.keys(currentAgent.getFacts()).length;
        statStrategyDetail.textContent = `Facts: ${factCount}`;
        break;
      }
      case 'branching': {
        const branches = currentAgent.getBranches();
        statStrategyDetail.textContent = `Active: ${currentAgent.getActiveBranch()} | Total: ${branches.length}`;
        break;
      }
      case 'summary': {
        const compressed = currentAgent.getTotalCompressedMessages();
        const summaryCount = currentAgent.getSummaries().length;
        statStrategyDetail.textContent = `Compressed: ${compressed} | Summaries: ${summaryCount}`;
        break;
      }
      default:
        statStrategyDetail.textContent = '—';
    }
  }
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
  const olRegex = /(?:^\d+\. .+\n?)+/gm;
  html = html.replace(olRegex, (match) => {
    const items = match.trim().split('\n').map(line => `<li>${line.replace(/^\d+\.\s*/, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });
  const ulRegex = /(?:^[-*] .+\n?)+/gm;
  html = html.replace(ulRegex, (match) => {
    const items = match.trim().split('\n').map(line => `<li>${line.replace(/^[-*]\s*/, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
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
      ? `$${metrics.cost.toFixed(4)}` : (metrics.cost || '—');
    m.innerHTML = `${metrics.time}ms · ${metrics.prompt || 0} / ${metrics.completion || 0} · ${costStr}`;
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

window.appUI = {
  orchestrator: null,
  onApproveStage: null,
  onRejectStage: null,
  onPauseTask: null,
  onResumeTask: null,
  onLoadTask: null,
  onTaskCancelled: null,
};

let _isSending = false;

async function send() {
  if (!appReady || _isSending) return;

  const text = inputEl.value.trim();
  if (!text || sendBtn.disabled) return;
  inputEl.value = '';
  inputEl.style.height = 'auto';

  const mm = window.memoryManager;
  const iv = mm ? mm.getInterviewState() : null;
  if (iv && iv.active) {
    mm.setInterviewAnswer(text);
    const step = mm.getInterviewState().step;
    const qs = MemoryManager.INTERVIEW_QUESTIONS;
    if (step < qs.length) {
      addMessage('bot', qs[step].question);
    } else {
      mm.finishInterview();
      addMessage('bot', 'Профиль создан! Теперь можно задавать вопросы.');
      renderProfileSelect(mm);
      const profile = mm.getCurrentProfile();
      if (profile) loadProfileUI(profile);
    }
    return;
  }

  const orchestrator = window.appUI.orchestrator;
  const isConstrained = currentMode === 'constrained';

  addMessage('user', text, isConstrained);

  sendBtn.disabled = true;
  compareBtn.disabled = true;
  _isSending = true;
  showTyping();

  try {
    if (orchestrator) {
      const result = await orchestrator.processUserInput(text);
      hideTyping();

        if (result.response) {
          addMessage('bot', result.response, isConstrained);
        }

      updateTaskUI(orchestrator, window.taskStorage);
      if (result.actions.includes('STAGE_CHANGED') || result.actions.includes('TASK_CREATED') || result.actions.includes('TASK_PAUSED') || result.actions.includes('TASK_RESUMED') || result.actions.includes('TASK_COMPLETED') || result.actions.includes('AUTO_PILOT_APPROVED')) {
        showStageTransitionNotification(result.actions, orchestrator);
      }
    } else {
      if (!currentAgent) {
        hideTyping();
        addMessage('error', 'Агент не инициализирован. Выберите модель.');
        return;
      }

      const temp = parseFloat(document.getElementById('tempSelect').value);
      const result = await currentAgent.send(text, { temperature: temp, isConstrained });
      hideTyping();
      addMessage('bot', result.reply, isConstrained, { time: result.time, prompt: result.usage.prompt, completion: result.usage.completion, cost: result.cost });
      updateTokenStats({ prompt: result.usage.prompt, completion: result.usage.completion });
      updateStrategyUI();
      saveAllHistories();
      updateShortTermIndicator();
      if (currentStrategy === 'facts' && currentAgent.lastExtractedFacts && currentAgent.lastExtractedFacts.length > 0) {
        showFactActions(currentAgent.lastExtractedFacts);
        currentAgent.lastExtractedFacts = [];
      }
    }
  } catch (e) {
    hideTyping();
    const isOverflow = /context length|too long|Payload Too Large|413/i.test(e.message);
    addMessage('error', isOverflow ? '💥 Переполнение контекста!' : `Ошибка: ${e.message}`, isConstrained);
  } finally {
    _isSending = false;
    sendBtn.disabled = false;
    compareBtn.disabled = false;
    inputEl.focus();
  }
}

async function compareAll() {
  const text = inputEl.value.trim();
  if (!text || compareBtn.disabled) return;

  const isConstrained = currentMode === 'constrained';
  const temp = parseFloat(document.getElementById('tempSelect').value);

  inputEl.value = '';
  inputEl.style.height = 'auto';
  compareBtn.disabled = true;
  sendBtn.disabled = true;

  compareGrid.innerHTML = STRATEGY_KEYS.map(sk =>
    `<div class="compare-card" id="cmp-${sk}"><div class="model-name">${STRATEGY_NAMES[sk]}</div><div class="model-body" style="color:var(--text-muted)">⏳ Запрос...</div></div>`
  ).join('');
  compareSection.classList.add('show');
  compareSection.scrollIntoView({ behavior: 'smooth' });

  try {
    const results = await Promise.all(STRATEGY_KEYS.map(async (sk) => {
      const modelKey = document.getElementById('modelSelect').value;
      const agent = createAgent(modelKey, sk);
      if (window.memoryManager) agent.setMemoryManager(window.memoryManager);
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
      met.innerHTML = `${time}ms · ${usage.prompt} / ${usage.completion} · ${costStr}`;
      card.appendChild(met);
    }
  } catch (e) {
    const isOverflow = /context length|too long|Payload Too Large|413/i.test(e.message);
    const msg = isOverflow ? '💥 Переполнение контекста!' : e.message;
    for (const sk of STRATEGY_KEYS) {
      const card = document.getElementById(`cmp-${sk}`);
      if (card) { card.querySelector('.model-body').className = 'model-body model-error'; card.querySelector('.model-body').textContent = msg; }
    }
  } finally {
    compareBtn.disabled = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

function openCompareModal() {
  const modal = document.getElementById('compareModal');
  if (!modal) return;

  const meta = currentAgent ? currentAgent.getAllMeta() : null;
  let lastMeta = null;
  if (meta) {
    for (let i = meta.length - 1; i >= 0; i--) {
      if (meta[i] && meta[i].prompt !== undefined) { lastMeta = meta[i]; break; }
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
    const costStr = (after.cost !== undefined && typeof after.cost === 'number') ? '$' + after.cost.toFixed(4) : (after.cost || '—');
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
    const diffCost = (typeof after.cost === 'number' && typeof before.cost === 'number') ? (after.cost - before.cost).toFixed(4) : '—';
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

function showPromptPanel() {
  const panel = document.getElementById('promptPanel');
  const content = document.getElementById('promptPanelContent');
  if (!panel || !content || !currentAgent) return;

  if (panel.classList.contains('show')) { panel.classList.remove('show'); return; }

  const messages = currentAgent.getMessagesForRequest();
  let html = '';
  for (const msg of messages) {
    let cls = 'prompt-line';
    let prefix = '';
    if (msg.role === 'system') {
      if (msg.content.includes('ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ') || msg.content.includes('ИНВАРИАНТЫ') || msg.content.includes('РАБОЧАЯ ПАМЯТЬ') || msg.content.includes('[Факт]') || msg.content.includes('[Краткий пересказ')) {
        cls += ' prompt-line--memory-layer';
        prefix = 'System (combined): ';
      } else {
        cls += ' prompt-line--system';
        prefix = 'System: ';
      }
    } else if (msg.role === 'user') {
      cls += ' prompt-line--user';
      prefix = 'User: ';
    } else {
      cls += ' prompt-line--assistant';
      prefix = 'Assistant: ';
    }
    html += `<div class="${cls}">${escapeHtml(prefix + msg.content.slice(0, 300))}${msg.content.length > 300 ? '...' : ''}</div>`;
  }
  content.innerHTML = html;
  panel.classList.add('show');
}

function showFactActions(facts) {
  if (!facts || facts.length === 0 || !currentAgent) return;
  const lastMsg = messagesEl.lastElementChild;
  if (!lastMsg) return;
  const existing = document.querySelector('.fact-actions');
  if (existing) existing.remove();

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'fact-actions';

  for (const fact of facts) {
    const keyLabel = fact.key.length > 20 ? fact.key.slice(0, 20) + '...' : fact.key;

    const toLtBtn = document.createElement('button');
    toLtBtn.className = 'memory-btn--fact';
    toLtBtn.textContent = '💾 В инварианты: ' + keyLabel;
    toLtBtn.title = 'Сохранить "' + fact.key + '" в долговременную память';
    toLtBtn.addEventListener('click', function () { saveFactToLongTerm(fact); this.remove(); });
    actionsDiv.appendChild(toLtBtn);

    const toWmBtn = document.createElement('button');
    toWmBtn.className = 'memory-btn--fact';
    toWmBtn.textContent = '📌 В задачу: ' + keyLabel;
    toWmBtn.title = 'Сохранить "' + fact.key + '" в рабочую память';
    toWmBtn.addEventListener('click', function () { saveFactToWorking(fact); this.remove(); });
    actionsDiv.appendChild(toWmBtn);
  }

  lastMsg.after(actionsDiv);
}

function saveFactToLongTerm(fact) {
  const mm = window.memoryManager;
  if (!mm) return;
  const draft = mm.getLongTermDraft();
  const lowKey = fact.key.toLowerCase();
  const lowVal = fact.value.toLowerCase();
  const isProhibition = /запрет|нельзя|не используй|не надо|не нужно|no |don'?t/i.test(lowKey) || /запрет|нельзя|не используй|not allowed|prohibit/i.test(lowVal);
  if (isProhibition) {
    draft.prohibitions = (draft.prohibitions ? draft.prohibitions + '\n' : '') + fact.key + ': ' + fact.value;
  } else {
    draft.rules = (draft.rules ? draft.rules + '\n' : '') + fact.key + ': ' + fact.value;
  }
  mm.saveLongTermDraft(draft);
  loadLongTermMemoryUI(mm);
}

function saveFactToWorking(fact) {
  const mm = window.memoryManager;
  if (!mm) return;
  const wm = mm.getWorkingMemory();
  wm.notes = (wm.notes ? wm.notes + '\n' : '') + fact.key + ': ' + fact.value;
  mm.saveWorkingMemory(wm);
  loadWorkingMemoryUI(mm);
}

function checkStartInterview() {
  const mm = window.memoryManager;
  if (!mm) return;
  const iv = mm.getInterviewState();
  if (mm.getProfiles().length === 0 && !iv.active) {
    mm.startInterview();
    const qs = MemoryManager.INTERVIEW_QUESTIONS;
    if (qs.length > 0) {
      addMessage('bot', qs[0].question);
    }
  }
}

/* ===== Event Listeners ===== */
inputEl.addEventListener('input', () => {
  inputEl.style.cssText = `height:auto;height:${Math.min(inputEl.scrollHeight, 140)}px`;
});

inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

document.getElementById('modelSelect').addEventListener('change', function () {
  updateTempOptions();
  rebuildAgent();
  if (window.memoryManager) {
    window.memoryManager.modelKey = this.value;
  }
  if (window.orchestrator) {
    window.orchestrator.updateModel(this.value);
  }
});

document.getElementById('strategySelect').addEventListener('change', onStrategyChange);

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

document.getElementById('showPromptBtn').addEventListener('click', showPromptPanel);
document.getElementById('closePromptBtn').addEventListener('click', function () {
  document.getElementById('promptPanel').classList.remove('show');
});

function showStageTransitionNotification(actions, orchestrator) {
  const state = orchestrator.taskFSM.state;
  const stageLabels = {
    idle: 'Ожидание',
    planning: 'Планирование',
    execution: 'Выполнение',
    validation: 'Валидация',
    done: 'Завершено',
    paused: 'Пауза',
  };

  let msg = '';
  if (actions.includes('TASK_CREATED')) {
    msg = `📋 Создана новая задача. Этап: Планирование.`;
  } else if (actions.includes('TASK_PAUSED')) {
    msg = `⏸ Задача поставлена на паузу.`;
  } else if (actions.includes('TASK_RESUMED')) {
    msg = `▶ Задача возобновлена. Этап: ${stageLabels[state] || state}.`;
  } else if (actions.includes('TASK_COMPLETED')) {
    msg = `🏁 Задача завершена!`;
  } else if (actions.includes('STAGE_CHANGED')) {
    const autoLabel = actions.includes('AUTO_PILOT_APPROVED') ? ' (Auto-Pilot)' : '';
    msg = `➡ Переход на этап: ${stageLabels[state] || state}${autoLabel}.`;
  }

  if (msg) {
    const notif = document.createElement('div');
    notif.className = 'stage-transition-notification';
    notif.textContent = msg;
    messagesEl.appendChild(notif);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    setTimeout(() => {
      notif.classList.add('fade-out');
      setTimeout(() => notif.remove(), 500);
    }, 4000);
  }
}

const stViewBtn = document.getElementById('stViewBtn');
if (stViewBtn) {
  stViewBtn.addEventListener('click', function () {
    const list = document.getElementById('stMessagesList');
    if (!list) return;
    const isOpen = list.classList.toggle('show');
    this.textContent = isOpen ? 'Скрыть' : 'Просмотреть';
    if (isOpen) renderShortTermMessages();
  });
}
