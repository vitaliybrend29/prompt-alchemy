
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
  mode: GenerationMode,
  customText?: string
): Promise<{ text: string; referenceImage?: string }[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  let systemInstruction = `You are an expert Midjourney Prompt Engineer.
  TASK: Generate detailed, standalone visual prompts in English.
  
  RULES:
  1. DO NOT mention "Image A", "Subject", "Reference", or "the photo".
  2. Describe physical features (e.g., "a man with sharp cheekbones and messy dark hair") instead of saying "the person in the photo".
  3. Merge subject and style into one unified cinematic description.
  4. Output MUST be valid JSON.`;

  const parts: any[] = [];
  
  if (mode === GenerationMode.CUSTOM_SCENE && subjectImages.length > 0 && customText) {
    parts.push({ text: `
      Analyze the person in the photos. 
      Generate ${count} prompts for each subject putting them in this scene: "${customText}".
      Describe their face and features naturally.
      Return JSON: { "results": [ { "imageIndex": 0, "prompts": ["...", "..."] } ] }
    ` });
    subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
  }
  else if (mode === GenerationMode.RANDOM_CREATIVE && subjectImages.length > 0) {
    parts.push({ text: `
      Analyze the person in the photos. 
      Generate ${count} unique high-end editorial prompts for this person.
      Return JSON: { "results": [ { "imageIndex": 0, "prompts": ["...", "..."] } ] }
    ` });
    subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
  } 
  else if (styleImages.length > 0) {
    parts.push({ text: `
      I have provided style images and subject images.
      Generate ${count} prompts where the subject's identity is merged with the style aesthetics.
      Return JSON: { "results": [ { "imageIndex": 0, "prompts": ["...", "..."] } ] }
    ` });
    styleImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
    if (subjectImages.length > 0) {
      subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
    }
  } else {
    throw new Error("Missing images.");
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
                  prompts: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["imageIndex", "prompts"]
              }
            }
          },
          required: ["results"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("Empty response from AI.");

    const parsed: GeminiResponse = JSON.parse(text);
    const finalPrompts: { text: string; referenceImage?: string }[] = [];

    if (!parsed.results || !Array.isArray(parsed.results)) return [];

    parsed.results.forEach(res => {
      // Safe index access
      const index = typeof res.imageIndex === 'number' ? res.imageIndex : 0;
      
      let refImg: string | undefined;
      if (mode === GenerationMode.RANDOM_CREATIVE || mode === GenerationMode.CUSTOM_SCENE) {
        refImg = subjectImages[index]?.base64 || subjectImages[0]?.base64;
      } else {
        refImg = styleImages[index]?.base64 || styleImages[0]?.base64;
      }

      if (res.prompts && Array.isArray(res.prompts)) {
        res.prompts.forEach(p => {
          finalPrompts.push({ text: p, referenceImage: refImg });
        });
      }
    });

    return finalPrompts;
  } catch (error) {
    console.error("Gemini Error:", error);
    throw new Error(error instanceof Error ? error.message : "Failed to generate prompts.");
  }
};
