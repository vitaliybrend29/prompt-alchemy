
const KIE_API_JOBS_BASE = "https://api.kie.ai/api/v1/jobs";
const CREATE_TASK_URL = `${KIE_API_JOBS_BASE}/createTask`;

const getApiKey = () => {
  const key = process.env.KIE_API_KEY || process.env.API_KEY;
  return (key && key !== 'undefined') ? key : null;
};

/**
 * Опрашивает API для получения статуса задачи.
 * Обрабатывает специфический формат resultJson (строка в строке), 
 * который присылает Kie.ai в колбэках и ответах.
 */
export const pollTaskStatus = async (taskId: string): Promise<string> => {
  const apiKey = getApiKey();
  const maxAttempts = 80; // Увеличиваем время ожидания до ~6 минут
  let attempts = 0;
  const statusUrl = `${KIE_API_JOBS_BASE}/${taskId}`;

  console.log(`[Task ${taskId}] Поллинг запущен...`);

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
      const result = raw.data || raw;
      const state = (result.state || "").toLowerCase();
      
      console.log(`[Task ${taskId}] Статус: ${state}`);

      if (state === "success" || state === "completed") {
        let foundUrl = "";
        
        // 1. Пытаемся вытянуть URL из resultJson (как в логах пользователя)
        if (result.resultJson) {
          try {
            // Если resultJson - это строка, парсим её
            const parsed = typeof result.resultJson === 'string' 
              ? JSON.parse(result.resultJson) 
              : result.resultJson;
              
            if (parsed.resultUrls && Array.isArray(parsed.resultUrls) && parsed.resultUrls[0]) {
              foundUrl = parsed.resultUrls[0];
            } else if (parsed.imageUrl) {
              foundUrl = parsed.imageUrl;
            }
          } catch (e) {
            console.warn("[Polling] Ошибка парсинга resultJson:", e);
          }
        }

        // 2. Запасной путь (если URL лежит в корне объекта data)
        if (!foundUrl) {
          foundUrl = result.imageUrl || result.resultUrl || (result.result?.resultUrls ? result.result.resultUrls[0] : "");
        }
        
        if (foundUrl) {
          console.log(`[Task ${taskId}] Успех! URL найден: ${foundUrl}`);
          return foundUrl;
        } else {
          console.warn(`[Task ${taskId}] Статус success, но URL не найден в ответе. Ответ API:`, result);
        }
      }

      if (state === "failed" || state === "error") {
        throw new Error(result.failMsg || result.msg || "Ошибка генерации на сервере");
      }

    } catch (e: any) {
      console.error("[Polling] Ошибка запроса:", e.message);
      if (e.message.includes("Ошибка генерации")) throw e;
    }

    // Ждем 5 секунд между попытками
    await new Promise(r => setTimeout(r, 5000));
    attempts++;
  }
  throw new Error("Превышено время ожидания. Попробуйте обновить страницу позже.");
};

export const createTask = async (prompt: string, faceUrl: string, callbackUrl?: string): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("KIE_API_KEY не настроен");

  const payload: any = {
    model: "google/nano-banana-edit",
    input: {
      prompt: prompt,
      image_urls: [faceUrl],
      output_format: "png",
      image_size: "1:1"
    }
  };

  // Передаем callbackUrl в двух вариантах написания для надежности
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
  
  if (!taskId) throw new Error(data.msg || "Не удалось создать задачу");
  return taskId;
};
