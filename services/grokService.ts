
import { UploadedImage, GenerationMode } from "../types";

const cleanBase64 = (b64: string) => b64.split(',')[1] || b64;

export const generateGrokPrompts = async (
  apiKey: string,
  styleImages: UploadedImage[],
  subjectImages: UploadedImage[],
  count: number,
  mode: GenerationMode,
  customText?: string
): Promise<{ text: string; referenceImage?: string }[]> => {
  const systemInstruction = `You are a world-class Midjourney Prompt Engineer. 
  TASK: Generate highly detailed visual prompts.
  
  IF MODE IS CHARACTER_SHEET: 
  You must create a "Character Reference Sheet". Describe the person's figure, outfit, and facial features. 
  The prompt should explicitly request: "split-view, multiple angles, front, side, and back views, consistent character design, full body".
  
  FORMAT: Respond ONLY with a valid JSON object:
  {
    "results": [
      { "imageIndex": 0, "prompts": ["...", "..."] }
    ]
  }`;

  const content: any[] = [{ type: "text", text: "Create prompts based on the provided person." }];

  if (styleImages.length > 0) {
    styleImages.forEach(img => content.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${cleanBase64(img.base64)}` } }));
  }

  if (subjectImages.length > 0) {
    subjectImages.forEach(img => content.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${cleanBase64(img.base64)}` } }));
  }

  let userText = `Mode: ${mode}. Count: ${count}. `;
  if (customText) userText += `Context: "${customText}". `;
  userText += `Ensure the output is JSON.`;
  
  content.push({ type: "text", text: userText });

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "grok-2-vision-1212",
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: content }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "Grok API Error");
  }

  const data = await response.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  
  const finalPrompts: { text: string; referenceImage?: string }[] = [];
  if (parsed.results) {
    parsed.results.forEach((res: any) => {
      const idx = res.imageIndex || 0;
      const refImg = mode === GenerationMode.MATCH_STYLE ? styleImages[idx]?.base64 : subjectImages[idx]?.base64;
      res.prompts.forEach((p: string) => finalPrompts.push({ text: p, referenceImage: refImg }));
    });
  }

  return finalPrompts;
};
