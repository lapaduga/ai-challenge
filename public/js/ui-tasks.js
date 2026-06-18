'use strict';

function renderStageIndicator(orchestrator) {
  const dot = document.getElementById('stageDot');
  const label = document.getElementById('stageLabel');
  if (!dot || !label) return;

  const state = orchestrator.taskFSM.state;
  const stage = orchestrator.taskFSM.getCurrentStage();

  dot.className = 'stage-dot';
  dot.classList.add('stage-dot--' + state);

  const stateLabels = {
    idle: 'Ожидание',
    planning: 'Планирование',
    execution: 'Выполнение',
    validation: 'Валидация',
    done: 'Завершено',
    paused: 'Пауза',
  };

  label.textContent = stateLabels[state] || state;
}

function renderStageActions(orchestrator) {
  const container = document.getElementById('stageActions');
  if (!container) return;

  const cmds = orchestrator.getAvailableCommands();
  container.innerHTML = '';

  if (cmds.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';

  for (const cmd of cmds) {
    const btn = document.createElement('button');
    btn.className = 'stage-action-btn';

    if (cmd.action === 'approve') btn.classList.add('stage-action-btn--approve');
    else if (cmd.action === 'reject') btn.classList.add('stage-action-btn--reject');
    else if (cmd.action === 'pause') btn.classList.add('stage-action-btn--pause');
    else if (cmd.action === 'resume') btn.classList.add('stage-action-btn--resume');

    btn.textContent = cmd.label;
    btn.title = cmd.title;

    btn.addEventListener('click', async () => {
      await handleStageAction(cmd.action, orchestrator);
    });

    container.appendChild(btn);
  }
}

async function handleStageAction(action, orchestrator) {
  if (!orchestrator || !window.appUI) return;

  if (action === 'approve') {
    if (window.appUI.onApproveStage) {
      await window.appUI.onApproveStage();
    }
  } else if (action === 'reject') {
    if (window.appUI.onRejectStage) {
      const feedback = prompt('Укажите, что нужно исправить:');
      if (feedback && feedback.trim()) {
        await window.appUI.onRejectStage(feedback.trim());
      }
    }
  } else if (action === 'pause') {
    if (window.appUI.onPauseTask) {
      await window.appUI.onPauseTask();
    }
  } else if (action === 'resume') {
    if (window.appUI.onResumeTask) {
      await window.appUI.onResumeTask();
    }
  }
}

function renderPipeline(orchestrator) {
  const pipeline = document.getElementById('stagePipeline');
  if (!pipeline) return;

  const steps = pipeline.querySelectorAll('.pipeline-step');
  const state = orchestrator.taskFSM.state;
  const currentStage = orchestrator.taskFSM.getCurrentStage();

  for (const step of steps) {
    const stage = step.dataset.stage;
    step.classList.remove('active', 'completed');

    const stageData = orchestrator.taskFSM.stageData[stage];

    if (stage === currentStage && state !== 'idle' && state !== 'paused') {
      step.classList.add('active');
    } else if (stageData && stageData.approved) {
      step.classList.add('completed');
    }
  }
}

function renderTaskStatus(orchestrator) {
  const badge = document.querySelector('.task-state-badge');
  const idLabel = document.getElementById('taskIdLabel');
  if (!badge || !idLabel) return;

  const state = orchestrator.taskFSM.state;
  badge.className = 'task-state-badge';
  badge.classList.add('task-state--' + state);

  const stateLabels = {
    idle: 'Idle',
    planning: 'План',
    execution: 'Выполнение',
    validation: 'Валидация',
    done: 'Готово',
    paused: 'Пауза',
  };

  badge.textContent = stateLabels[state] || state;

  if (orchestrator.taskFSM.currentTaskId) {
    idLabel.textContent = orchestrator.taskFSM.currentTaskId;
  } else {
    idLabel.textContent = '—';
  }
}

function renderStageResults(orchestrator) {
  const container = document.getElementById('stageResults');
  if (!container) return;

  const stages = ['planning', 'execution', 'validation', 'done'];
  let html = '';

  for (const stage of stages) {
    const data = orchestrator.taskFSM.stageData[stage];
    if (!data || !data.result) continue;

    const statusClass = data.approved ? 'approved' : 'pending';
    const statusIcon = data.approved ? '✓' : '⏳';
    const preview = data.result.length > 80 ? data.result.slice(0, 80) + '...' : data.result;

    html += `<div class="stage-result-item ${statusClass}">
      <span class="stage-name">${statusIcon} ${stage}</span>
      <span class="stage-preview">${escapeHtml(preview)}</span>
    </div>`;
  }

  if (!html) {
    container.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:4px 0;">Нет результатов</div>';
  } else {
    container.innerHTML = html;
  }
}

async function renderTaskHistory(taskStorage) {
  const container = document.getElementById('taskHistoryList');
  if (!container) return;

  try {
    const tasks = await taskStorage.getArchivedTasks();
    if (!tasks || tasks.length === 0) {
      container.innerHTML = '<div class="task-history-empty">Нет завершённых задач</div>';
      return;
    }

    container.innerHTML = tasks.slice(-10).reverse().map(t => {
      const date = t.archivedAt ? new Date(t.archivedAt).toLocaleDateString('ru-RU') : '—';
      return `<div class="task-history-item" data-task-id="${escapeHtml(t.taskId)}">
        <span class="task-history-id">${escapeHtml(t.taskId)}</span>
        <span class="task-history-date">${date}</span>
      </div>`;
    }).join('');

    container.querySelectorAll('.task-history-item').forEach(el => {
      el.addEventListener('click', async () => {
        const taskId = el.dataset.taskId;
        if (window.appUI && window.appUI.onLoadTask) {
          await window.appUI.onLoadTask(taskId);
        }
      });
    });
  } catch (e) {
    container.innerHTML = '<div class="task-history-empty">Ошибка загрузки</div>';
  }
}

function renderAutoPilotState(orchestrator) {
  const checkbox = document.getElementById('autoPilotCheckbox');
  const toggle = document.getElementById('autoPilotToggle');
  if (!checkbox || !toggle) return;

  checkbox.checked = orchestrator.autoPilot;
  toggle.classList.toggle('active', orchestrator.autoPilot);

  if (orchestrator.taskFSM.isActive()) {
    checkbox.disabled = true;
    toggle.title = 'Нельзя изменить во время активной задачи';
  } else {
    checkbox.disabled = false;
    toggle.title = 'Auto-Pilot: супервайзер автоматически утверждает этапы';
  }
}

function renderSupervisorVerdict(orchestrator) {
  const container = document.getElementById('supervisorVerdict');
  if (!container) return;

  const status = orchestrator.getSupervisorStatus();
  if (!status.lastVerdict) {
    container.style.display = 'none';
    return;
  }

  const v = status.lastVerdict;
  container.style.display = 'block';

  const verdictColors = {
    PASS: 'var(--success)',
    ISSUE: 'var(--danger)',
    CORRECT: 'var(--warning)',
  };

  const verdictIcons = {
    PASS: '✅',
    ISSUE: '⚠️',
    CORRECT: '🔧',
  };

  const preview = v.fullResponse.length > 120
    ? v.fullResponse.slice(0, 120) + '...'
    : v.fullResponse;

  container.innerHTML = `<div class="supervisor-verdict" style="border-left-color: ${verdictColors[v.verdict] || 'var(--text-muted)'}">
    <span class="supervisor-verdict-badge" style="color: ${verdictColors[v.verdict] || 'var(--text-muted)'}">
      ${verdictIcons[v.verdict] || '🔍'} ${v.verdict}
    </span>
    <span class="supervisor-verdict-text">${escapeHtml(preview)}</span>
  </div>`;
}

function updateTaskUI(orchestrator, taskStorage) {
  renderStageIndicator(orchestrator);
  renderStageActions(orchestrator);
  renderPipeline(orchestrator);
  renderTaskStatus(orchestrator);
  renderStageResults(orchestrator);
  renderTaskHistory(taskStorage);
  renderAutoPilotState(orchestrator);
  renderSupervisorVerdict(orchestrator);
}

function setupTaskUIListeners(orchestrator, taskStorage) {
  const cancelBtn = document.getElementById('cancelTaskBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      if (orchestrator.taskFSM.isIdle()) return;
      if (!confirm('Отменить текущую задачу?')) return;
      await orchestrator.cancelTask();
      updateTaskUI(orchestrator, taskStorage);
      if (window.appUI && window.appUI.onTaskCancelled) {
        window.appUI.onTaskCancelled();
      }
    });
  }
}