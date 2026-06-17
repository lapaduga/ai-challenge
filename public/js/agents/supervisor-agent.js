'use strict';

const SUPERVISOR_SYSTEM_PROMPT = `Ты — супервайзер конвейера задач. Ты наблюдаешь за результатами всех этапов выполнения задачи.

ТВОИ ЗАДАЧИ:
1. Проверять результат каждого этапа на соответствие инвариантам проекта
2. Выявлять ошибки, противоречия, отклонения от утверждённого плана
3. Оценивать качество и полноту результата
4. Принимать решение: можно ли переходить к следующему этапу

ПРАВИЛА:
- Если результат корректный, соответствует плану и инвариантам — отвечай PASS
- Если есть незначительные замечания, но в целом OK — отвечай PASS с рекомендациями
- Если есть критическая ошибка, нарушение инвариантов или несоответствие плану — отвечай ISSUE с подробным описанием
- Если можешь предложить конкретное исправление — отвечай CORRECT с предложением

ФОРМАТ ОТВЕТА СТРОГО:
=== ВЕРДИКТ ===
PASS / ISSUE / CORRECT

=== ОБОСНОВАНИЕ ===
Краткое обоснование решения (2-3 предложения)

=== ЗАМЕЧАНИЯ ===
- Замечание 1
- Замечание 2

(если ISSUE или CORRECT — замечания обязательны)`;

const SUPERVISOR_VERDICT = {
  PASS: 'PASS',
  ISSUE: 'ISSUE',
  CORRECT: 'CORRECT',
};

class SupervisorAgent {
  constructor(llmAgent) {
    this.agent = llmAgent;
    this.agent.setSystemPrompt(SUPERVISOR_SYSTEM_PROMPT);
    this.lastVerdict = null;
  }

  async analyze(stageContext) {
    const {
      stage,
      stageResult,
      plan,
      invariants,
      validationResult,
      taskDescription,
    } = stageContext;

    const parts = [];
    parts.push(`Задача: ${taskDescription || 'не указана'}`);
    parts.push(`Текущий этап: ${stage}`);
    parts.push('');

    if (invariants) {
      parts.push('ИНВАРИАНТЫ ПРОЕКТА:');
      parts.push(invariants);
      parts.push('');
    }

    if (plan) {
      parts.push('УТВЕРЖДЁННЫЙ ПЛАН:');
      parts.push(plan);
      parts.push('');
    }

    parts.push('РЕЗУЛЬТАТ ЭТАПА:');
    parts.push(stageResult || 'нет результата');
    parts.push('');

    if (validationResult) {
      parts.push('РЕЗУЛЬТАТ ВАЛИДАЦИИ:');
      parts.push(validationResult);
      parts.push('');
    }

    const contextMsg = parts.join('\n');

    const result = await this.agent.send(contextMsg, {
      temperature: 0.2,
      maxTokens: 500,
    });

    const reply = result.reply || '';

    const verdictMatch = reply.match(/=== ВЕРДИКТ ===\s*\n(PASS|ISSUE|CORRECT)/i);
    let verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'ISSUE';

    if (verdict !== 'PASS' && verdict !== 'ISSUE' && verdict !== 'CORRECT') {
      verdict = 'ISSUE';
    }

    this.lastVerdict = {
      verdict,
      fullResponse: reply,
      timestamp: Date.now(),
    };

    return this.lastVerdict;
  }

  clearHistory() {
    this.agent.clearHistory();
    this.lastVerdict = null;
  }

  loadState(state) {
    if (!state) return;
    this.agent.loadState(state.agentState);
    if (state.lastVerdict) {
      this.lastVerdict = state.lastVerdict;
    }
  }

  getState() {
    return {
      agentState: this.agent.getState(),
      lastVerdict: this.lastVerdict,
    };
  }
}

window.SupervisorAgent = SupervisorAgent;
window.SUPERVISOR_VERDICT = SUPERVISOR_VERDICT;