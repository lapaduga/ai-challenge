'use strict';

const ACTION = {
  NONE: 'NONE',
  STAGE_CHANGED: 'STAGE_CHANGED',
  TASK_CREATED: 'TASK_CREATED',
  TASK_PAUSED: 'TASK_PAUSED',
  TASK_RESUMED: 'TASK_RESUMED',
  TASK_COMPLETED: 'TASK_COMPLETED',
  FEEDBACK_SENT: 'FEEDBACK_SENT',
  AUTO_PILOT_APPROVED: 'AUTO_PILOT_APPROVED',
  STAGE_COMPLETE_SUGGESTED: 'STAGE_COMPLETE_SUGGESTED',
  INVARIANT_VIOLATION: 'INVARIANT_VIOLATION',
};

const COMMAND_PATTERNS = {
  approve: [/^утвердит[ьe]?|^подтвердит[ьe]?|^ok$|^да$|^yes$|^хорошо$|^принято$|^согласен/i],
  reject: [/^отклонит[ьe]?|^переделат[ьe]?|^неправильно|^нет$|^не\s*верно|^исправ/i],
  pause: [/^пауза|^стоп|^pause$|^stop$/i],
  resume: [/^продолжит[ьe]?|^resume$|^продолжаем$/i],
};

class OrchestratorAgent {
  constructor(settings, memoryManager, taskStorage) {
    this.taskFSM = new TaskStateMachine();
    this.memoryManager = memoryManager;
    this.taskStorage = taskStorage;
    this.settings = settings;

    this.agents = {
      planning: null,
      execution: null,
      validation: null,
      done: null,
    };
    this.supervisor = null;

    this.autoPilot = false;
    this.lastSupervisorVerdict = null;
    this.invariantChecker = new InvariantChecker(memoryManager);
  }

  createAgents() {
    const modelKey = this.settings.modelKey;
    const endpoint = ENDPOINTS[modelKey];
    const modelApiName = MODEL_API_NAMES[modelKey];
    const strategy = 'sliding';

    this.agents.planning = new PlanningAgent(
      new LLMAgent({ endpoint, model: modelApiName, systemPrompt: '', modelKey, strategy })
    );
    this.agents.execution = new ExecutionAgent(
      new LLMAgent({ endpoint, model: modelApiName, systemPrompt: '', modelKey, strategy })
    );
    this.agents.validation = new ValidationAgent(
      new LLMAgent({ endpoint, model: modelApiName, systemPrompt: '', modelKey, strategy })
    );
    this.agents.done = new DoneAgent(
      new LLMAgent({ endpoint, model: modelApiName, systemPrompt: '', modelKey, strategy })
    );

    this.supervisor = new SupervisorAgent(
      new LLMAgent({ endpoint, model: modelApiName, systemPrompt: '', modelKey, strategy })
    );

    for (const key of Object.keys(this.agents)) {
      if (this.memoryManager) {
        this.agents[key].setMemoryManager(this.memoryManager);
      }
    }
    if (this.memoryManager) {
      this.supervisor.agent.setMemoryManager(this.memoryManager);
    }
  }

  updateModel(modelKey) {
    const savedStates = {};
    for (const [name, agent] of Object.entries(this.agents)) {
      if (agent) savedStates[name] = agent.getState();
    }
    const savedSupervisorState = this.supervisor ? this.supervisor.agent.getState() : null;
    const savedVerdict = this.lastSupervisorVerdict;

    this.settings.modelKey = modelKey;
    this.createAgents();

    for (const [name, state] of Object.entries(savedStates)) {
      if (this.agents[name] && state) {
        this.agents[name].loadState(state);
      }
    }
    if (this.supervisor && savedSupervisorState) {
      this.supervisor.agent.loadState(savedSupervisorState);
    }
    this.lastSupervisorVerdict = savedVerdict || null;
  }

  setMemoryManager(mm) {
    this.memoryManager = mm;
    for (const key of Object.keys(this.agents)) {
      if (this.agents[key]) {
        this.agents[key].setMemoryManager(mm);
      }
    }
    if (this.supervisor) {
      this.supervisor.agent.setMemoryManager(mm);
    }
  }

  setAutoPilot(enabled) {
    this.autoPilot = enabled;
  }

  isAutoPilot() {
    return this.autoPilot;
  }

  async _runSupervisorCheck(stage, stageResult) {
    if (!this.supervisor) return null;

    const plan = this.taskFSM.getStageResult(STAGES.PLANNING);
    const validationResult = this.taskFSM.getStageResult(STAGES.VALIDATION);

    const lt = this.memoryManager ? this.memoryManager.getLongTermDraft() : null;
    const invariants = [];
    if (lt) {
      if (lt.stack) invariants.push('Стек: ' + lt.stack);
      if (lt.prohibitions) invariants.push('Запреты: ' + lt.prohibitions);
      if (lt.rules) invariants.push('Правила: ' + lt.rules);
      if (lt.style) invariants.push('Стиль: ' + lt.style);
    }

    const context = {
      stage,
      stageResult: stageResult || '',
      plan: plan || '',
      invariants: invariants.join('\n'),
      validationResult: validationResult || '',
      taskDescription: this.memoryManager
        ? this.memoryManager.getWorkingMemory().taskDescription
        : '',
    };

    try {
      const verdict = await this.supervisor.analyze(context);
      this.lastSupervisorVerdict = verdict;
      return verdict;
    } catch (e) {
      console.warn('Supervisor check failed:', e.message);
      this.lastSupervisorVerdict = {
        verdict: 'PASS',
        fullResponse: 'Supervisor check unavailable, proceeding.',
        timestamp: Date.now(),
      };
      return this.lastSupervisorVerdict;
    }
  }

  _isControlCommand(text) {
    for (const [type, patterns] of Object.entries(COMMAND_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(text.trim())) return type;
      }
    }
    return null;
  }

  _detectStageComplete(reply) {
    if (!reply) return false;

    const content = reply.length > 5000 ? reply.slice(0, 5000) : reply;

    if (this.taskFSM.state === TASK_STATES.PLANNING) {
      if (content.includes('=== ПЛАН ===') ||
          /план готов|предлагаю план|вот план|план действий/i.test(content) ||
          (content.length > 100 && /1\..*2\..*3\./s.test(content))) {
        return true;
      }
    }
    if (this.taskFSM.state === TASK_STATES.EXECUTION) {
      if (content.includes('=== ГОТОВО ===') ||
          /готово|задача выполнена|вот решение|реализовано|код готов/i.test(content) ||
          (/\b(function|class|const|let|import|export)\b.*\{/s.test(content) && content.length > 200)) {
        return true;
      }
    }
    if (this.taskFSM.state === TASK_STATES.VALIDATION) {
      if (content.includes('=== ВЕРДИКТ ===') ||
          content.startsWith('PASS') || content.startsWith('FAIL') ||
          /вердикт|проверк.*прошл|всё верно/i.test(content)) {
        return true;
      }
    }
    if (this.taskFSM.state === TASK_STATES.DONE) {
      if (content.includes('=== ИТОГ ===') ||
          /задача завершен|итог|резюме|вывод/i.test(content)) {
        return true;
      }
    }
    return false;
  }

  _buildAgentContext(agentName, userMessage) {
    const parts = [];

    switch (agentName) {
      case 'execution':
        if (this.taskFSM.isStageComplete(STAGES.PLANNING)) {
          const plan = this.taskFSM.getStageResult(STAGES.PLANNING);
          if (plan) {
            parts.push('УТВЕРЖДЁННЫЙ ПЛАН:\n' + plan);
          }
        }
        break;

      case 'validation':
        if (this.taskFSM.isStageComplete(STAGES.PLANNING)) {
          const plan = this.taskFSM.getStageResult(STAGES.PLANNING);
          if (plan) parts.push('УТВЕРЖДЁННЫЙ ПЛАН:\n' + plan);
        }
        if (this.taskFSM.isStageComplete(STAGES.EXECUTION)) {
          const exec = this.taskFSM.getStageResult(STAGES.EXECUTION);
          if (exec) parts.push('РЕЗУЛЬТАТ ВЫПОЛНЕНИЯ:\n' + exec);
        }
        break;

      case 'done':
        const summaryParts = [];
        for (const stage of [STAGES.PLANNING, STAGES.EXECUTION, STAGES.VALIDATION]) {
          const data = this.taskFSM.stageData[stage];
          if (data && data.result) {
            const status = data.approved ? '(утверждено)' : '(не утверждено)';
            const preview = data.result.length > 500 ? data.result.slice(0, 500) + '...' : data.result;
            summaryParts.push(`[${stage.toUpperCase()}] ${status}:\n${preview}`);
          }
        }
        if (summaryParts.length > 0) {
          parts.push('ИСТОРИЯ ЭТАПОВ:\n' + summaryParts.join('\n\n'));
        }
        break;
    }

    return parts.join('\n\n');
  }

  async processUserInput(text) {
    const trimmed = text.trim();
    const actions = [];

    if (this.taskFSM.isPaused()) {
      const cmd = this._isControlCommand(trimmed);
      if (cmd === 'resume') {
        this.taskFSM.resume();
        actions.push(ACTION.TASK_RESUMED);
        const agentName = this.taskFSM.getCurrentStageAgent();
        const agent = this.agents[agentName];
        if (agent) {
          const agentPrompt = this._buildAgentContext(agentName, trimmed);
          const contextMsg = `Продолжаем задачу ${this.taskFSM.currentTaskId}. Текущий этап: ${this.taskFSM.getCurrentStage()}.${agentPrompt ? '\n' + agentPrompt : ''}\n\nПользователь говорит: ${trimmed}`;
          const result = await agent.send(contextMsg, { temperature: 0.7 });
          const detectResult = await this._detectAndAutoComplete(agentName, result.reply, actions, trimmed);
          let responseText = result.reply;
          if (actions.includes(ACTION.STAGE_COMPLETE_SUGGESTED)) {
            responseText += "\n\n💡 Похоже, этап завершён. Нажмите 'Утвердить' для перехода дальше.";
          }
          if (detectResult.invariantViolations) {
            responseText += `\n\n⚠️ Внимание: ответ может нарушать инварианты: ${detectResult.invariantViolations.join(', ')}`;
          }
          return { response: responseText, actions };
        }
        return { response: 'Продолжаем задачу. Выберите агента для продолжения.', actions };
      }
      return { response: 'Задача на паузе. Напишите "продолжить" чтобы возобновить.', actions: [ACTION.NONE] };
    }

    if (this.taskFSM.isIdle()) {
      const cmd = this._isControlCommand(trimmed);
      if (cmd === 'pause') return { response: 'Нет активной задачи для паузы.', actions: [ACTION.NONE] };

      const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      this.taskFSM.startTask(taskId);
      actions.push(ACTION.TASK_CREATED);
      actions.push(ACTION.STAGE_CHANGED);

      const agent = this.agents.planning;
      if (agent) {
        const agentPrompt = this._buildAgentContext('planning', trimmed);
        const contextMsg = agentPrompt ? `НОВАЯ ЗАДАЧА (ID: ${taskId})\n\n${agentPrompt}\n\nПользователь говорит: ${trimmed}` : trimmed;
        const result = await agent.send(contextMsg, { temperature: 0.7 });
        const detectResult = await this._detectAndAutoComplete('planning', result.reply, actions, trimmed);
        await this._saveTaskState();
        let responseText = result.reply;
        if (actions.includes(ACTION.STAGE_COMPLETE_SUGGESTED)) {
          responseText += "\n\n💡 Похоже, этап завершён. Нажмите 'Утвердить' для перехода дальше.";
        }
        if (detectResult.invariantViolations) {
          responseText += `\n\n⚠️ Внимание: ответ может нарушать инварианты: ${detectResult.invariantViolations.join(', ')}`;
        }
        return { response: responseText, actions };
      }
      return { response: 'Ошибка: агент планирования не создан.', actions };
    }

    const cmd = this._isControlCommand(trimmed);

    if (cmd === 'pause') {
      await this._saveTaskState();
      this.taskFSM.pause();
      actions.push(ACTION.TASK_PAUSED);
      return { response: `Задача ${this.taskFSM.currentTaskId} поставлена на паузу. Напишите "продолжить" чтобы возобновить.`, actions };
    }

    if (cmd === 'approve') {
      const currentStage = this.taskFSM.getCurrentStage();
      const existingResult = this.taskFSM.getStageResult(currentStage);
      if (!existingResult) {
        return { response: 'Нет результата для утверждения. Дождитесь ответа агента или завершите этап.', actions: [ACTION.NONE] };
      }
      return await this._chainApprove(false);
    }

    if (cmd === 'reject') {
      this.taskFSM.rejectCurrentStage(trimmed);
      actions.push(ACTION.FEEDBACK_SENT);

      const currentAgentName = this.taskFSM.getCurrentStageAgent();
      const currentStage = this.taskFSM.getCurrentStage();
      const agent = this.agents[currentAgentName];

      if (agent) {
        const agentPrompt = this._buildAgentContext(currentAgentName, trimmed);
        const feedbackMsg = (agentPrompt ? `[Контекст задачи]\n${agentPrompt}\n\n` : '') +
          `Пользователь отправил задачу на доработку. Этап: ${currentStage}. Фидбек: ${trimmed}`;
        const result = await agent.send(feedbackMsg, { temperature: 0.7 });
        const detectResult = await this._detectAndAutoComplete(currentAgentName, result.reply, actions, trimmed);
        await this._saveTaskState();
        let responseText = result.reply;
        if (actions.includes(ACTION.STAGE_COMPLETE_SUGGESTED)) {
          responseText += "\n\n💡 Похоже, этап завершён. Нажмите 'Утвердить' для перехода дальше.";
        }
        if (detectResult.invariantViolations) {
          responseText += `\n\n⚠️ Внимание: ответ может нарушать инварианты: ${detectResult.invariantViolations.join(', ')}`;
        }
        return { response: responseText, actions };
      }

      await this._saveTaskState();
      return { response: `Получен фидбек. Этап: ${currentStage} повторяется.`, actions: [ACTION.FEEDBACK_SENT] };
    }

    const agentName = this.taskFSM.getCurrentStageAgent();
    const agent = this.agents[agentName];
    if (!agent) {
      return { response: 'Ошибка: нет активного агента для текущего этапа.', actions };
    }

    const requestCheck = this.invariantChecker.checkRequest(trimmed);
    if (!requestCheck.passed) {
      return { response: `❌ Запрос нарушает инварианты: ${requestCheck.reason}. Я не могу это выполнить.`, actions: [ACTION.NONE] };
    }

    const agentPrompt = this._buildAgentContext(agentName, trimmed);
    const contextMsg = agentPrompt
      ? `[Контекст задачи]\n${agentPrompt}\n\nСообщение пользователя: ${trimmed}`
      : trimmed;

    const result = await agent.send(contextMsg, { temperature: 0.7 });
    const detectResult = await this._detectAndAutoComplete(agentName, result.reply, actions, trimmed);
    await this._saveTaskState();

    let responseText = result.reply;
    if (actions.includes(ACTION.STAGE_COMPLETE_SUGGESTED)) {
      responseText += "\n\n💡 Похоже, этап завершён. Нажмите 'Утвердить' для перехода дальше.";
    }
    if (detectResult.invariantViolations) {
      responseText += `\n\n⚠️ Внимание: ответ может нарушать инварианты: ${detectResult.invariantViolations.join(', ')}`;
    }
    return { response: responseText, actions };
  }

  async _detectAndAutoComplete(agentName, reply, actions, userMessage) {
    const responseCheck = this.invariantChecker.checkResponse(reply);
    if (!responseCheck.passed) {
      actions.push(ACTION.INVARIANT_VIOLATION);
      return { stageComplete: false, verdict: null, invariantViolations: responseCheck.violations };
    }

    if (this._detectStageComplete(reply)) {
      actions.push(ACTION.STAGE_COMPLETE_SUGGESTED);
    }

    return { stageComplete: false, verdict: null };
  }

  async _chainApprove(isAutoPilot = true) {
    const currentStage = this.taskFSM.getCurrentStage();
    const result = this.taskFSM.getStageResult(currentStage);
    const value = result || '(auto-approved)';

    const verdict = await this._runSupervisorCheck(currentStage, result);
    if (verdict && verdict.verdict !== 'PASS') {
      return {
        response: "❌ Супервайзер не пропускает этап:\n" + verdict.fullResponse,
        actions: [ACTION.FEEDBACK_SENT]
      };
    }

    this.taskFSM.approveCurrentStage(value);

    if (this.taskFSM.state === TASK_STATES.IDLE) {
      await this._archiveTask();
      for (const agent of Object.values(this.agents)) {
        if (agent) agent.clearHistory();
      }
      if (this.supervisor) {
        this.supervisor.clearHistory();
      }
      this.lastSupervisorVerdict = null;
      const actions = [ACTION.STAGE_CHANGED, ACTION.TASK_COMPLETED];
      if (isAutoPilot) actions.push(ACTION.AUTO_PILOT_APPROVED);
      return { response: isAutoPilot ? '🏁 Задача завершена автоматически.' : 'Задача завершена.', actions };
    }

    const nextAgentName = this.taskFSM.getCurrentStageAgent();
    const nextAgent = this.agents[nextAgentName];
    if (!nextAgent) {
      const actions = [ACTION.STAGE_CHANGED];
      if (isAutoPilot) actions.push(ACTION.AUTO_PILOT_APPROVED);
      return { response: `Переход на этап ${this.taskFSM.getCurrentStage()}.`, actions };
    }

    nextAgent.clearHistory();
    const nextStage = this.taskFSM.getCurrentStage();
    const agentPrompt = this._buildAgentContext(nextAgentName, '');
    const taskId = this.taskFSM.currentTaskId;
    let starterMsg = isAutoPilot
      ? `Задача ${taskId} перешла на этап ${nextStage}. (Auto-Pilot)`
      : `Задача ${taskId} перешла на этап ${nextStage}.`;

    if (nextAgentName === 'execution') {
      const plan = this.taskFSM.getStageResult(STAGES.PLANNING);
      if (plan) starterMsg += `\n\nПлан для выполнения:\n${plan}`;
    } else if (nextAgentName === 'validation') {
      const plan = this.taskFSM.getStageResult(STAGES.PLANNING);
      const exec = this.taskFSM.getStageResult(STAGES.EXECUTION);
      if (plan) starterMsg += `\n\nПлан:\n${plan}`;
      if (exec) starterMsg += `\n\nРезультат выполнения:\n${exec}`;
    } else if (nextAgentName === 'done') {
      starterMsg += '\n\nЗадача выполнена. Подведи итог.';
    }

    if (agentPrompt) starterMsg += '\n\n' + agentPrompt;

    const nextResult = await nextAgent.send(starterMsg, { temperature: 0.7 });
    await this._saveTaskState();

    const actions = [ACTION.STAGE_CHANGED];
    if (isAutoPilot) actions.push(ACTION.AUTO_PILOT_APPROVED);
    return {
      response: nextResult.reply,
      actions,
    };
  }

  async _saveTaskState() {
    if (!this.taskStorage) return;
    try {
      const state = this.taskFSM.serialize();
      const agentStates = {};
      for (const [name, agent] of Object.entries(this.agents)) {
        if (agent) {
          agentStates[name] = agent.getState();
        }
      }
      if (this.supervisor) {
        agentStates['supervisor'] = this.supervisor.getState();
      }
      await this.taskStorage.saveTask(this.taskFSM.currentTaskId, {
        fsmState: state,
        agentHistories: agentStates,
        summary: this.taskFSM.getSummary(),
      });
    } catch (e) {
      console.warn('Save task state failed:', e.message);
    }
  }

  async loadTaskState(taskId) {
    if (!this.taskStorage) return false;
    try {
      const data = await this.taskStorage.loadTask(taskId);
      if (!data) return false;

      if (!data.fsmState) {
        return false;
      }

      this.taskFSM.deserialize(data.fsmState);
      if (data.agentHistories) {
        for (const [name, state] of Object.entries(data.agentHistories)) {
          if (name === 'supervisor') {
            if (this.supervisor) this.supervisor.loadState(state);
          } else if (this.agents[name] && state) {
            this.agents[name].loadState(state);
          }
        }
        if (data.agentHistories['supervisor']?.lastVerdict) {
          this.lastSupervisorVerdict = data.agentHistories['supervisor'].lastVerdict;
        }
      }

      return true;
    } catch (e) {
      console.warn('Load task state failed:', e.message);
      return false;
    }
  }

  async _archiveTask() {
    if (!this.taskStorage) return;
    const taskId = this.taskFSM.currentTaskId;
    try {
      await this.taskStorage.archiveTask({
        taskId,
        fsmState: this.taskFSM.serialize(),
        agentHistories: {},
        summary: this.taskFSM.getSummary(),
        archivedAt: Date.now(),
      });
      await this.taskStorage.deleteTask(taskId);
    } catch (e) {
      console.warn('Archive task failed:', e.message);
    }
  }

  async cancelTask() {
    if (this.taskFSM.isIdle()) return;
    const taskId = this.taskFSM.currentTaskId;
    this.taskFSM.transition(TASK_STATES.IDLE);
    for (const agent of Object.values(this.agents)) {
      if (agent) agent.clearHistory();
    }
    if (this.supervisor) {
      this.supervisor.clearHistory();
    }
    this.lastSupervisorVerdict = null;
    for (const key of Object.keys(this.taskFSM.stageData)) {
      this.taskFSM.stageData[key] = null;
    }
    if (this.taskStorage && taskId) {
      await this.taskStorage.deleteTask(taskId);
    }
    this.taskFSM.currentTaskId = null;
  }

  getAvailableCommands() {
    const state = this.taskFSM.state;
    const cmds = [];
    if (state === TASK_STATES.PLANNING || state === TASK_STATES.EXECUTION || state === TASK_STATES.VALIDATION || state === TASK_STATES.DONE) {
      if (!this.autoPilot) {
        cmds.push({ action: 'approve', label: '✓ Утвердить', title: 'Перейти к следующему этапу' });
      }
      if (state === TASK_STATES.EXECUTION || state === TASK_STATES.VALIDATION) {
        cmds.push({ action: 'reject', label: '↻ Переделать', title: 'Отправить на доработку' });
      }
      cmds.push({ action: 'pause', label: '⏸ Пауза', title: 'Поставить задачу на паузу' });
    }
    if (state === TASK_STATES.PAUSED) {
      cmds.push({ action: 'resume', label: '▶ Продолжить', title: 'Возобновить задачу' });
    }
    return cmds;
  }

  getSupervisorStatus() {
    return {
      autoPilot: this.autoPilot,
      lastVerdict: this.lastSupervisorVerdict,
    };
  }

}

window.OrchestratorAgent = OrchestratorAgent;
window.ACTION = ACTION;