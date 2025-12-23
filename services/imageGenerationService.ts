
/**
 * Сервис для генерации изображений через Kie.ai API
 */

const KIE_API_V1 = "https://api.kie.ai/api/v1";
const JOBS_ENDPOINT = `${KIE_API_V1}/jobs`;
const CREATE_TASK_URL = `${JOBS_ENDPOINT}/createTask`;

// Безопасное получение ключа
const getApiKey = () => {
  const key = process.env.KIE_API_KEY || process.env.API_KEY;
  if (!key || key === 'undefined' || key === 'null') return null;
  return key;
};

/**
 * Опрашивает статус задачи до завершения или ошибки.
 * В Kie.ai статус обычно проверяется через GET /api/v1/jobs/{taskId}
 */
const pollTaskStatus = async (taskId: string): Promise<string> => {
  const apiKey = getApiKey();
  const maxAttempts = 60; 
  let attempts = 0;

  // Стандартный путь для проверки статуса в Kie.ai — это GET запрос к ресурсу задачи
  const pollUrl = `${JOBS_ENDPOINT}/${taskId}`;
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
          // Если задача еще не видна в БД, подождем немного дольше
          console.warn(`Task ${taskId} not found yet (404), retrying...`);
        } else {
          throw new Error(`Ошибка сети (${response.status}): ${response.statusText}`);
        }
      } else {
        const result = await response.json();
        // В Kie.ai данные могут быть в корне или в поле data
        const taskData = result.data || result;

        console.log(`Current state for ${taskId}: ${taskData.state || 'unknown'}`);

        if (taskData.state === "success") {
          console.log("Task success!", taskData);
          
          let resultObj = taskData.result;
          if (taskData.resultJson && typeof taskData.resultJson === 'string') {
            try {
              resultObj = JSON.parse(taskData.resultJson);
            } catch(e) {}
          }
            
          if (resultObj && resultObj.resultUrls && resultObj.resultUrls.length > 0) {
            return resultObj.resultUrls[0];
          }
          
          if (taskData.imageUrl) return taskData.imageUrl;
          if (taskData.resultUrl) return taskData.resultUrl;
          
          throw new Error("URL результата не найден в ответе API.");
        }

        if (taskData.state === "failed" || taskData.state === "fail") {
          throw new Error(taskData.failMsg || taskData.message || "Задача завершилась с ошибкой.");
        }
      }
    } catch (e: any) {
      console.error("Polling error:", e);
      // Не прекращаем опрос при 404 на начальных этапах
      if (e.message.includes('404')) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }
      throw e;
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
    attempts++;
  }

  throw new Error("Превышено время ожидания генерации (300 сек).");
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
      throw new Error(`Ошибка API при создании (${createResponse.status}): ${errorText || createResponse.statusText}`);
    }

    const createResult = await createResponse.json();
    const taskId = createResult.data?.taskId || createResult.taskId || (createResult.data?.id);
    
    if (!taskId) {
      console.error("Invalid create result:", createResult);
      throw new Error("Не удалось получить ID задачи от сервера.");
    }

    console.log("Task created successfully. ID:", taskId);
    return await pollTaskStatus(taskId);

  } catch (error: any) {
    console.error("Kie.ai Error:", error);
    throw new Error(error.message || "Ошибка при запуске генерации.");
  }
};
