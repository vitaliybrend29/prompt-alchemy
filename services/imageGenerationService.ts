
const KIE_API_JOBS_BASE = "https://api.kie.ai/api/v1/jobs";
const CREATE_TASK_URL = `${KIE_API_JOBS_BASE}/createTask`;

const getApiKey = () => {
  const key = process.env.KIE_API_KEY || process.env.API_KEY;
  return (key && key !== 'undefined') ? key : null;
};

export const pollTaskStatus = async (taskId: string): Promise<string> => {
  const apiKey = getApiKey();
  const maxAttempts = 60; 
  let attempts = 0;
  const statusUrl = `${KIE_API_JOBS_BASE}/${taskId}`;

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(statusUrl, {
        headers: { "Authorization": `Bearer ${apiKey}`, "Cache-Control": "no-cache" }
      });

      if (!response.ok) {
        attempts++;
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const raw = await response.json();
      const result = raw.data || raw;
      const state = (result.state || "").toLowerCase();
      
      if (state === "success" || state === "completed") {
        let foundUrl = "";
        // Парсим resultJson, так как Kie.ai часто присылает его строкой
        if (result.resultJson) {
          try {
            const pj = typeof result.resultJson === 'string' ? JSON.parse(result.resultJson) : result.resultJson;
            if (pj.resultUrls?.[0]) foundUrl = pj.resultUrls[0];
          } catch (e) {}
        }
        if (!foundUrl) foundUrl = result.imageUrl || result.result?.resultUrls?.[0];
        
        if (foundUrl) return foundUrl;
      }

      if (state === "failed" || state === "error") throw new Error(result.failMsg || "Generation failed");

    } catch (e: any) {
      if (e.message.includes("failed")) throw e;
    }

    await new Promise(r => setTimeout(r, 5000));
    attempts++;
  }
  throw new Error("Timeout");
};

export const createTask = async (prompt: string, faceUrl: string, callbackUrl?: string): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API KEY missing");

  const payload: any = {
    model: "google/nano-banana-edit",
    input: { prompt, image_urls: [faceUrl], output_format: "png", image_size: "1:1" }
  };
  if (callbackUrl) {
    payload.callBackUrl = callbackUrl;
    payload.callback_url = callbackUrl;
  }

  const res = await fetch(CREATE_TASK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  const taskId = data.data?.taskId || data.taskId;
  if (!taskId) throw new Error(data.msg || "Task creation failed");
  return taskId;
};
