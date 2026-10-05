import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

// WebLLM keeps model execution in this dedicated worker. The hidden engine
// window owns only the IPC bridge and never receives browser credentials.
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (event) => handler.onmessage(event);

