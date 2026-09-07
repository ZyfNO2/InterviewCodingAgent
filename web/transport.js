/**
 * AgentEvent & AgentReply 契约定义与传输层抽象
 * 契约参考 Plan/04-Phase4-WebUI.md A.3 节
 */

/**
 * @typedef {Object} AgentEventMessage
 * @property {'message'} type
 * @property {'user' | 'assistant'} role
 * @property {string} content
 *
 * @typedef {Object} AgentEventToolCall
 * @property {'tool_call'} type
 * @property {string} id
 * @property {string} name
 * @property {unknown} args
 *
 * @typedef {Object} AgentEventToolResult
 * @property {'tool_result'} type
 * @property {string} id
 * @property {string} name
 * @property {boolean} ok
 * @property {string} result
 *
 * @typedef {Object} AgentEventAsk
 * @property {'ask'} type
 * @property {string} id
 * @property {'ask_user' | 'permission'} kind
 * @property {string} question
 *
 * @typedef {Object} AgentEventDone
 * @property {'done'} type
 * @property {string} text
 *
 * @typedef {Object} AgentEventError
 * @property {'error'} type
 * @property {string} message
 *
 * // —— Phase 4 增量事件契约 ——
 * @typedef {Object} AgentEventSessionStart
 * @property {'session_start'} type
 * @property {string} sessionId
 * @property {string} [title]
 *
 * @typedef {Object} AgentEventSessionTurn
 * @property {'session_turn'} type
 * @property {string} sessionId
 * @property {number} turn
 *
 * @typedef {Object} AgentEventSession
 * @property {'session'} type
 * @property {string} sessionId
 * @property {number} userTurns
 *
 * @typedef {Object} AgentEventSoul
 * @property {'soul'} type
 * @property {'loaded' | 'updated' | 'consolidated'} action
 * @property {string} summary
 *
 * @typedef {Object} AgentEventCommand
 * @property {'command'} type
 * @property {'init' | 'plan'} command
 * @property {boolean} accepted
 * @property {string} [note]
 *
 * @typedef {Object} AgentEventGoal
 * @property {'goal'} type
 * @property {string} description
 * @property {string[]} acceptanceCriteria
 *
 * @typedef {Object} AgentEventPlan
 * @property {'plan'} type
 * @property {string[]} steps
 * @property {string[]} [risks]
 * @property {'proposed' | 'approved' | 'rejected' | 'revised'} status
 *
 * @typedef {Object} AgentEventCompletionCheck
 * @property {'completion_check'} type
 * @property {boolean} complete
 * @property {string} [reason]
 * @property {string[]} [remaining]
 * @property {number} attempt
 *
 * @typedef {Object} AgentEventStallWarning
 * @property {'stall_warning'} type
 * @property {number} round
 *
 * @typedef {Object} AgentEventEarlyStop
 * @property {'early_stop'} type
 * @property {'stalled' | 'completion_check_limit' | 'max_steps'} stopReason
 * @property {string} [detail]
 *
 * @typedef {AgentEventMessage | AgentEventToolCall | AgentEventToolResult | AgentEventAsk | AgentEventDone | AgentEventError | AgentEventSessionStart | AgentEventSessionTurn | AgentEventSession | AgentEventSoul | AgentEventCommand | AgentEventGoal | AgentEventPlan | AgentEventCompletionCheck | AgentEventStallWarning | AgentEventEarlyStop} AgentEvent
 */

/**
 * @typedef {Object} AgentReplyAnswer
 * @property {'answer'} type
 * @property {string} id
 * @property {string} value
 *
 * @typedef {Object} AgentReplyApprove
 * @property {'approve'} type
 * @property {string} id
 * @property {boolean} approved
 *
 * @typedef {Object} AgentReplyPlanDecision
 * @property {'plan_decision'} type
 * @property {string} id
 * @property {'approve' | 'reject' | 'revise'} decision
 * @property {string} [note]
 *
 * @typedef {AgentReplyAnswer | AgentReplyApprove | AgentReplyPlanDecision} AgentReply
 */

/**
 * EventSource 抽象基类
 */
export class BaseEventSource {
  constructor() {
    /** @type {((event: AgentEvent) => void) | null} */
    this.listener = null;
  }

  /**
   * 注册事件监听器
   * @param {(event: AgentEvent) => void} cb
   */
  onEvent(cb) {
    this.listener = cb;
  }

  /**
   * 触发事件分发
   * @param {AgentEvent} event
   */
  emit(event) {
    if (this.listener) {
      this.listener(event);
    }
  }

  /**
   * 启动任务
   * @param {string} task
   */
  start(task, sessionId) {
    throw new Error('start() not implemented');
  }

  /**
   * 回复 ask（ask_user 或 permission）
   * @param {AgentReply} reply
   */
  reply(reply) {
    throw new Error('reply() not implemented');
  }

  /**
   * 停止或重置当前运行
   */
  stop() {}
}

/**
 * MockEventSource：基于内存剧本回放与 setTimeout 驱动
 */
export class MockEventSource extends BaseEventSource {
  /**
   * @param {Object} scenarios - 剧本字典，key 为场景名
   * @param {number} [stepDelay=700] - 每个事件之间的模拟间隔毫秒
   */
  constructor(scenarios, stepDelay = 700) {
    super();
    this.scenarios = scenarios;
    this.stepDelay = stepDelay;
    this.currentScenarioKey = 'case1';
    this.running = false;
    this.timeoutId = null;
    /** @type {((reply: AgentReply) => void) | null} */
    this.pendingReplyResolver = null;
    this.currentSessionId = 'sess-mock-default';
    this.turnCounter = 0;
  }

  /**
   * 设置会话 ID
   * @param {string} sessionId
   */
  setSession(sessionId) {
    this.currentSessionId = sessionId;
    this.turnCounter = 0;
  }

  /**
   * 设置当前激活的 Mock 剧本
   * @param {string} key
   */
  setScenario(key) {
    if (this.scenarios[key]) {
      this.currentScenarioKey = key;
    }
  }

  async start(task, sessionId) {
    this.stop();
    this.running = true;

    if (sessionId) {
      this.currentSessionId = sessionId;
    }
    this.turnCounter++;

    // 先发送一条用户消息
    this.emit({
      type: 'message',
      role: 'user',
      content: task,
    });

    const scenarioGenerator = this.scenarios[this.currentScenarioKey];
    if (!scenarioGenerator) {
      this.emit({ type: 'error', message: `未找到剧本 [${this.currentScenarioKey}]` });
      this.running = false;
      return;
    }

    // 支持生成器/函数传递上下文
    const script = typeof scenarioGenerator === 'function'
      ? scenarioGenerator(task, { sessionId: this.currentSessionId, turn: this.turnCounter })
      : scenarioGenerator;

    try {
      for (const item of script) {
        if (!this.running) break;

        await new Promise((resolve) => {
          this.timeoutId = setTimeout(resolve, this.stepDelay);
        });

        if (!this.running) break;

        this.emit(item);

        // 如果是 ask 事件，挂起等待用户 reply
        if (item.type === 'ask') {
          const reply = await new Promise((resolve) => {
            this.pendingReplyResolver = resolve;
          });
          this.pendingReplyResolver = null;

          if (!this.running) break;

          // 模拟收到回复后的确认反馈
          if (reply.type === 'approve') {
            if (!reply.approved) {
              // 用户拒绝执行
              this.emit({
                type: 'tool_result',
                id: item.id,
                name: 'permission_guard',
                ok: false,
                result: '操作已被用户拒绝 (Permission Denied by User)',
              });
              this.emit({
                type: 'done',
                text: '检测到操作被拒绝，已终止当前高危流程。',
              });
              break;
            }
          } else if (reply.type === 'answer') {
            this.emit({
              type: 'message',
              role: 'user',
              content: `[用户回复]: ${reply.value}`,
            });
          } else if (reply.type === 'plan_decision') {
            // Plan 决策回复 (approve / reject / revise)
            if (reply.decision === 'approve') {
              this.emit({
                type: 'plan',
                status: 'approved',
                steps: item.steps || ['1. 执行计划步骤'],
              });
            } else if (reply.decision === 'reject') {
              this.emit({
                type: 'plan',
                status: 'rejected',
                steps: item.steps || ['1. 执行计划步骤'],
              });
              this.emit({
                type: 'done',
                text: 'Plan rejected, no changes made. (计划已被驳回，未执行任何副作用操作)',
              });
              break;
            } else if (reply.decision === 'revise') {
              this.emit({
                type: 'message',
                role: 'user',
                content: `[修改建议]: ${reply.note || '请调整步骤'}`,
              });
              this.emit({
                type: 'plan',
                status: 'revised',
                steps: ['1. 根据修改建议重构步骤 (Revised)', '2. 执行并验证'],
                risks: ['已规避修改意见中提到的风险'],
              });
            }
          }
        }
      }
    } catch (err) {
      this.emit({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.running = false;
    }
  }

  reply(reply) {
    if (this.pendingReplyResolver) {
      this.pendingReplyResolver(reply);
    }
  }

  stop() {
    this.running = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.pendingReplyResolver) {
      this.pendingReplyResolver({ type: 'approve', id: 'cancel', approved: false });
      this.pendingReplyResolver = null;
    }
  }
}

/**
 * SseEventSource：接线真实后端 API
 */
export class SseEventSource extends BaseEventSource {
  /**
   * @param {string} [baseUrl='']
   */
  constructor(baseUrl = '') {
    super();
    this.baseUrl = baseUrl;
    this.eventSource = null;
  }

  start(task, sessionId) {
    this.stop();
    const sessionParam = sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : '';
    const url = `${this.baseUrl}/api/run?task=${encodeURIComponent(task)}${sessionParam}`;
    this.eventSource = new window.EventSource(url);

    this.eventSource.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        this.emit(parsed);
      } catch (err) {
        this.emit({ type: 'error', message: `解析服务端事件失败: ${err.message}` });
      }
    };

    this.eventSource.onerror = () => {
      this.emit({ type: 'error', message: '后端 SSE 连接异常断开' });
      this.stop();
    };
  }

  async reply(reply) {
    try {
      await fetch(`${this.baseUrl}/api/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reply),
      });
    } catch (err) {
      this.emit({ type: 'error', message: `提交回答失败: ${err.message}` });
    }
  }

  stop() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}
