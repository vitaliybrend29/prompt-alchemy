
/**
 * Сервис для генерации изображений через Kie.ai API
 */

const KIE_API_JOBS_BASE = "https://api.kie.ai/api/v1/jobs";
const CREATE_TASK_URL = `${KIE_API_JOBS_BASE}/createTask`;

// Безопасное получение ключа
const getApiKey = () => {
  const key = process.env.KIE_API_KEY || process.env.API_KEY;
  if (!key || key === 'undefined' || key === 'null') return null;
  return key;
};

/**
 * Опрашивает статус задачи до завершения или ошибки.
 */
export const pollTaskStatus = async (taskId: string): Promise<string> => {
  const apiKey = getApiKey();
  const maxAttempts = 60; // 5 минут (60 * 5 сек)
  let attempts = 0;
  const statusUrl = `${KIE_API_JOBS_BASE}/${taskId}`;

  console.log(`Starting polling for task: ${taskId}`);

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(statusUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        }
      });

      if (!response.ok) {
        console.warn(`Polling response not OK: ${response.status}`);
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      const rawResult = await response.json();
      // Лог для отладки в консоли браузера
      console.log("Poll Response:", rawResult);

      // В API Kie.ai данные обычно лежат в корне или в поле .data
      const result = rawResult.data || rawResult;
      const state = (result.state || result.status || "").toLowerCase();
      
      if (state === "success" || state === "completed" || state === "succeeded") {
          let foundUrl = "";

          // 1. Проверяем поле resultJson (часто приходит как строка JSON)
          if (result.resultJson) {
              try {
                  const parsed = typeof result.resultJson === 'string' ? JSON.parse(result.resultJson) : result.resultJson;
                  if (parsed.resultUrls && parsed.resultUrls[0]) foundUrl = parsed.resultUrls[0];
              } catch (e) {
                  console.error("Failed to parse resultJson", e);
              }
          }

          // 2. Проверяем вложенные результаты
          if (!foundUrl && result.result?.resultUrls?.[0]) {
              foundUrl = result.result.resultUrls[0];
          }

          // 3. Проверяем прямые ссылки
          if (!foundUrl) {
              foundUrl = result.imageUrl || result.resultUrl || result.url;
          }

          if (foundUrl) {
              console.log("Image found:", foundUrl);
              return foundUrl;
          } else {
              console.warn("Task success but no URL found in:", result);
          }
      }

      // Если задача провалилась
      if (state === "failed" || state === "error" || state === "fail") {
          throw new Error(result.failMsg || result.msg || "Generation failed on server");
      }

      // Если все еще в очереди или в процессе - ждем
      console.log(`Task ${taskId} is ${state}... Waiting.`);

    } catch (e: any) {
      console.error("Polling attempt error:", e.message);
      if (e.message.includes("failed on server")) throw e;
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
    attempts++;
  }
  throw new Error("Время ожидания генерации истекло (Timeout)");
};

/**
 * Создание задачи генерации
 */
export const createTask = async (prompt: string, faceUrl: string, callbackUrl?: string): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API KEY не найден.");

  const payload: any = {
    model: "google/nano-banana-edit",
    input: {
      prompt: prompt,
      image_urls: [faceUrl],
      output_format: "png",
      image_size: "1:1"
    }
  };

  if (callbackUrl && callbackUrl.trim().startsWith('http')) {
    const url = callbackUrl.trim();
    payload.callBackUrl = url;
    payload.callback_url = url;
  }

  const createResponse = await fetch(CREATE_TASK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const createResult = await createResponse.json();
  const taskId = createResult.data?.taskId || createResult.taskId || createResult.data?.id;
  
  if (!taskId) {
    throw new Error(createResult.msg || "API не вернул ID задачи");
  }
  return taskId;
};

export const generateGeminiImage = async (prompt: string, faceUrl: string, callbackUrl?: string): Promise<string> => {
  const taskId = await createTask(prompt, faceUrl, callbackUrl);
  return await pollTaskStatus(taskId);
};
