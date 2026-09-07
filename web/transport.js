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
 * @typedef {AgentEventMessage | AgentEventToolCall | AgentEventToolResult | AgentEventAsk | AgentEventDone | AgentEventError} AgentEvent
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
 * @typedef {AgentReplyAnswer | AgentReplyApprove} AgentReply
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
  start(task) {
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

  async start(task) {
    this.stop();
    this.running = true;

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

    const script = scenarioGenerator(task);

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

  start(task) {
    this.stop();
    const url = `${this.baseUrl}/api/run?task=${encodeURIComponent(task)}`;
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
        headers: { 'Content-Uri': 'application/json', 'Content-Type': 'application/json' },
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
