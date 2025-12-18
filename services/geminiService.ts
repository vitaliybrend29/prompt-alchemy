
import { GoogleGenAI, Type } from "@google/genai";
import { UploadedImage, GenerationMode } from "../types";

const cleanBase64 = (b64: string) => b64.split(',')[1] || b64;

export interface GeminiResponse {
  results: {
    imageIndex: number;
    prompts: string[];
  }[];
}

export const generatePrompts = async (
  styleImages: UploadedImage[],
  subjectImages: UploadedImage[],
  count: number,
  mode: GenerationMode
): Promise<{ text: string; referenceImage?: string }[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  let systemInstruction = `You are an expert prompt engineer for high-end AI image generators. 
  CRITICAL: You will be provided with one or more images. 
  For EACH reference image provided, you must generate exactly ${count} prompts.
  Return a JSON object: { "results": [ { "imageIndex": number, "prompts": ["string", ...] }, ... ] }`;

  const parts: any[] = [];
  let userPrompt = "";

  if (mode === GenerationMode.RANDOM_CREATIVE && subjectImages.length > 0) {
    userPrompt = `
      I have provided ${subjectImages.length} subject image(s).
      For EACH subject image, generate ${count} DISTINCT photorealistic "Instagram/Pinterest style" prompts.
      Maintain subject consistency. Use varied outfits (bikinis, lingerie, jackets, glasses) and settings.
    `;
    parts.push({ text: userPrompt });
    subjectImages.forEach(img => {
      parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } });
    });
  } 
  else if (styleImages.length > 0) {
    userPrompt = `
      I have provided ${styleImages.length} style reference image(s) ${subjectImages.length > 0 ? `and ${subjectImages.length} subject(s)` : ''}.
      For EACH style image, generate ${count} prompts ${subjectImages.length > 0 ? 'featuring the provided subject' : ''} that replicate that specific image's aesthetic/lighting/composition.
    `;
    parts.push({ text: userPrompt });
    styleImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
    if (subjectImages.length > 0) {
      subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
    }
  } else {
    throw new Error("Missing images for generation.");
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            results: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  imageIndex: { type: Type.INTEGER },
                  prompts: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  }
                },
                required: ["imageIndex", "prompts"]
              }
            }
          },
          required: ["results"]
        }
      }
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error("Model returned an empty response.");
    }

    const parsed: GeminiResponse = JSON.parse(responseText);
    const finalPrompts: { text: string; referenceImage?: string }[] = [];

    parsed.results.forEach(res => {
      const refImg = mode === GenerationMode.RANDOM_CREATIVE 
        ? subjectImages[res.imageIndex]?.base64 
        : styleImages[res.imageIndex]?.base64;

      res.prompts.forEach(p => {
        finalPrompts.push({ text: p, referenceImage: refImg });
      });
    });

    return finalPrompts;
  } catch (error) {
    console.error("Gemini Error:", error);
    throw new Error("Failed to generate. Try fewer images or check connection.");
  }
};
