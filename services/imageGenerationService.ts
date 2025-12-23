
import { GenerationMode } from "../types";

const KIE_API_JOBS_BASE = "https://api.kie.ai/api/v1/jobs";
const CREATE_TASK_URL = `${KIE_API_JOBS_BASE}/createTask`;

const getApiKeyFromEnv = () => {
  const key = process.env.KIE_API_KEY || process.env.API_KEY;
  return (key && key !== 'undefined') ? key : null;
};

/**
 * Опрашивает сервер о статусе задачи.
 * @returns Массив ссылок на готовые изображения.
 */
export const monitorTaskProgress = async (taskId: string): Promise<string[]> => {
  const apiKey = getApiKeyFromEnv();
  const maxAttempts = 120;
  let attempts = 0;
  const statusUrl = `${KIE_API_JOBS_BASE}/recordInfo?taskId=${taskId}`;

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(statusUrl, {
        method: 'GET',
        headers: { 
          "Authorization": `Bearer ${apiKey}`,
          "Cache-Control": "no-cache" 
        }
      });

      if (!response.ok) {
        attempts++;
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const raw = await response.json();
      if (raw.code !== 200 || !raw.data) {
        attempts++;
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const result = raw.data;
      const state = (result.state || "").toLowerCase();
      
      if (state === "success" || state === "completed") {
        let urls: string[] = [];
        if (result.resultJson) {
          try {
            const parsed = typeof result.resultJson === 'string' ? JSON.parse(result.resultJson) : result.resultJson;
            if (parsed.resultUrls && Array.isArray(parsed.resultUrls)) urls = parsed.resultUrls;
          } catch (e) { console.warn("Parsing resultJson failed:", e); }
        }
        if (urls.length === 0) {
          const singleUrl = result.imageUrl || result.resultUrl || (result.result?.resultUrls ? result.result.resultUrls[0] : "");
          if (singleUrl) urls = [singleUrl];
        }
        if (urls.length > 0) return urls;
      }

      if (state === "fail" || state === "failed" || state === "error") {
        throw new Error(result.failMsg || "Generation failed on server");
      }
    } catch (e: any) {
      if (e.message.includes("failed")) throw e;
    }
    await new Promise(r => setTimeout(r, 5000));
    attempts++;
  }
  throw new Error("Polling timeout.");
};

/**
 * Запускает создание изображения.
 */
export const startImageGenerationTask = async (
  prompt: string, 
  faceUrls: string[], 
  aspectRatio: string = "1:1", 
  resolution: "Standard" | "1K" | "2K" | "4K" = "1K",
  mode: GenerationMode = GenerationMode.MATCH_STYLE,
  callbackUrl?: string
): Promise<string> => {
  const apiKey = getApiKeyFromEnv();
  if (!apiKey) throw new Error("API KEY missing");

  let payload: any;

  if (mode === GenerationMode.NSFC) {
    // SeeDream 4.5-edit logic (Uncensored with Image Reference)
    payload = {
      model: "seedream/4.5-edit",
      input: {
        prompt,
        image_urls: faceUrls, // Согласно документации используем image_urls
        aspect_ratio: aspectRatio,
        quality: resolution === "4K" ? "high" : "basic"
      }
    };
  } else {
    // Nano Banana logic
    const isPro = resolution !== "Standard";
    let inputPayload: any;

    if (isPro) {
      inputPayload = {
        prompt,
        aspect_ratio: aspectRatio,
        resolution: resolution,
        image_input: faceUrls,
        output_format: "png"
      };
    } else {
      inputPayload = {
        prompt,
        image_size: aspectRatio,
        image_urls: faceUrls,
        output_format: "png"
      };
    }

    payload = {
      model: isPro ? "nano-banana-pro" : "google/nano-banana-edit",
      input: inputPayload
    };
  }

  // Используем callback если домен настроен
  if (callbackUrl || window.location.hostname !== 'localhost') {
    payload.callBackUrl = callbackUrl || `https://${window.location.hostname}/api/callback`;
  }

  const res = await fetch(CREATE_TASK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  const taskId = data.data?.taskId || data.taskId;
  if (!taskId) throw new Error(data.message || "Failed to create task");
  return taskId;
};
