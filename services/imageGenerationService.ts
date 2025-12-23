
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
  const maxAttempts = 100;
  let attempts = 0;
  const statusUrl = `${KIE_API_JOBS_BASE}/${taskId}`;

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(statusUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        throw new Error(`API Error ${response.status}`);
      }

      const result = await response.json();
      const taskData = result.data || result;
      
      const state = taskData.state || taskData.status;
      if (state === "success" || state === "COMPLETED" || state === "succeeded") {
          let resultUrls: string[] = [];
          if (taskData.resultJson) {
              try {
                  const parsed = typeof taskData.resultJson === 'string' ? JSON.parse(taskData.resultJson) : taskData.resultJson;
                  if (parsed.resultUrls) resultUrls = parsed.resultUrls;
              } catch (e) {}
          }
          if (resultUrls.length === 0 && taskData.result?.resultUrls) {
              resultUrls = taskData.result.resultUrls;
          }
          const finalUrl = resultUrls[0] || taskData.imageUrl || taskData.resultUrl;
          if (finalUrl) return finalUrl;
      }

      if (state === "failed" || state === "fail" || state === "ERROR") {
          throw new Error(taskData.failMsg || taskData.msg || "Generation failed");
      }

    } catch (e: any) {
      console.warn("Polling error:", e.message);
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
    attempts++;
  }
  throw new Error("Timeout");
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

  // Дублируем ключ в разных регистрах для надежности
  if (callbackUrl && callbackUrl.trim().startsWith('http')) {
    const url = callbackUrl.trim();
    payload.callBackUrl = url;
    payload.callback_url = url; // Альтернативный вариант для некоторых версий API
    payload.callbackUrl = url;  // Еще один вариант
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
    console.error("Full API Response:", createResult);
    throw new Error(createResult.msg || "No taskId returned");
  }
  return taskId;
};

export const generateGeminiImage = async (prompt: string, faceUrl: string, callbackUrl?: string): Promise<string> => {
  const taskId = await createTask(prompt, faceUrl, callbackUrl);
  return await pollTaskStatus(taskId);
};
