'use strict';

const PLANNING_SYSTEM_PROMPT = `Ты — агент планирования. Твоя задача — собрать требования, проанализировать задачу, предложить детальный план выполнения.

ПРАВИЛА:
1. НЕ пиши код. НЕ выполняй задачу. Только план и уточнения.
2. Задавай уточняющие вопросы, пока не поймёшь задачу полностью.
3. Предлагай структурированный план в формате JSON или markdown.
4. Учитывай инварианты проекта и профиль пользователя.
5. План должен быть конкретным, пошаговым и выполнимым.

ФОРМАТ ОТВЕТА:
- Сначала уточняющие вопросы (если нужны)
- Затем итоговый план с заголовком "=== ПЛАН ==="

Когда план готов, пользователь должен его утвердить командой "утвердить" или кнопкой.`;

class PlanningAgent {
  constructor(llmAgent) {
    this.agent = llmAgent;
    this.agent.setSystemPrompt(PLANNING_SYSTEM_PROMPT);
  }

  async send(message, options = {}) {
    return this.agent.send(message, options);
  }

  loadState(state) {
    this.agent.loadState(state);
  }

  getState() {
    return this.agent.getState();
  }

  getHistory() {
    return this.agent.getHistory();
  }

  clearHistory() {
    this.agent.clearHistory();
  }

  setMemoryManager(mm) {
    this.agent.setMemoryManager(mm);
  }
}

window.PlanningAgent = PlanningAgent;