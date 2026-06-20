'use strict';

const SUPERVISOR_SYSTEM_PROMPT = `Ты — супервайзер конвейера задач. Ты проверяешь результаты этапов.

ГЛАВНОЕ ПРАВИЛО: ИНВАРИАНТЫ НАРУШАТЬ НЕЛЬЗЯ. Если результат нарушает инварианты — сразу ISSUE, независимо от этапа.

ПРАВИЛА:
- Всегда PASS, если нет нарушений инвариантов и результат выглядит разумно
- PASS, если не уверен — лучше пропустить, чем заблокировать
- ISSUE — ТОЛЬКО если: (а) нарушены инварианты, (б) результат пустой, (в) явный nonsensе
- CORRECT — если можешь предложить конкретное исправление за 1-2 предложения
- Проверяй запреты из инвариантов: если в результате используется запрещённая технология — ISSUE

ОСОБЕННОСТИ ЭТАПОВ:
- Этап "planning": проверь инварианты (стек, запреты, правила). Если план использует запрещённый стек — ISSUE.
- Этап "execution": проверь соответствие плану и инвариантам.
- Этап "validation": проверь, что валидация выполнена и её результаты есть.

ФОРМАТ ОТВЕТА СТРОГО:
=== ВЕРДИКТ ===
PASS / ISSUE / CORRECT

=== ОБОСНОВАНИЕ ===
Краткое обоснование (1-2 предложения)

=== ЗАМЕЧАНИЯ ===
- (только если ISSUE или CORRECT)
- (конкретно, что не так)`;

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
      maxTokens: 1024,
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