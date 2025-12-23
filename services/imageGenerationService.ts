
const KIE_API_JOBS_BASE = "https://api.kie.ai/api/v1/jobs";
const CREATE_TASK_URL = `${KIE_API_JOBS_BASE}/createTask`;

const getApiKey = () => {
  const key = process.env.KIE_API_KEY || process.env.API_KEY;
  return (key && key !== 'undefined') ? key : null;
};

/**
 * Опрашивает API для получения статуса задачи.
 * Использует официальный метод recordInfo согласно документации Kie.ai.
 */
export const pollTaskStatus = async (taskId: string): Promise<string> => {
  const apiKey = getApiKey();
  const maxAttempts = 100; // Увеличиваем лимит попыток
  let attempts = 0;
  
  // ВАЖНО: Используем правильный эндпоинт из документации
  const statusUrl = `${KIE_API_JOBS_BASE}/recordInfo?taskId=${taskId}`;

  console.log(`[Task ${taskId}] Начинаю опрос по адресу: ${statusUrl}`);

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(statusUrl, {
        headers: { 
          "Authorization": `Bearer ${apiKey}`,
          "Cache-Control": "no-cache" 
        }
      });

      if (!response.ok) {
        console.warn(`[Task ${taskId}] Ошибка HTTP: ${response.status}`);
        attempts++;
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const raw = await response.json();
      
      // Согласно документации, данные лежат в поле "data"
      if (raw.code !== 200) {
        console.warn(`[Task ${taskId}] API вернул код ${raw.code}: ${raw.message}`);
      }

      const result = raw.data;
      if (!result) {
        attempts++;
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const state = (result.state || "").toLowerCase();
      console.log(`[Task ${taskId}] Текущий статус: ${state}`);

      if (state === "success" || state === "completed") {
        let foundUrl = "";
        
        // Обработка поля resultJson (строка, содержащая JSON)
        if (result.resultJson) {
          try {
            const parsed = typeof result.resultJson === 'string' 
              ? JSON.parse(result.resultJson) 
              : result.resultJson;
              
            if (parsed.resultUrls && Array.isArray(parsed.resultUrls) && parsed.resultUrls[0]) {
              foundUrl = parsed.resultUrls[0];
            }
          } catch (e) {
            console.warn(`[Task ${taskId}] Ошибка парсинга resultJson:`, e);
          }
        }

        // Запасные варианты, если URL в другом месте
        if (!foundUrl) {
          foundUrl = result.imageUrl || result.resultUrl || (result.result?.resultUrls ? result.result.resultUrls[0] : "");
        }
        
        if (foundUrl) {
          console.log(`[Task ${taskId}] ИЗОБРАЖЕНИЕ ГОТОВО: ${foundUrl}`);
          return foundUrl;
        } else {
          console.error(`[Task ${taskId}] Статус "success", но URL не найден. Данные:`, result);
        }
      }

      if (state === "fail" || state === "failed" || state === "error") {
        throw new Error(result.failMsg || result.message || "Генерация отклонена сервером.");
      }

    } catch (e: any) {
      console.error(`[Task ${taskId}] Ошибка при опросе:`, e.message);
      if (e.message.includes("отклонена")) throw e;
    }

    // Ждем 5-6 секунд перед следующим запросом
    await new Promise(r => setTimeout(r, 6000));
    attempts++;
  }
  throw new Error("Время ожидания истекло. Изображение генерируется слишком долго.");
};

export const createTask = async (prompt: string, faceUrl: string, callbackUrl?: string): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API KEY (KIE_API_KEY) не найден в окружении.");

  const payload: any = {
    model: "google/nano-banana-edit",
    input: {
      prompt: prompt,
      image_urls: [faceUrl],
      output_format: "png",
      image_size: "1:1"
    }
  };

  if (callbackUrl) {
    payload.callBackUrl = callbackUrl;
  }

  const res = await fetch(CREATE_TASK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ошибка API при создании: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const taskId = data.data?.taskId || data.taskId;
  
  if (!taskId) throw new Error(data.message || "Не удалось получить ID задачи от Kie.ai");
  return taskId;
};
