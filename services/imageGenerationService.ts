
const KIE_API_JOBS_BASE = "https://api.kie.ai/api/v1/jobs";
const CREATE_TASK_URL = `${KIE_API_JOBS_BASE}/createTask`;

const getApiKey = () => {
  const key = process.env.KIE_API_KEY || process.env.API_KEY;
  return (key && key !== 'undefined') ? key : null;
};

/**
 * Опрашивает API, имитируя получение данных из колбэка.
 * Использует тот же формат данных, что пришел в логах Vercel.
 */
export const pollTaskStatus = async (taskId: string): Promise<string> => {
  const apiKey = getApiKey();
  const maxAttempts = 60; 
  let attempts = 0;
  const statusUrl = `${KIE_API_JOBS_BASE}/${taskId}`;

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(statusUrl, {
        headers: { 
          "Authorization": `Bearer ${apiKey}`,
          "Cache-Control": "no-cache" 
        }
      });

      if (!response.ok) {
        attempts++;
        await new Promise(r => setTimeout(r, 4000));
        continue;
      }

      const raw = await response.json();
      // Структура из лога: { data: { state: "success", resultJson: "..." } }
      const result = raw.data || raw;
      const state = (result.state || "").toLowerCase();
      
      console.log(`[Task ${taskId}] Status: ${state}`);

      if (state === "success" || state === "completed") {
        let foundUrl = "";
        
        // 1. Пытаемся достать из resultJson (как в логе пользователя)
        if (result.resultJson) {
          try {
            const parsedJson = typeof result.resultJson === 'string' 
              ? JSON.parse(result.resultJson) 
              : result.resultJson;
              
            if (parsedJson.resultUrls && parsedJson.resultUrls[0]) {
              foundUrl = parsedJson.resultUrls[0];
            }
          } catch (e) {
            console.warn("Failed to parse resultJson", e);
          }
        }

        // 2. Запасной вариант (прямые поля)
        if (!foundUrl) {
          foundUrl = result.imageUrl || result.resultUrl || (result.result?.resultUrls ? result.result.resultUrls[0] : "");
        }
        
        if (foundUrl) {
          console.log(`[Task ${taskId}] Found Image URL: ${foundUrl}`);
          return foundUrl;
        }
      }

      if (state === "failed" || state === "error") {
        throw new Error(result.failMsg || result.msg || "Generation failed on server");
      }

    } catch (e: any) {
      console.error("Polling error:", e.message);
      if (e.message.includes("failed")) throw e;
    }

    // Ждем 4 секунды перед следующим запросом
    await new Promise(r => setTimeout(r, 4000));
    attempts++;
  }
  throw new Error("Generation timed out. Check back later.");
};

export const createTask = async (prompt: string, faceUrl: string, callbackUrl?: string): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API KEY missing");

  const payload: any = {
    model: "google/nano-banana-edit",
    input: {
      prompt: prompt,
      image_urls: [faceUrl],
      output_format: "png",
      image_size: "1:1"
    }
  };

  // Передаем оба варианта именования для совместимости
  if (callbackUrl) {
    payload.callBackUrl = callbackUrl;
    payload.callback_url = callbackUrl;
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
  
  if (!taskId) throw new Error(data.msg || "Failed to initiate generation");
  return taskId;
};
