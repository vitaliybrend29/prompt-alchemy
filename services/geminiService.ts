
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
  
  let systemInstruction = `You are an expert prompt engineer for high-end AI image generators (Midjourney, Stable Diffusion). 
  CRITICAL: Maintain subject consistency based on the provided photos. 
  DO NOT use words like "the person in the photo". Describe their features (hair color, face shape, eyes) directly as part of the prompt.
  Return a JSON object: { "results": [ { "imageIndex": number, "prompts": ["string", ...] }, ... ] }`;

  const parts: any[] = [];
  
  if (mode === GenerationMode.CUSTOM_SCENE && subjectImages.length > 0 && customText) {
    parts.push({ text: `
      I have provided subject images. 
      Generate ${count} prompts for EACH subject that places them in this specific scene: "${customText}".
      Describe the person's identity from the photos and integrate them into the scene naturally.
    ` });
    subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
  }
  else if (mode === GenerationMode.RANDOM_CREATIVE && subjectImages.length > 0) {
    parts.push({ text: `
      Generate ${count} DISTINCT high-end editorial/fashion prompts for EACH subject image provided.
      Varied outfits and luxury settings. Maintain facial identity.
    ` });
    subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
  } 
  else if (styleImages.length > 0) {
    parts.push({ text: `
      For EACH style image, generate ${count} prompts ${subjectImages.length > 0 ? 'featuring the provided subject' : 'with a fitting subject'} 
      that replicate the EXACT aesthetic, lighting, and medium of the style reference.
    ` });
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

    const parsed: GeminiResponse = JSON.parse(response.text || '{"results":[]}');
    const finalPrompts: { text: string; referenceImage?: string }[] = [];

    parsed.results.forEach(res => {
      const refImg = (mode === GenerationMode.RANDOM_CREATIVE || mode === GenerationMode.CUSTOM_SCENE)
        ? subjectImages[res.imageIndex]?.base64 
        : styleImages[res.imageIndex]?.base64;

      res.prompts.forEach(p => {
        finalPrompts.push({ text: p, referenceImage: refImg });
      });
    });

    return finalPrompts;
  } catch (error) {
    console.error("Gemini Error:", error);
    throw new Error("Failed to generate prompts.");
  }
};
