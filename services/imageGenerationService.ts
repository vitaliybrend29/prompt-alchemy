
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
const pollTaskStatus = async (taskId: string): Promise<string> => {
  const apiKey = getApiKey();
  const maxAttempts = 60; 
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
      if (attempts > 20) throw e;
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
    attempts++;
  }
  throw new Error("Timeout");
};

/**
 * Создание задачи генерации
 * @param prompt Текст промта
 * @param faceUrl Ссылка на фото лица
 * @param callbackUrl URL для уведомления сайта
 */
export const generateGeminiImage = async (prompt: string, faceUrl: string, callbackUrl?: string): Promise<string> => {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    throw new Error("API KEY не найден.");
  }

  try {
    const payload: any = {
      model: "google/nano-banana-edit",
      input: {
        prompt: prompt,
        image_urls: [faceUrl],
        output_format: "png",
        image_size: "1:1"
      }
    };

    // Добавляем callBackUrl (в Kie.ai используется camelCase)
    if (callbackUrl && callbackUrl.trim().startsWith('http')) {
      payload.callBackUrl = callbackUrl.trim();
      console.log(`Setting callback URL for task: ${payload.callBackUrl}`);
    }

    const createResponse = await fetch(CREATE_TASK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!createResponse.ok) {
        const errText = await createResponse.text();
        throw new Error(`Create failed: ${errText}`);
    }

    const createResult = await createResponse.json();
    const taskId = createResult.data?.taskId || createResult.taskId || createResult.data?.id;
    
    if (!taskId) throw new Error("No taskId returned from API");

    // Даже если мы используем Callback, мы продолжаем опрашивать статус,
    // чтобы пользователь на сайте сразу увидел результат.
    return await pollTaskStatus(taskId);

  } catch (error: any) {
    throw error;
  }
};
