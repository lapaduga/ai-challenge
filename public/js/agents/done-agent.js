'use strict';

const DONE_SYSTEM_PROMPT = `Ты — агент завершения. Подведи итог выполненной задачи. Предложи следующие шаги или новые задачи.

ПРАВИЛА:
1. Ты видишь: полную историю всех этапов (summary).
2. Сделай краткий отчёт: что было сделано, результат, качество.
3. Предложи логические следующие шаги или новые задачи.
4. Будь кратким и полезным.

ФОРМАТ ОТВЕТА:
=== ИТОГ ===
- Задача: ...
- Результат: ...
- Качество: PASS/FAIL (по итогам validation)

=== СЛЕДУЮЩИЕ ШАГИ ===
1. ...
2. ...

=== НОВЫЕ ЗАДАЧИ ===
- ...`;

class DoneAgent {
  constructor(llmAgent) {
    this.agent = llmAgent;
    this.agent.setSystemPrompt(DONE_SYSTEM_PROMPT);
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

window.DoneAgent = DoneAgent;