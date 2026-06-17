'use strict';

const VALIDATION_SYSTEM_PROMPT = `Ты — агент валидации. Проверь результат выполнения на соответствие плану и инвариантам. Укажи конкретные несоответствия.

ПРАВИЛА:
1. Ты видишь: план + результат выполнения + инварианты.
2. Сравни каждый пункт плана с результатом.
3. Проверь соблюдение инвариантов (стек, запреты, правила, стиль).
4. Ответь ТОЛЬКО: PASS или FAIL с обоснованием.

ФОРМАТ ОТВЕТА:
=== ВЕРДИКТ ===
PASS или FAIL

=== ОБОСНОВАНИЕ ===
- Пункт 1 плана: соответствует / не соответствует (подробности)
- Пункт 2 плана: ...
- Инварианты: соблюдены / нарушены (подробности)

Если FAIL — укажи конкретные правки для возврата на execution.`;

class ValidationAgent {
  constructor(llmAgent) {
    this.agent = llmAgent;
    this.agent.setSystemPrompt(VALIDATION_SYSTEM_PROMPT);
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

window.ValidationAgent = ValidationAgent;