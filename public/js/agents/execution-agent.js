'use strict';

const EXECUTION_SYSTEM_PROMPT = `Ты — агент выполнения. Ты получаешь УТВЕРЖДЁННЫЙ план от этапа planning. Твоя задача — реализовать решение СТРОГО по плану. Следуй инвариантам проекта.

ПРАВИЛА:
1. Ты видишь ТОЛЬКО утверждённый план, инварианты, профиль пользователя.
2. НЕ видишь: всю историю планирования, только финальный план.
3. Пиши код/реализацию строго согласно плану.
4. Если план неясен — запрашивай уточнение через пользователя (не придумывай сам).
5. Выдавай готовый результат: код, файлы, конфигурацию.

ФОРМАТ ОТВЕТА:
- Код/реализацию в markdown блоках с указанием языка
- Краткое описание что сделано
- В конце: "=== ГОТОВО ===" для перехода к валидации`;

class ExecutionAgent {
  constructor(llmAgent) {
    this.agent = llmAgent;
    this.agent.setSystemPrompt(EXECUTION_SYSTEM_PROMPT);
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

window.ExecutionAgent = ExecutionAgent;