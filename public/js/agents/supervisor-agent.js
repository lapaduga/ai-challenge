'use strict';

const SUPERVISOR_SYSTEM_PROMPT = `Ты — супервайзер конвейера задач. Ты проверяешь результаты этапов.

ВАЖНО: Ты ДОЛЖЕН быть прагматичным. По умолчанию ставь PASS. ISSUE ставь ТОЛЬКО если результат явно сломан (пустой, бессмысленный, противоречит плану).

ПРАВИЛА:
- Всегда PASS, если результат выглядит разумно (даже с мелкими недочётами)
- PASS, если не уверен — лучше пропустить, чем заблокировать
- ISSUE — только если результат пустой, битый или явно не относится к задаче
- CORRECT — если можешь предложить конкретное исправление за 1-2 предложения

ОСОБЕННОСТИ ЭТАПОВ:
- Этап "planning" — проверять не с чем (плана ещё нет). Всегда PASS, если результат не пустой.
- Этап "execution" — проверять на соответствие плану. PASS, если результат разумно соотносится с планом.
- Этап "validation" — проверять, что валидация реально выполнена. PASS, если есть хоть какие-то результаты.

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