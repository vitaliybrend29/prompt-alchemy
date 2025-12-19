
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
  
  let systemInstruction = `You are a world-class prompt engineer for Midjourney and Stable Diffusion. 
  Your task is to create standalone, high-fidelity image prompts.
  
  CRITICAL RULES:
  1. NEVER use phrases like "the person in the photo", "Image A", "Reference B", "from the first image", or "style of the second photo".
  2. Describe the subject's physical traits (hair color, eye shape, facial structure, clothing) as if they are a real person you are seeing right now.
  3. Seamlessly blend the subject and the environment/style into a single cohesive vision. 
  4. The output must be a direct description of a visual scene, ready to be pasted into an AI generator.
  5. Language: English.`;

  const parts: any[] = [];
  
  if (mode === GenerationMode.CUSTOM_SCENE && subjectImages.length > 0 && customText) {
    parts.push({ text: `
      Analyze the physical identity of the person in the provided photos. 
      Generate ${count} prompts that place this specific person into the following scene: "${customText}".
      Describe their face and features naturally within the scene description.
      Return a JSON object: { "results": [ { "imageIndex": 0, "prompts": ["string", ...] } ] }
    ` });
    subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
  }
  else if (mode === GenerationMode.RANDOM_CREATIVE && subjectImages.length > 0) {
    parts.push({ text: `
      Analyze the person in the photos. 
      Generate ${count} high-end editorial/fashion prompts for this subject in varied premium settings.
      Integrate their physical features directly into the prompts.
      Return a JSON object: { "results": [ { "imageIndex": 0, "prompts": ["string", ...] } ] }
    ` });
    subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
  } 
  else if (styleImages.length > 0) {
    parts.push({ text: `
      I have provided style references and subject references.
      Generate ${count} prompts featuring the subject with the EXACT aesthetic, lighting, and medium of the style reference.
      DO NOT refer to the images by name. Describe the person and the style as one unified masterpiece.
      Return a JSON object: { "results": [ { "imageIndex": 0, "prompts": ["string", ...] } ] }
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
