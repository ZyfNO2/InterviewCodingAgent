# LLM 接入配置

本文件固定测试期的 LLM 接入信息与 `.env` 约定，供各阶段实现引用。

---

## A. 端点与密钥（测试环境）

```text
BASE_URL : http://127.0.0.1:8045/v1
API_KEY  : sk-d53238016e6c4b9a8107e0fa94c799a1
```

- 该端点为本地 OpenAI-compatible 服务，走标准 `/v1/chat/completions` + function calling。
- 密钥为测试用途，仅写入本地 `.env`，`.env` 必须加入 `.gitignore`，仓库只提交 `.env.example`（占位值）。

---

## B. 模型选择

用户指定测试模型为 “gemini 3.8 flash”。经 `GET /v1/models` 核对，端点未暴露裸名 `gemini-3.8-flash`，仅有带档位的变体：

```text
gemini-3.8-flash-high
gemini-3.8-flash-medium
gemini-3.8-flash-low
gemini-3.8-flash-tiered
```

约定（可用 `.env` 覆盖）：

```text
默认 OPENAI_MODEL = gemini-3.8-flash-medium
```

- 选 `medium` 作为质量/延迟折中；如需更强推理改 `-high`，更省改 `-low`。
- 若后续端点提供裸名 `gemini-3.8-flash`，直接改 `.env` 即可，无需改代码。

---

## C. `.env` 约定

实际 `.env`（本地、不入库）：

```dotenv
OPENAI_API_KEY=sk-d53238016e6c4b9a8107e0fa94c799a1
OPENAI_BASE_URL=http://127.0.0.1:8045/v1
OPENAI_MODEL=gemini-3.8-flash-medium
```

`.env.example`（入库、占位）：

```dotenv
OPENAI_API_KEY=sk-your-key-here
OPENAI_BASE_URL=http://127.0.0.1:8045/v1
OPENAI_MODEL=gemini-3.8-flash-medium
```

---

## D. Provider 读取契约

- `llm/provider.ts` 从环境变量读取上述三项；缺失 `OPENAI_API_KEY` 时启动即报明确错误。
- 兼容性假设：目标端点支持 OpenAI `tools` / `tool_calls` 字段。若某模型不支持并行工具调用，Agent 仍需能处理单个 tool call 的顺序执行（阶段二 Parallel 为增强项，非依赖）。
- 验证阶段一 Case 前，先用一次最小 `chat` 请求确认端点连通与模型可用（冒烟检查）。

---

## E. 安全说明

- 该 BASE_URL 为本地地址，不对公网暴露。
- 密钥不硬编码进源码、不写入 README、不打印到日志。
- 提交前检查 `git status` 确认 `.env` 未被跟踪。
