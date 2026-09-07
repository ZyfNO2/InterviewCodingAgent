import { mockScenarios } from './mock.js';
import { MockEventSource, SseEventSource } from './transport.js';

class WebApp {
  constructor() {
    this.sourceMode = 'mock'; // 'mock' | 'sse'
    this.mockSource = new MockEventSource(mockScenarios, 650);
    this.sseSource = new SseEventSource('');
    this.activeSource = this.mockSource;

    this.toolCallCards = new Map(); // id -> element
    this.currentSessionId = 'sess-default';
    this.currentTurn = 1;
    this.planApprovalPending = false; // 计划审批防御标记

    this.dom = {
      sourceModeSelect: document.getElementById('source-mode'),
      scenarioSelect: document.getElementById('scenario-select'),
      scenarioContainer: document.getElementById('scenario-container'),
      backendUrlInput: document.getElementById('backend-url-container'),
      taskInput: document.getElementById('task-input'),
      commandBadge: document.getElementById('command-badge'),
      sendBtn: document.getElementById('send-btn'),
      stopBtn: document.getElementById('stop-btn'),
      clearBtn: document.getElementById('clear-btn'),
      eventsList: document.getElementById('events-list'),
      statusBadge: document.getElementById('status-badge'),
      emptyState: document.getElementById('empty-state'),
      sessionIdDisplay: document.getElementById('session-id-display'),
      sessionTurnDisplay: document.getElementById('session-turn-display'),
      sessionSelect: document.getElementById('session-select'),
      newSessionBtn: document.getElementById('new-session-btn'),
      soulBar: document.getElementById('soul-bar'),
      soulSummary: document.getElementById('soul-summary'),
    };

    this.init();
  }

  init() {
    // 监听事件
    this.mockSource.onEvent((event) => this.handleEvent(event));
    this.sseSource.onEvent((event) => this.handleEvent(event));

    // 模式切换
    this.dom.sourceModeSelect.addEventListener('change', (e) => {
      this.sourceMode = e.target.value;
      if (this.sourceMode === 'mock') {
        this.activeSource = this.mockSource;
        this.dom.scenarioContainer.style.display = 'flex';
        this.dom.backendUrlInput.style.display = 'none';
        this.setStatus('Ready (Mock Mode)', 'info');
      } else {
        this.activeSource = this.sseSource;
        this.dom.scenarioContainer.style.display = 'none';
        this.dom.backendUrlInput.style.display = 'flex';
        this.setStatus('Ready (Live API)', 'info');
      }
    });

    // 剧本切换
    this.dom.scenarioSelect.addEventListener('change', (e) => {
      this.mockSource.setScenario(e.target.value);
      this.updateDefaultTaskPrompt(e.target.value);
    });

    // 新建会话
    this.dom.newSessionBtn.addEventListener('click', () => {
      this.newSession();
    });

    // 会话下拉切换（localStorage 持久化，跨刷新保留）
    this.dom.sessionSelect.addEventListener('change', (e) => {
      this.switchSession(e.target.value);
    });
    const savedSession = localStorage.getItem('agent-current-session');
    if (savedSession) {
      this.currentSessionId = savedSession;
    }
    this.refreshSessionSelect();
    this.updateSessionDisplay(this.currentSessionId, 1);
    if (this.sseSource.setSession) {
      this.sseSource.setSession(this.currentSessionId);
    }

    // 斜杠命令识别与视觉反馈（Plan 17 B.1）
    this.dom.taskInput.addEventListener('input', () => {
      const val = this.dom.taskInput.value.trimStart();
      if (val.startsWith('/')) {
        this.dom.taskInput.classList.add('command-mode');
        this.dom.commandBadge.style.display = 'block';
      } else {
        this.dom.taskInput.classList.remove('command-mode');
        this.dom.commandBadge.style.display = 'none';
      }
    });

    // 发送
    this.dom.sendBtn.addEventListener('click', () => this.sendTask());
    this.dom.taskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendTask();
      }
    });

    // 停止
    this.dom.stopBtn.addEventListener('click', () => {
      this.activeSource.stop();
      this.planApprovalPending = false;
      this.setStatus('Stopped', 'warn');
      this.setRunningState(false);
    });

    // 清屏（保留当前 sessionId）
    this.dom.clearBtn.addEventListener('click', () => {
      this.activeSource.stop();
      this.planApprovalPending = false;
      this.dom.eventsList.innerHTML = '';
      this.toolCallCards.clear();
      this.dom.emptyState.style.display = 'flex';
      this.setStatus('Ready', 'info');
      this.setRunningState(false);
    });

    // 初始化默认剧本和任务提示
    this.mockSource.setScenario(this.dom.scenarioSelect.value);
    this.updateDefaultTaskPrompt(this.dom.scenarioSelect.value);
    this.setStatus('Ready (Mock Mode)', 'info');
  }

  // ── Session 下拉：持久化 + 切换 ──
  loadSessionList() {
    try {
      const list = JSON.parse(localStorage.getItem('agent-sessions'));
      return Array.isArray(list) && list.length > 0 ? list : [{ id: 'sess-default', label: 'Session 1' }];
    } catch {
      return [{ id: 'sess-default', label: 'Session 1' }];
    }
  }

  saveSessionList(list) {
    localStorage.setItem('agent-sessions', JSON.stringify(list));
  }

  refreshSessionSelect() {
    const list = this.loadSessionList();
    this.dom.sessionSelect.innerHTML = '';
    for (const s of list) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.label;
      this.dom.sessionSelect.appendChild(opt);
    }
    if (!list.some((s) => s.id === this.currentSessionId)) {
      const opt = document.createElement('option');
      opt.value = this.currentSessionId;
      opt.textContent = `Session ${list.length + 1}`;
      this.dom.sessionSelect.appendChild(opt);
      list.push({ id: this.currentSessionId, label: opt.textContent });
      this.saveSessionList(list);
    }
    this.dom.sessionSelect.value = this.currentSessionId;
    localStorage.setItem('agent-current-session', this.currentSessionId);
  }

  switchSession(id) {
    if (!id || id === this.currentSessionId) return;
    this.activeSource.stop();
    this.planApprovalPending = false;
    this.currentSessionId = id;
    this.currentTurn = 1;
    if (this.activeSource.setSession) {
      this.activeSource.setSession(id);
    }
    this.updateSessionDisplay(id, 1);
    this.dom.eventsList.innerHTML = '';
    this.toolCallCards.clear();
    this.dom.emptyState.style.display = 'flex';
    const label = this.loadSessionList().find((s) => s.id === id)?.label ?? id;
    this.setStatus(`Switched to ${label}`, 'info');
    this.setRunningState(false);
  }

  newSession() {
    this.activeSource.stop();
    this.planApprovalPending = false;
    this.currentSessionId = `sess-${Math.random().toString(36).substring(2, 9)}`;
    this.currentTurn = 1;
    this.updateSessionDisplay(this.currentSessionId, this.currentTurn);
    if (this.activeSource.setSession) {
      this.activeSource.setSession(this.currentSessionId);
    }
    this.dom.eventsList.innerHTML = '';
    this.toolCallCards.clear();
    this.dom.emptyState.style.display = 'flex';
    this.setStatus('New Session Ready', 'info');
    this.setRunningState(false);
    this.refreshSessionSelect();
  }

  updateSessionDisplay(sessionId, turn) {
    this.currentSessionId = sessionId;
    if (this.dom.sessionSelect && this.dom.sessionSelect.value !== sessionId) {
      this.refreshSessionSelect();
    }
    this.currentTurn = turn;
    if (this.dom.sessionIdDisplay) {
      this.dom.sessionIdDisplay.textContent = sessionId;
    }
    if (this.dom.sessionTurnDisplay) {
      this.dom.sessionTurnDisplay.textContent = `(Turn ${turn})`;
    }
  }

  updateDefaultTaskPrompt(scenario) {
    const prompts = {
      case1: '分析当前仓库的项目结构和核心依赖',
      case2: '写一个计算斐波那契数列的脚本并运行它',
      case3: '读取目标文件并在失败时自我纠错',
      session_case1: '创建 hello.ts 并随后在第二轮直接运行它 (连续会话记忆)',
      session_iso: '创建敏感凭据 secret-a.txt 演示会话隔离',
      soul_init: '/init Prefer TypeScript over Python; Always write modular code; Concise answers.',
      soul_effect: '帮我写一个工具类计数器脚本 (测试 Soul 偏好注入)',
      plan_approve: '/plan 为项目实现一个轻量命令行计算器 (Calculator CLI)',
      plan_reject: '/plan 全盘扫描并清理所有历史临时构建文件 (演示驳回无副作用)',
      plan_revise: '/plan 构建核心数据加密验证模块 (演示 Revise 修改建议重规划)',
      completion_gate: '创建 hello.py 并运行验证实际输出 (演示未达标被驳回)',
      early_stop_stall: '分析 build.log 错误并自适应排查 (演示连续重复早停熔断)',
      memory_consolidate: '整理核心代码并更新团队长期协作偏好 (演示记忆沉淀)',
    };
    if (prompts[scenario]) {
      this.dom.taskInput.value = prompts[scenario];
      this.dom.taskInput.dispatchEvent(new Event('input'));
    }
  }

  setStatus(text, type = 'info') {
    this.dom.statusBadge.textContent = text;
    this.dom.statusBadge.className = `status-badge ${type}`;
  }

  setRunningState(running) {
    this.dom.sendBtn.disabled = running;
    this.dom.taskInput.disabled = running;
    this.dom.stopBtn.disabled = !running;
    if (running) {
      this.setStatus('Running...', 'running');
    }
  }

  sendTask() {
    const text = this.dom.taskInput.value.trim();
    if (!text) return;

    this.dom.emptyState.style.display = 'none';
    this.setRunningState(true);
    this.activeSource.start(text, this.currentSessionId);
    this.dom.taskInput.value = ''; // 发送后清空输入栏（文本已捕获并交给 activeSource）
  }

  handleEvent(event) {
    this.dom.emptyState.style.display = 'none';

    switch (event.type) {
      // 基础事件
      case 'message':
        this.renderMessage(event);
        break;
      case 'tool_call':
        this.renderToolCall(event);
        break;
      case 'tool_result':
        this.renderToolResult(event);
        break;
      case 'ask':
        this.renderAsk(event);
        break;
      case 'done':
        this.renderDone(event);
        break;
      case 'error':
        this.renderError(event);
        break;

      // Phase 4 Step 1: Session 事件
      case 'session_start':
        this.renderSessionStart(event);
        break;
      case 'session_turn':
        this.renderSessionTurn(event);
        break;
      case 'session':
        this.updateSessionDisplay(event.sessionId, event.userTurns);
        break;

      // Phase 4 Step 2: Soul & Command
      case 'soul':
        this.renderSoul(event);
        break;
      case 'command':
        this.renderCommand(event);
        break;

      // Phase 4 Step 3: Plan & Goal
      case 'goal':
        this.renderGoal(event);
        break;
      case 'plan':
        this.renderPlan(event);
        break;

      // Phase 4 Step 4/5: Runtime Status
      case 'completion_check':
        this.renderCompletionCheck(event);
        break;
      case 'stall_warning':
        this.renderStallWarning(event);
        break;
      case 'early_stop':
        this.renderEarlyStop(event);
        break;

      default:
        // 红线 4: 未知事件不崩，向前兼容
        console.warn('Unknown event type received:', event);
        break;
    }

    // 自动平滑滚动至底部
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: 'smooth',
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 渲染函数：基础消息与工具
  // ─────────────────────────────────────────────────────────────

  renderMessage(event) {
    const card = document.createElement('div');
    card.className = `event-card message-card ${event.role}`;

    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = `
      <span class="role-badge ${event.role}">${event.role === 'user' ? '👤 User' : '🤖 Assistant'}</span>
      <span class="time">${new Date().toLocaleTimeString()}</span>
    `;

    const body = document.createElement('div');
    body.className = 'card-body text-content';
    body.innerText = event.content;

    card.appendChild(header);
    card.appendChild(body);
    this.dom.eventsList.appendChild(card);
  }

  renderToolCall(event) {
    const card = document.createElement('div');
    card.className = 'event-card tool-card';
    card.id = `tool-call-${event.id}`;

    // Plan 18 B.2: 批准前防御性检查——若未批准状态下出现 write/shell 副作用工具，UI 以红色异常警示
    const isSideEffect = ['write_file', 'shell'].includes(event.name);
    if (this.planApprovalPending && isSideEffect) {
      card.classList.add('illegal-side-effect-alert');
    }

    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = `
      <div class="tool-title">
        <span class="tool-icon">${isSideEffect ? '⚡' : '🛠️'}</span>
        <span class="tool-name">${event.name}</span>
        <span class="call-id">#${event.id}</span>
      </div>
      <span class="status-indicator loading">Executing...</span>
    `;

    const body = document.createElement('div');
    body.className = 'card-body';

    if (this.planApprovalPending && isSideEffect) {
      const alertMsg = document.createElement('div');
      alertMsg.style.color = '#fca5a5';
      alertMsg.style.fontSize = '12px';
      alertMsg.style.fontWeight = 'bold';
      alertMsg.style.marginBottom = '6px';
      alertMsg.textContent = '⚠️ 警告: 计划审批尚未通过，出现未授权副作用工具调用！';
      body.appendChild(alertMsg);
    }

    const argsView = document.createElement('pre');
    argsView.className = 'code-block';
    argsView.textContent = typeof event.args === 'string' ? event.args : JSON.stringify(event.args, null, 2);

    body.appendChild(argsView);
    card.appendChild(header);
    card.appendChild(body);

    this.dom.eventsList.appendChild(card);
    this.toolCallCards.set(event.id, card);
  }

  renderToolResult(event) {
    let parentCard = this.toolCallCards.get(event.id);

    if (parentCard) {
      const indicator = parentCard.querySelector('.status-indicator');
      if (indicator) {
        indicator.textContent = event.ok ? 'Success' : 'Failed';
        indicator.className = `status-indicator ${event.ok ? 'success' : 'failed'}`;
      }

      const resultBox = document.createElement('div');
      resultBox.className = `tool-result-box ${event.ok ? 'success' : 'failed'}`;

      const toggleBar = document.createElement('div');
      toggleBar.className = 'toggle-bar';
      toggleBar.innerHTML = `
        <span>Output Result</span>
        <button class="toggle-btn">收起 / 展开</button>
      `;

      const resultText = document.createElement('pre');
      resultText.className = 'code-block result-code';
      resultText.textContent = event.result;

      toggleBar.querySelector('.toggle-btn').addEventListener('click', () => {
        resultText.classList.toggle('collapsed');
      });

      resultBox.appendChild(toggleBar);
      resultBox.appendChild(resultText);
      parentCard.querySelector('.card-body').appendChild(resultBox);
    } else {
      const card = document.createElement('div');
      card.className = `event-card tool-result-card ${event.ok ? 'success' : 'failed'}`;
      card.innerHTML = `
        <div class="card-header">
          <span class="tool-name">Tool Result: ${event.name}</span>
          <span class="status-indicator ${event.ok ? 'success' : 'failed'}">${event.ok ? 'OK' : 'Error'}</span>
        </div>
        <div class="card-body">
          <pre class="code-block">${event.result}</pre>
        </div>
      `;
      this.dom.eventsList.appendChild(card);
    }
  }

  renderAsk(event) {
    const card = document.createElement('div');
    card.className = 'event-card ask-card';
    card.id = `ask-${event.id}`;

    const isPerm = event.kind === 'permission';
    const isPlanApproval = event.kind === 'plan_approval';

    let badgeText = 'Agent Question';
    let badgeClass = 'user';
    let icon = '❓';

    if (isPerm) {
      badgeText = 'Permission Request';
      badgeClass = 'permission';
      icon = '🛡️';
    } else if (isPlanApproval) {
      badgeText = 'Plan Approval Gate';
      badgeClass = 'plan_approval';
      icon = '📋';
    }

    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = `
      <div class="ask-title">
        <span class="ask-icon">${icon}</span>
        <span class="ask-badge ${badgeClass}">${badgeText}</span>
      </div>
      <span class="time">Waiting for user input</span>
    `;

    const body = document.createElement('div');
    body.className = 'card-body';

    const questionP = document.createElement('p');
    questionP.className = 'ask-question';
    questionP.textContent = event.question;
    body.appendChild(questionP);

    const form = document.createElement('div');
    form.className = 'ask-form';

    // ── Phase 4 Step 3: Plan 审批 Gate (Approve / Reject / Revise) ──
    if (isPlanApproval) {
      const approveBtn = document.createElement('button');
      approveBtn.className = 'btn btn-primary';
      approveBtn.textContent = '✓ Approve (批准执行)';

      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'btn btn-danger';
      rejectBtn.textContent = '✗ Reject (驳回放弃)';

      const reviseBtn = document.createElement('button');
      reviseBtn.className = 'btn btn-warning';
      reviseBtn.textContent = '✏️ Revise (提出修改意见)';

      const reviseInputContainer = document.createElement('div');
      reviseInputContainer.style.display = 'none';
      reviseInputContainer.style.width = '100%';
      reviseInputContainer.style.marginTop = '10px';

      const reviseInput = document.createElement('input');
      reviseInput.type = 'text';
      reviseInput.className = 'input-field';
      reviseInput.placeholder = '输入修改建议，如：请添加严格参数校验与单元测试...';

      const submitReviseBtn = document.createElement('button');
      submitReviseBtn.className = 'btn btn-warning';
      submitReviseBtn.textContent = '提交修改建议';
      submitReviseBtn.style.marginLeft = '8px';

      reviseInputContainer.appendChild(reviseInput);
      reviseInputContainer.appendChild(submitReviseBtn);

      const disableAll = () => {
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        reviseBtn.disabled = true;
        reviseInputContainer.style.display = 'none';
      };

      approveBtn.addEventListener('click', () => {
        disableAll();
        this.planApprovalPending = false;
        form.innerHTML = '<span class="reply-tag approved">✓ 计划已批准执行 (Side-effects unblocked)</span>';
        this.setStatus('Plan Approved — Running...', 'running');
        this.activeSource.reply({
          type: 'plan_decision',
          id: event.id,
          decision: 'approve',
        });
      });

      rejectBtn.addEventListener('click', () => {
        disableAll();
        this.planApprovalPending = false;
        form.innerHTML = '<span class="reply-tag rejected">✗ 计划已驳回 (No changes made)</span>';
        this.setStatus('Plan Rejected', 'warn');
        this.activeSource.reply({
          type: 'plan_decision',
          id: event.id,
          decision: 'reject',
        });
      });

      reviseBtn.addEventListener('click', () => {
        reviseInputContainer.style.display = 'flex';
        reviseInput.focus();
      });

      submitReviseBtn.addEventListener('click', () => {
        const note = reviseInput.value.trim();
        if (!note) return;
        disableAll();
        this.planApprovalPending = false;
        form.innerHTML = `<span class="reply-tag revised">✏️ 已提交修改建议: ${note}</span>`;
        this.setStatus('Plan Revising...', 'running');
        this.activeSource.reply({
          type: 'plan_decision',
          id: event.id,
          decision: 'revise',
          note,
        });
      });

      form.appendChild(approveBtn);
      form.appendChild(rejectBtn);
      form.appendChild(reviseBtn);
      form.appendChild(reviseInputContainer);
    } else if (isPerm) {
      // 传统权限审批
      const approveBtn = document.createElement('button');
      approveBtn.className = 'btn btn-primary';
      approveBtn.textContent = 'Approve (批准执行)';

      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'btn btn-danger';
      rejectBtn.textContent = 'Reject (拒绝)';

      const handleApprove = (approved) => {
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        form.innerHTML = `<span class="reply-tag ${approved ? 'approved' : 'rejected'}">${approved ? '✓ 已批准执行' : '✗ 已拒绝'}</span>`;
        this.activeSource.reply({
          type: 'approve',
          id: event.id,
          approved,
        });
      };

      approveBtn.addEventListener('click', () => handleApprove(true));
      rejectBtn.addEventListener('click', () => handleApprove(false));

      form.appendChild(approveBtn);
      form.appendChild(rejectBtn);
    } else {
      // 文本问答输入框
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'input-field';
      input.placeholder = '输入您的回复...';

      const submitBtn = document.createElement('button');
      submitBtn.className = 'btn btn-primary';
      submitBtn.textContent = '提交回答';

      const handleSubmit = () => {
        const val = input.value.trim();
        if (!val) return;
        input.disabled = true;
        submitBtn.disabled = true;
        form.innerHTML = `<span class="reply-tag answered">已提交: ${val}</span>`;
        this.activeSource.reply({
          type: 'answer',
          id: event.id,
          value: val,
        });
      };

      submitBtn.addEventListener('click', handleSubmit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSubmit();
        }
      });

      form.appendChild(input);
      form.appendChild(submitBtn);
      setTimeout(() => input.focus(), 50);
    }

    body.appendChild(form);
    card.appendChild(header);
    card.appendChild(body);
    this.dom.eventsList.appendChild(card);
  }

  renderDone(event) {
    const card = document.createElement('div');
    card.className = 'event-card done-card';

    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = `
      <div class="done-title">
        <span class="done-icon">🏁</span>
        <span class="done-badge">Completed</span>
      </div>
      <span class="time">${new Date().toLocaleTimeString()}</span>
    `;

    const body = document.createElement('div');
    body.className = 'card-body text-content';
    body.innerText = event.text;

    card.appendChild(header);
    card.appendChild(body);
    this.dom.eventsList.appendChild(card);

    this.planApprovalPending = false;
    this.setStatus('Done', 'success');
    this.setRunningState(false);
  }

  renderError(event) {
    const card = document.createElement('div');
    card.className = 'event-card error-card';
    card.innerHTML = `
      <div class="card-header">
        <span class="error-badge">⚠️ Error</span>
        <span class="time">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="card-body">
        <p class="error-text">${event.message}</p>
      </div>
    `;
    this.dom.eventsList.appendChild(card);
    this.planApprovalPending = false;
    this.setStatus('Error occurred', 'danger');
    this.setRunningState(false);
  }

  // ─────────────────────────────────────────────────────────────
  // Phase 4 Step 1: Session 渲染
  // ─────────────────────────────────────────────────────────────

  renderSessionStart(event) {
    this.updateSessionDisplay(event.sessionId, 1);
    const divider = document.createElement('div');
    divider.className = 'turn-divider';
    divider.innerHTML = `<span>Session Started: ${event.sessionId} ${event.title ? `(${event.title})` : ''}</span>`;
    this.dom.eventsList.appendChild(divider);
    this.setStatus(`Session Active (${event.sessionId})`, 'info');
  }

  renderSessionTurn(event) {
    this.updateSessionDisplay(event.sessionId, event.turn);
    const divider = document.createElement('div');
    divider.className = 'turn-divider';
    divider.innerHTML = `<span>Turn ${event.turn} (Session: ${event.sessionId})</span>`;
    this.dom.eventsList.appendChild(divider);
  }

  // ─────────────────────────────────────────────────────────────
  // Phase 4 Step 2: Soul & Command 渲染
  // ─────────────────────────────────────────────────────────────

  renderSoul(event) {
    if (this.dom.soulSummary) {
      this.dom.soulSummary.textContent = event.summary;
      this.dom.soulSummary.title = event.summary;
    }

    if (this.dom.soulBar) {
      this.dom.soulBar.classList.remove('updated-flash');
      // 触发重绘动画
      void this.dom.soulBar.offsetWidth;
      this.dom.soulBar.classList.add('updated-flash');
    }

    // 事件流中插入轻量提示卡片
    const card = document.createElement('div');
    card.className = 'event-card soul-toast-card';
    card.innerHTML = `
      <div class="card-header">
        <span>🧠 Soul / Memory [${event.action.toUpperCase()}]</span>
        <span class="time">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="card-body">
        <p style="font-size: 13px; font-weight: 500;">${event.summary}</p>
      </div>
    `;
    this.dom.eventsList.appendChild(card);
  }

  renderCommand(event) {
    const card = document.createElement('div');
    card.className = 'event-card command-card';
    card.innerHTML = `
      <div class="card-header">
        <span class="command-title">⚡ Command: /${event.command}</span>
        <span class="status-indicator ${event.accepted ? 'success' : 'failed'}">${event.accepted ? 'Accepted' : 'Rejected'}</span>
      </div>
      <div class="card-body">
        <p style="font-size: 13px; color: #cbd5e1;">${event.note || `Command /${event.command} executed.`}</p>
      </div>
    `;
    this.dom.eventsList.appendChild(card);
  }

  // ─────────────────────────────────────────────────────────────
  // Phase 4 Step 3: Goal & Plan 渲染
  // ─────────────────────────────────────────────────────────────

  renderGoal(event) {
    const card = document.createElement('div');
    card.className = 'event-card goal-card';

    let criteriaHtml = '';
    if (event.acceptanceCriteria && event.acceptanceCriteria.length > 0) {
      criteriaHtml = `
        <ul class="goal-criteria-list">
          ${event.acceptanceCriteria.map((item) => `
            <li class="goal-criteria-item">
              <span class="goal-check-icon">☑</span>
              <span>${item}</span>
            </li>
          `).join('')}
        </ul>
      `;
    }

    card.innerHTML = `
      <div class="card-header">
        <span class="goal-title">🎯 Structured Goal (目标与验收标准)</span>
        <span class="time">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="card-body">
        <p style="font-size: 14px; font-weight: 600; color: #f8fafc; margin-bottom: 8px;">
          ${event.description}
        </p>
        ${criteriaHtml}
      </div>
    `;
    this.dom.eventsList.appendChild(card);
  }

  renderPlan(event) {
    const card = document.createElement('div');
    card.className = 'event-card plan-card';

    // 状态样式映射
    let statusClass = 'plan-status-proposed';
    let statusText = 'Proposed (待审批)';
    if (event.status === 'approved') {
      statusClass = 'plan-status-approved';
      statusText = 'Approved (已批准)';
      this.planApprovalPending = false;
    } else if (event.status === 'rejected') {
      statusClass = 'plan-status-rejected';
      statusText = 'Rejected (已驳回)';
      this.planApprovalPending = false;
    } else if (event.status === 'revised') {
      statusClass = 'plan-status-revised';
      statusText = 'Revised (已根据修改意见重构)';
      this.planApprovalPending = true;
    } else if (event.status === 'proposed') {
      this.planApprovalPending = true;
      this.setStatus('Plan Pending Approval', 'warn');
    }

    let frozenWarningHtml = '';
    if (event.status === 'proposed' || event.status === 'revised') {
      frozenWarningHtml = `
        <div class="plan-frozen-warning">
          <span>🔒 Plan pending approval — 副作用工具已冻结 (write_file / shell 禁止执行)</span>
        </div>
      `;
    }

    let stepsHtml = '';
    if (event.steps && event.steps.length > 0) {
      stepsHtml = `
        <ol class="plan-steps-list">
          ${event.steps.map((step) => `<li>${step}</li>`).join('')}
        </ol>
      `;
    }

    let risksHtml = '';
    if (event.risks && event.risks.length > 0) {
      risksHtml = `
        <div class="plan-risks-box">
          <strong>⚠️ 潜在风险 (Identified Risks):</strong>
          <ul style="margin-top: 4px; padding-left: 18px;">
            ${event.risks.map((r) => `<li>${r}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-header">
        <span style="font-weight: 700; color: #93c5fd;">📝 Execution Plan (执行计划)</span>
        <span class="plan-header-status ${statusClass}">${statusText}</span>
      </div>
      <div class="card-body">
        ${frozenWarningHtml}
        ${stepsHtml}
        ${risksHtml}
      </div>
    `;
    this.dom.eventsList.appendChild(card);
  }

  // ─────────────────────────────────────────────────────────────
  // Phase 4 Step 4/5/6: Runtime Status (Completion, Stall, Early Stop)
  // ─────────────────────────────────────────────────────────────

  renderCompletionCheck(event) {
    const card = document.createElement('div');
    const isVerified = event.complete;
    card.className = `event-card completion-card ${isVerified ? 'verified' : ''}`;

    let remainingHtml = '';
    if (event.remaining && event.remaining.length > 0) {
      remainingHtml = `
        <div style="margin-top: 8px;">
          <strong style="font-size: 12px; color: #fde68a;">待完成项 (Remaining tasks):</strong>
          <ul style="padding-left: 18px; margin-top: 4px; font-size: 13px; color: #e2e8f0;">
            ${event.remaining.map((item) => `<li>${item}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-header">
        <span style="font-weight: 700; color: ${isVerified ? 'var(--accent-emerald)' : 'var(--accent-amber)'};">
          ${isVerified ? '✅ Completion Verified' : '⏳ Completion Check Incomplete'} (Check #${event.attempt})
        </span>
        <span class="status-indicator ${isVerified ? 'success' : 'loading'}">
          ${isVerified ? 'Verified' : 'Continuing Execution...'}
        </span>
      </div>
      <div class="card-body">
        <p style="font-size: 13px; color: #cbd5e1;">
          ${event.reason || (isVerified ? '所有验收标准已满足，通过 Completion Gate 检验。' : '未满足验收条件，Agent 将自动继续执行补做剩余工作。')}
        </p>
        ${remainingHtml}
      </div>
    `;
    this.dom.eventsList.appendChild(card);

    if (!isVerified) {
      this.setStatus(`Completion Check #${event.attempt} Failed — Continuing`, 'running');
    }
  }

  renderStallWarning(event) {
    const card = document.createElement('div');
    card.className = 'event-card stall-warning-card';
    card.innerHTML = `
      <div class="card-header">
        <span style="font-weight: 700; color: #fde68a;">⚠️ Stall Warning (检测到重复动作)</span>
        <span class="time">Round ${event.round}</span>
      </div>
      <div class="card-body">
        <p style="font-size: 13px;">连续检测到无状态推进的重复动作。正在尝试重新评估并自适应纠偏，请留意后续操作...</p>
      </div>
    `;
    this.dom.eventsList.appendChild(card);
    this.setStatus('Stall Warning — Monitoring...', 'warn');
  }

  renderEarlyStop(event) {
    const card = document.createElement('div');
    card.className = 'event-card early-stop-card';
    card.innerHTML = `
      <div class="card-header">
        <span style="font-weight: 700; color: #fca5a5;">🛑 Early Stop (运行时早停熔断)</span>
        <span class="status-indicator failed">stopReason: ${event.stopReason}</span>
      </div>
      <div class="card-body">
        <p style="font-size: 14px; color: #fecaca; margin-bottom: 6px;">
          ${event.detail || `流程在触发 ${event.stopReason} 保护机制后已提前安全终止。`}
        </p>
        <span style="font-size: 11px; color: #94a3b8;">已恢复输入，您可调整任务提示或新建会话重试。</span>
      </div>
    `;
    this.dom.eventsList.appendChild(card);

    this.planApprovalPending = false;
    this.setStatus(`Early Stop (${event.stopReason})`, 'danger');
    this.setRunningState(false);
  }
}

// 页面加载完成后启动应用
window.addEventListener('DOMContentLoaded', () => {
  new WebApp();
});
