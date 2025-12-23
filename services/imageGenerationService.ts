
/**
 * Сервис для генерации изображений через Kie.ai API
 */

const KIE_API_BASE = "https://api.kie.ai/api/v1";
const KIE_API_JOBS = `${KIE_API_BASE}/jobs`;
const KIE_API_FILES = `${KIE_API_BASE}/files`;

// Безопасное получение ключа
const getApiKey = () => {
  const key = process.env.KIE_API_KEY || process.env.API_KEY;
  if (!key || key === 'undefined' || key === 'null') return null;
  return key;
};

/**
 * Конвертирует base64 в Blob для загрузки
 */
const base64ToBlob = (base64: string): Blob => {
  const parts = base64.split(';base64,');
  const contentType = parts[0].split(':')[1];
  const raw = window.atob(parts[1]);
  const rawLength = raw.length;
  const uInt8Array = new Uint8Array(rawLength);

  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }

  return new Blob([uInt8Array], { type: contentType });
};

/**
 * Загружает изображение на Kie.ai и возвращает URL
 */
const uploadImageToKie = async (base64: string): Promise<string> => {
  const apiKey = getApiKey();
  const blob = base64ToBlob(base64);
  const formData = new FormData();
  formData.append('file', blob, 'image.jpg');

  const response = await fetch(`${KIE_API_FILES}/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки файла: ${response.statusText}`);
  }

  const result = await response.json();
  if (result.code !== 200 || !result.data?.url) {
    throw new Error(result.msg || "Не удалось загрузить файл на Kie.ai");
  }

  return result.data.url;
};

/**
 * Опрашивает статус задачи до завершения или ошибки
 */
const pollTaskStatus = async (taskId: string): Promise<string> => {
  const apiKey = getApiKey();
  const maxAttempts = 60; 
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(`${KIE_API_JOBS}/queryTask?taskId=${taskId}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Ошибка сети: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.code !== 200) {
        throw new Error(result.message || `Ошибка API (${result.code})`);
      }

      const taskData = result.data;

      if (taskData.state === "success") {
        const resultJson = typeof taskData.resultJson === 'string' 
          ? JSON.parse(taskData.resultJson) 
          : taskData.resultJson;
          
        if (resultJson.resultUrls && resultJson.resultUrls.length > 0) {
          return resultJson.resultUrls[0];
        }
        throw new Error("URL результата не найден.");
      }

      if (taskData.state === "fail") {
        throw new Error(taskData.failMsg || "Задача завершилась с ошибкой.");
      }

    } catch (e: any) {
      console.error("Polling error:", e);
      throw e;
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
    attempts++;
  }

  throw new Error("Превышено время ожидания (2 мин).");
};

/**
 * Генерирует изображение
 */
export const generateGeminiImage = async (prompt: string, faceBase64?: string): Promise<string> => {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    throw new Error("API KEY не найден.");
  }

  try {
    let faceUrl = "";
    if (faceBase64) {
      console.log("Uploading face image to Kie.ai...");
      faceUrl = await uploadImageToKie(faceBase64);
    } else {
      throw new Error("Необходимо фото лица.");
    }

    const input: any = {
      prompt: prompt,
      output_format: "png",
      image_size: "1:1",
      image_urls: [faceUrl]
    };

    console.log("Creating task with URL:", faceUrl);
    
    const createResponse = await fetch(`${KIE_API_JOBS}/createTask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/nano-banana-edit",
        input: input
      }),
    });

    const createResult = await createResponse.json().catch(() => ({}));
    
    if (!createResponse.ok || createResult.code !== 200) {
      const msg = createResult.message || createResult.msg || createResponse.statusText;
      throw new Error(msg || "Ошибка создания задачи");
    }

    if (!createResult.data?.taskId) {
      throw new Error("taskId отсутствует в ответе.");
    }

    return await pollTaskStatus(createResult.data.taskId);

  } catch (error: any) {
    console.error("Kie.ai Error:", error);
    throw new Error(error.message || "Ошибка при работе с Kie.ai");
  }
};
