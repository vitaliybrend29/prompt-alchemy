
/**
 * Сервис для генерации изображений через Kie.ai API
 */

const KIE_API_BASE = "https://api.kie.ai/api/v1/jobs";
const CREATE_TASK_URL = `${KIE_API_BASE}/createTask`;
const QUERY_TASK_URL = `${KIE_API_BASE}/queryTask`;

// Безопасное получение ключа
const getApiKey = () => {
  const key = process.env.KIE_API_KEY || process.env.API_KEY;
  if (!key || key === 'undefined' || key === 'null') return null;
  return key;
};

/**
 * Опрашивает статус задачи до завершения или ошибки
 * Использует queryTask?taskId=...
 */
const pollTaskStatus = async (taskId: string): Promise<string> => {
  const apiKey = getApiKey();
  const maxAttempts = 60; 
  let attempts = 0;

  const pollUrl = `${QUERY_TASK_URL}?taskId=${taskId}`;
  console.log(`Polling task status at: ${pollUrl}`);

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(pollUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.warn(`Task ${taskId} not found yet (404), retrying...`);
        } else {
          throw new Error(`Ошибка сети (${response.status}): ${response.statusText}`);
        }
      } else {
        const result = await response.json();
        // В Kie.ai результат обычно в result.data или result
        const taskData = result.data || result;

        // Состояния в Kie.ai: 'success', 'failed', 'running', 'pending'
        if (taskData.state === "success") {
          console.log("Task success!", taskData);
          
          let resultObj = taskData.result;
          // Иногда результат приходит как строка JSON
          if (taskData.resultJson && typeof taskData.resultJson === 'string') {
            try {
              resultObj = JSON.parse(taskData.resultJson);
            } catch(e) {}
          }
            
          if (resultObj && resultObj.resultUrls && resultObj.resultUrls.length > 0) {
            return resultObj.resultUrls[0];
          }
          
          if (taskData.imageUrl) return taskData.imageUrl;
          
          throw new Error("URL результата не найден в ответе API.");
        }

        if (taskData.state === "failed" || taskData.state === "fail") {
          throw new Error(taskData.failMsg || "Задача завершилась с ошибкой.");
        }
        
        console.log(`Task status: ${taskData.state || 'processing'}... Attempt ${attempts + 1}`);
      }
    } catch (e: any) {
      console.error("Polling error:", e);
      // Если это сетевая ошибка, пробуем еще раз, если нет - пробрасываем
      if (!e.message.includes('Ошибка сети')) throw e;
    }

    await new Promise(resolve => setTimeout(resolve, 4000));
    attempts++;
  }

  throw new Error("Превышено время ожидания генерации (3-4 минуты).");
};

/**
 * Генерирует изображение через createTask
 */
export const generateGeminiImage = async (prompt: string, faceUrl: string): Promise<string> => {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    throw new Error("API KEY не найден. Пожалуйста, выберите ключ в настройках.");
  }

  try {
    const payload = {
      model: "google/nano-banana-edit",
      input: {
        prompt: prompt,
        image_urls: [faceUrl],
        output_format: "png",
        image_size: "1:1"
      }
    };

    console.log("Creating Kie.ai task at:", CREATE_TASK_URL);
    
    const createResponse = await fetch(CREATE_TASK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Ошибка API (${createResponse.status}): ${errorText || createResponse.statusText}`);
    }

    const createResult = await createResponse.json();
    
    // В Kie.ai ID задачи может быть в data.taskId или просто taskId
    const taskId = createResult.data?.taskId || createResult.taskId || (createResult.data?.id);
    
    if (!taskId) {
      console.error("Invalid create result:", createResult);
      throw new Error("Не удалось получить ID задачи от сервера. Проверьте консоль.");
    }

    console.log("Task created successfully. ID:", taskId);
    return await pollTaskStatus(taskId);

  } catch (error: any) {
    console.error("Kie.ai Error:", error);
    throw new Error(error.message || "Ошибка при запуске генерации.");
  }
};
