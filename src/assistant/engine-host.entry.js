import {
  CreateWebWorkerMLCEngine,
  hasModelInCache,
  prebuiltAppConfig
} from "@mlc-ai/web-llm";

const PRIMARY_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
const COMPATIBILITY_MODEL = "Llama-3.2-1B-Instruct-q4f32_1-MLC";
const appConfig = { ...prebuiltAppConfig, cacheBackend: "indexeddb" };
const CONTEXT_WINDOW_ERROR_PATTERN = /ContextWindowSizeExceeded|prompt tokens exceed context window|context window size/i;
const RETRY_PROMPT_BUDGETS = Object.freeze([6000, 3000]);

let engine = null;
let enginePromise = null;
let activeRequestId = "";

function emit(type, detail = {}) {
  window.minovaAssistantEngine.emit({ type, ...detail });
}

function normalizeProgress(report = {}) {
  const progress = Math.max(0, Math.min(1, Number(report.progress) || 0));
  return {
    progress,
    text: String(report.text || (progress < 1 ? "Preparing local model" : "Local model ready")),
    elapsedSeconds: Math.max(0, Number(report.timeElapsed) || 0)
  };
}

async function selectModel() {
  if (!navigator.gpu) {
    throw new Error("WebGPU is unavailable. Update your graphics driver and enable hardware acceleration in Minova.");
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    throw new Error("Minova could not access a WebGPU adapter. Check that hardware acceleration is enabled.");
  }

  const supportsShaderF16 = adapter.features?.has("shader-f16") === true;
  return {
    adapter,
    modelId: supportsShaderF16 ? PRIMARY_MODEL : COMPATIBILITY_MODEL,
    supportsShaderF16
  };
}

async function createMockEngine() {
  await new Promise((resolve) => setTimeout(resolve, 35));
  return {
    modelId: [PRIMARY_MODEL],
    async getGPUVendor() { return "Minova Test GPU"; },
    interruptGenerate() {},
    chat: {
      completions: {
        async create(options = {}) {
          const promptCharacters = (Array.isArray(options.messages) ? options.messages : [])
            .reduce((total, message) => total + String(message?.content || "").length, 0);
          if (promptCharacters > 7000) {
            const error = new Error("Prompt tokens exceed context window size");
            error.name = "ContextWindowSizeExceededError";
            throw error;
          }
          return (async function* streamMockReply() {
            for (const token of ["Minova ", "local AI ", "is ready."]) {
              await new Promise((resolve) => setTimeout(resolve, 12));
              yield { choices: [{ delta: { content: token } }] };
            }
          })();
        }
      }
    }
  };
}

function truncatePromptContent(value, limit) {
  const text = String(value || "");
  if (text.length <= limit) return text;
  const marker = "\n\n[Earlier reference shortened to fit the local model]\n\n";
  const available = Math.max(0, limit - marker.length);
  const headLength = Math.ceil(available * 0.82);
  return `${text.slice(0, headLength)}${marker}${text.slice(-(available - headLength))}`;
}

function compactMessagesForContextWindow(rawMessages, characterBudget) {
  const source = (Array.isArray(rawMessages) ? rawMessages : [])
    .map((message) => ({
      role: message?.role === "system" ? "system" : message?.role === "assistant" ? "assistant" : "user",
      content: String(message?.content || "").trim()
    }))
    .filter((message) => message.content);
  if (!source.length) return [];

  const system = source.find((message) => message.role === "system");
  const body = source.filter((message) => message !== system);
  const systemContent = truncatePromptContent(system?.content || "You are Minova Assistant.", Math.min(700, characterBudget));
  let remaining = Math.max(256, characterBudget - systemContent.length);
  const compactedBody = [];
  const pageGrounded = /webpage reference|supplied webpage/i.test(systemContent);

  if (pageGrounded && body.length) {
    const context = body[0];
    const latest = body.at(-1);
    const latestBudget = body.length > 1 ? Math.min(1400, Math.floor(remaining * 0.32)) : remaining;
    const contextBudget = body.length > 1 ? remaining - latestBudget : remaining;
    compactedBody.push({ ...context, content: truncatePromptContent(context.content, contextBudget) });
    remaining -= compactedBody[0].content.length;
    if (latest !== context && remaining > 0) {
      compactedBody.push({ ...latest, content: truncatePromptContent(latest.content, remaining) });
    }
  } else {
    for (let index = body.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const content = truncatePromptContent(body[index].content, remaining);
      compactedBody.unshift({ ...body[index], content });
      remaining -= content.length;
    }
  }

  return [{ role: "system", content: systemContent }, ...compactedBody];
}

async function streamCompletion(localEngine, command, messages, onDelta) {
  const response = await localEngine.chat.completions.create({
    messages,
    stream: true,
    temperature: Number(command.temperature) || 0.25,
    top_p: 0.9,
    max_tokens: Math.max(64, Math.min(768, Number(command.maxTokens) || 512))
  });
  for await (const chunk of response) {
    const delta = String(chunk?.choices?.[0]?.delta?.content || "");
    if (delta) onDelta(delta);
  }
}

async function ensureEngine() {
  if (engine) return engine;
  if (enginePromise) return enginePromise;

  enginePromise = (async () => {
    if (window.minovaAssistantEngine.testMode) {
      emit("progress", { progress: 0.5, text: "Preparing test model", cached: true, modelId: PRIMARY_MODEL });
      engine = await createMockEngine();
      emit("ready", { modelId: PRIMARY_MODEL, cached: true, gpuVendor: "Minova Test GPU", compatibilityMode: false });
      return engine;
    }

    const selection = await selectModel();
    const cached = await hasModelInCache(selection.modelId, appConfig).catch(() => false);
    emit("progress", {
      progress: 0,
      text: cached ? "Loading local model" : "Downloading local model",
      cached,
      modelId: selection.modelId
    });

    const worker = new Worker(new URL("./engine-worker.js", import.meta.url), {
      type: "module",
      name: "minova-webllm-engine"
    });
    engine = await CreateWebWorkerMLCEngine(worker, selection.modelId, {
      appConfig,
      initProgressCallback(report) {
        emit("progress", {
          ...normalizeProgress(report),
          cached,
          modelId: selection.modelId
        });
      }
    });

    const gpuVendor = await engine.getGPUVendor().catch(() => "WebGPU");
    emit("ready", {
      modelId: selection.modelId,
      cached: true,
      gpuVendor,
      compatibilityMode: !selection.supportsShaderF16
    });
    return engine;
  })().catch((error) => {
    engine = null;
    enginePromise = null;
    emit("engine-error", { message: error?.message || String(error) });
    throw error;
  });

  return enginePromise;
}

async function runChat(command) {
  const requestId = String(command.requestId || "");
  if (!requestId) return;
  if (activeRequestId) {
    emit("request-error", { requestId, message: "Minova Assistant is already answering another request." });
    return;
  }

  activeRequestId = requestId;
  try {
    const localEngine = await ensureEngine();
    const originalMessages = Array.isArray(command.messages) ? command.messages : [];
    const candidates = [originalMessages, ...RETRY_PROMPT_BUDGETS.map((budget) => compactMessagesForContextWindow(originalMessages, budget))];
    let emittedCharacters = 0;
    let completed = false;
    let lastError = null;

    for (let attempt = 0; attempt < candidates.length; attempt += 1) {
      try {
        await streamCompletion(localEngine, command, candidates[attempt], (delta) => {
          emittedCharacters += delta.length;
          emit("chunk", { requestId, delta });
        });
        completed = true;
        break;
      } catch (error) {
        lastError = error;
        const canCompact = emittedCharacters === 0
          && CONTEXT_WINDOW_ERROR_PATTERN.test(`${error?.name || ""} ${error?.message || error || ""}`)
          && attempt < candidates.length - 1;
        if (!canCompact) throw error;
      }
    }
    if (!completed) throw lastError || new Error("The local AI could not fit this request into its context window.");
    emit("request-done", { requestId });
  } catch (error) {
    const contextError = CONTEXT_WINDOW_ERROR_PATTERN.test(`${error?.name || ""} ${error?.message || error || ""}`);
    emit("request-error", {
      requestId,
      message: contextError
        ? "This page is unusually token-dense. Select a smaller passage and use Explain selection."
        : error?.message || String(error)
    });
  } finally {
    if (activeRequestId === requestId) activeRequestId = "";
  }
}

window.minovaAssistantEngine.onCommand((command = {}) => {
  if (command.type === "initialize") {
    ensureEngine().catch(() => {});
    return;
  }
  if (command.type === "chat") {
    runChat(command);
    return;
  }
  if (command.type === "cancel" && String(command.requestId || "") === activeRequestId) {
    engine?.interruptGenerate();
  }
});

emit("host-ready", { webgpu: Boolean(navigator.gpu) });
