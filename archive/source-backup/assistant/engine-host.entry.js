import {
  CreateWebWorkerMLCEngine,
  hasModelInCache,
  prebuiltAppConfig
} from "@mlc-ai/web-llm";

const PRIMARY_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
const COMPATIBILITY_MODEL = "Llama-3.2-1B-Instruct-q4f32_1-MLC";
const appConfig = { ...prebuiltAppConfig, cacheBackend: "indexeddb" };

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
        async create() {
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
    const response = await localEngine.chat.completions.create({
      messages: Array.isArray(command.messages) ? command.messages : [],
      stream: true,
      temperature: Number(command.temperature) || 0.25,
      top_p: 0.9,
      max_tokens: Math.max(64, Math.min(768, Number(command.maxTokens) || 512))
    });

    for await (const chunk of response) {
      const delta = String(chunk?.choices?.[0]?.delta?.content || "");
      if (delta) emit("chunk", { requestId, delta });
    }
    emit("request-done", { requestId });
  } catch (error) {
    emit("request-error", { requestId, message: error?.message || String(error) });
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

