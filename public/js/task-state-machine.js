'use strict';

const TASK_STATES = {
  IDLE: 'idle',
  PLANNING: 'planning',
  EXECUTION: 'execution',
  VALIDATION: 'validation',
  DONE: 'done',
  PAUSED: 'paused',
};

const STAGES = {
  PLANNING: 'planning',
  EXECUTION: 'execution',
  VALIDATION: 'validation',
  DONE: 'done',
};

const VALID_TRANSITIONS = {
  [TASK_STATES.IDLE]: [TASK_STATES.PLANNING, TASK_STATES.PAUSED],
  [TASK_STATES.PLANNING]: [TASK_STATES.EXECUTION, TASK_STATES.PAUSED, TASK_STATES.IDLE],
  [TASK_STATES.EXECUTION]: [TASK_STATES.VALIDATION, TASK_STATES.PAUSED, TASK_STATES.PLANNING, TASK_STATES.IDLE],
  [TASK_STATES.VALIDATION]: [TASK_STATES.DONE, TASK_STATES.EXECUTION, TASK_STATES.PAUSED, TASK_STATES.IDLE],
  [TASK_STATES.DONE]: [TASK_STATES.IDLE, TASK_STATES.PAUSED],
  [TASK_STATES.PAUSED]: [TASK_STATES.PLANNING, TASK_STATES.EXECUTION, TASK_STATES.VALIDATION, TASK_STATES.DONE, TASK_STATES.IDLE],
};

const STAGE_TO_AGENT = {
  [STAGES.PLANNING]: 'planning',
  [STAGES.EXECUTION]: 'execution',
  [STAGES.VALIDATION]: 'validation',
  [STAGES.DONE]: 'done',
};

class TaskStateMachine {
  constructor() {
    this.state = TASK_STATES.IDLE;
    this.stageData = {
      [STAGES.PLANNING]: null,
      [STAGES.EXECUTION]: null,
      [STAGES.VALIDATION]: null,
      [STAGES.DONE]: null,
    };
    this.currentTaskId = null;
    this.previousState = null;
    this.createdAt = null;
    this.updatedAt = null;
  }

  canTransition(from, to) {
    const allowed = VALID_TRANSITIONS[from] || [];
    return allowed.includes(to);
  }

  transition(to, context = {}) {
    if (!this.canTransition(this.state, to)) {
      throw new Error(`Invalid transition from ${this.state} to ${to}`);
    }

    this.previousState = this.state;
    this.state = to;
    this.updatedAt = Date.now();

    if (context.stageResult !== undefined) {
      const stage = STAGE_TO_AGENT[this.previousState];
      if (stage && this.stageData[stage] !== null) {
        this.stageData[stage] = {
          ...this.stageData[stage],
          result: context.stageResult,
          approved: context.approved ?? false,
          feedback: context.feedback ?? null,
          timestamp: Date.now(),
        };
      }
    }

    if (to === TASK_STATES.PAUSED) {
      this.previousState = context.resumeFrom || this.previousState;
    }
  }

  getCurrentStage() {
    if (this.state === TASK_STATES.PLANNING) return STAGES.PLANNING;
    if (this.state === TASK_STATES.EXECUTION) return STAGES.EXECUTION;
    if (this.state === TASK_STATES.VALIDATION) return STAGES.VALIDATION;
    if (this.state === TASK_STATES.DONE) return STAGES.DONE;
    if (this.state === TASK_STATES.PAUSED && this.previousState) {
      if (this.previousState === TASK_STATES.PLANNING) return STAGES.PLANNING;
      if (this.previousState === TASK_STATES.EXECUTION) return STAGES.EXECUTION;
      if (this.previousState === TASK_STATES.VALIDATION) return STAGES.VALIDATION;
      if (this.previousState === TASK_STATES.DONE) return STAGES.DONE;
    }
    return null;
  }

  getCurrentStageAgent() {
    const stage = this.getCurrentStage();
    return stage ? STAGE_TO_AGENT[stage] : null;
  }

  isStageComplete(stage) {
    const data = this.stageData[stage];
    return data && data.approved === true;
  }

  getStageResult(stage) {
    return this.stageData[stage]?.result ?? null;
  }

  setStageResult(stage, result, approved = false, feedback = null) {
    this.stageData[stage] = {
      result,
      approved,
      feedback,
      timestamp: Date.now(),
    };
    this.updatedAt = Date.now();
  }

  startTask(taskId) {
    this.currentTaskId = taskId;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    for (const key of Object.keys(this.stageData)) {
      this.stageData[key] = null;
    }
    this.transition(TASK_STATES.PLANNING);
  }

  pause() {
    if (this.state === TASK_STATES.PAUSED) return;
    this.transition(TASK_STATES.PAUSED, { resumeFrom: this.state });
  }

  resume() {
    if (this.state !== TASK_STATES.PAUSED) return;
    const resumeTo = this.previousState || TASK_STATES.IDLE;
    this.transition(resumeTo);
  }

  approveCurrentStage(result) {
    const stage = this.getCurrentStage();
    if (stage) {
      this.setStageResult(stage, result, true);
    }

    if (this.state === TASK_STATES.PLANNING) {
      this.transition(TASK_STATES.EXECUTION);
    } else if (this.state === TASK_STATES.EXECUTION) {
      this.transition(TASK_STATES.VALIDATION);
    } else if (this.state === TASK_STATES.VALIDATION) {
      this.transition(TASK_STATES.DONE);
    } else if (this.state === TASK_STATES.DONE) {
      this.transition(TASK_STATES.IDLE);
    }
  }

  rejectCurrentStage(feedback) {
    const stage = this.getCurrentStage();
    if (stage) {
      this.setStageResult(stage, null, false, feedback);
    }

    if (this.state === TASK_STATES.EXECUTION) {
      this.transition(TASK_STATES.PLANNING);
    } else if (this.state === TASK_STATES.VALIDATION) {
      this.transition(TASK_STATES.EXECUTION);
    }
  }

  serialize() {
    return {
      state: this.state,
      previousState: this.previousState,
      stageData: this.stageData,
      currentTaskId: this.currentTaskId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  deserialize(data) {
    if (!data) return;
    this.state = data.state || TASK_STATES.IDLE;
    this.previousState = data.previousState || null;
    this.stageData = data.stageData || {
      [STAGES.PLANNING]: null,
      [STAGES.EXECUTION]: null,
      [STAGES.VALIDATION]: null,
      [STAGES.DONE]: null,
    };
    this.currentTaskId = data.currentTaskId || null;
    this.createdAt = data.createdAt || null;
    this.updatedAt = data.updatedAt || null;
  }

  isIdle() {
    return this.state === TASK_STATES.IDLE;
  }

  isPaused() {
    return this.state === TASK_STATES.PAUSED;
  }

  isActive() {
    return !this.isIdle() && !this.isPaused();
  }

  getSummary() {
    const stage = this.getCurrentStage();
    return {
      taskId: this.currentTaskId,
      state: this.state,
      stage,
      stageData: this.stageData,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

window.TaskStateMachine = TaskStateMachine;
window.TASK_STATES = TASK_STATES;
window.STAGES = STAGES;