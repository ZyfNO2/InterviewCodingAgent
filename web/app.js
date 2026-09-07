import { mockScenarios } from './mock.js';
import { MockEventSource, SseEventSource } from './transport.js';

class WebApp {
  constructor() {
    this.sourceMode = 'mock'; // 'mock' | 'sse'
    this.mockSource = new MockEventSource(mockScenarios, 650);
    this.sseSource = new SseEventSource('');
    this.activeSource = this.mockSource;

    this.toolCallCards = new Map(); // id -> element

    this.dom = {
      sourceModeSelect: document.getElementById('source-mode'),
      scenarioSelect: document.getElementById('scenario-select'),
      scenarioContainer: document.getElementById('scenario-container'),
      backendUrlInput: document.getElementById('backend-url-container'),
      taskInput: document.getElementById('task-input'),
      sendBtn: document.getElementById('send-btn'),
      stopBtn: document.getElementById('stop-btn'),
      clearBtn: document.getElementById('clear-btn'),
      eventsList: document.getElementById('events-list'),
      statusBadge: document.getElementById('status-badge'),
      emptyState: document.getElementById('empty-state'),
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
      this.setStatus('Stopped', 'warn');
      this.setRunningState(false);
    });

    // 清屏
    this.dom.clearBtn.addEventListener('click', () => {
      this.activeSource.stop();
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

  updateDefaultTaskPrompt(scenario) {
    if (scenario === 'case1') {
      this.dom.taskInput.value = '分析当前仓库的项目结构和核心依赖';
    } else if (scenario === 'case2') {
      this.dom.taskInput.value = '写一个计算斐波那契数列的脚本并运行它';
    } else if (scenario === 'case3') {
      this.dom.taskInput.value = '读取目标文件并在失败时自我纠错';
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
    this.activeSource.start(text);
  }

  handleEvent(event) {
    this.dom.emptyState.style.display = 'none';

    switch (event.type) {
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
    }

    // 自动滚动至底部
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: 'smooth',
    });
  }

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

    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = `
      <div class="tool-title">
        <span class="tool-icon">🛠️</span>
        <span class="tool-name">${event.name}</span>
        <span class="call-id">#${event.id}</span>
      </div>
      <span class="status-indicator loading">Executing...</span>
    `;

    const body = document.createElement('div');
    body.className = 'card-body';

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
      // 在原有的 tool_call 卡片上更新状态
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
      // 独立兜底渲染
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

    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = `
      <div class="ask-title">
        <span class="ask-icon">${isPerm ? '🛡️' : '❓'}</span>
        <span class="ask-badge ${isPerm ? 'permission' : 'user'}">${isPerm ? 'Permission Request' : 'Agent Question'}</span>
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

    if (isPerm) {
      // Approve / Reject 按钮
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
      // 文本输入框 + 确认按钮
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
    this.setStatus('Error occurred', 'danger');
    this.setRunningState(false);
  }
}

// 页面加载完成后启动应用
window.addEventListener('DOMContentLoaded', () => {
  new WebApp();
});
