
const KIE_API_JOBS_BASE = "https://api.kie.ai/api/v1/jobs";
const CREATE_TASK_URL = `${KIE_API_JOBS_BASE}/createTask`;

const getApiKey = () => {
  const key = process.env.KIE_API_KEY || process.env.API_KEY;
  return (key && key !== 'undefined') ? key : null;
};

export const pollTaskStatus = async (taskId: string): Promise<string> => {
  const apiKey = getApiKey();
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
        let foundUrl = "";
        if (result.resultJson) {
          try {
            const parsed = typeof result.resultJson === 'string' 
              ? JSON.parse(result.resultJson) 
              : result.resultJson;
              
            if (parsed.resultUrls && parsed.resultUrls[0]) {
              foundUrl = parsed.resultUrls[0];
            }
          } catch (e) {
            console.warn("Error parsing resultJson:", e);
          }
        }
        if (!foundUrl) foundUrl = result.imageUrl || result.resultUrl || (result.result?.resultUrls ? result.result.resultUrls[0] : "");
        if (foundUrl) return foundUrl;
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

export const createTask = async (
  prompt: string, 
  faceUrls: string[], 
  aspectRatio: string = "1:1", 
  usePro: boolean = false,
  callbackUrl?: string
): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API KEY missing");

  // Для Pro модели используем nano-banana-pro и специфичные поля
  const payload: any = {
    model: usePro ? "nano-banana-pro" : "google/nano-banana-edit",
    input: usePro ? {
      prompt,
      aspect_ratio: aspectRatio,
      resolution: "1K",
      output_format: "png"
      // Если Pro версия поддерживает лица, можно добавить image_urls: faceUrls
    } : {
      prompt,
      image_urls: faceUrls,
      output_format: "png",
      image_size: aspectRatio
    }
  };

  // Попробуем отправить лица в Pro тоже, если они есть
  if (usePro && faceUrls.length > 0) {
    payload.input.image_urls = faceUrls;
  }

  if (callbackUrl) payload.callBackUrl = callbackUrl;

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
