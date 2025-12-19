
import { GoogleGenAI, Type } from "@google/genai";
import { UploadedImage, GenerationMode } from "../types";

const cleanBase64 = (b64: string) => b64.split(',')[1] || b64;

export interface GeminiResponse {
  results: {
    imageIndex: number; // Index within the style category (or subject if only subjects present)
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
  
  CORE MISSION:
  - If a SUBJECT is provided, strictly analyze their physical traits (face shape, hair style/color, eyes, distinguishing marks) and describe them physically in the prompt.
  - If a STYLE is provided, borrow the lighting, medium (photo, digital art, oil painting), composition, and color palette.
  - DO NOT swap roles: don't use the subject's face for the environment, and don't use the style's face for the subject.
  
  STRICT RULES:
  1. NEVER mention "Image", "Reference", "Subject", "A/B", or "the photo".
  2. Describe everything as if you are looking at a real scene.
  3. Merge subject and style into one unified cinematic description.
  4. Output MUST be valid JSON.`;

  const parts: any[] = [];
  
  if (mode === GenerationMode.CUSTOM_SCENE && subjectImages.length > 0 && customText) {
    parts.push({ text: `SUBJECT REFERENCES (the person to describe):` });
    subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
    
    parts.push({ text: `
      SCENE DESCRIPTION: "${customText}".
      Generate ${count} prompts for the person provided above, placing them in this scene.
      Return JSON: { "results": [ { "imageIndex": 0, "prompts": ["...", "..."] } ] }
    ` });
  }
  else if (mode === GenerationMode.RANDOM_CREATIVE && subjectImages.length > 0) {
    parts.push({ text: `SUBJECT REFERENCES (the person to describe):` });
    subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
    
    parts.push({ text: `
      Generate ${count} creative, high-end editorial prompts for the person provided above.
      Return JSON: { "results": [ { "imageIndex": 0, "prompts": ["...", "..."] } ] }
    ` });
  } 
  else if (styleImages.length > 0) {
    parts.push({ text: `STYLE REFERENCES (borrow the lighting, colors, and art style from these):` });
    styleImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
    
    if (subjectImages.length > 0) {
      parts.push({ text: `SUBJECT/FACE REFERENCES (describe this person physically in the scene):` });
      subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
    }

    parts.push({ text: `
      Generate ${count} prompts where the SUBJECT's identity is placed into the STYLE's environment.
      If multiple styles provided, you can mix them or pick the best one.
      Return JSON: { "results": [ { "imageIndex": 0, "prompts": ["...", "..."] } ] }
      (imageIndex should refer to which STYLE image best matches the resulting prompt).
    ` });
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
      const index = typeof res.imageIndex === 'number' ? res.imageIndex : 0;
      
      let refImg: string | undefined;
      if (mode === GenerationMode.RANDOM_CREATIVE || mode === GenerationMode.CUSTOM_SCENE) {
        // In these modes, we only have subjects, so imageIndex refers to subjectImages
        refImg = subjectImages[index]?.base64 || subjectImages[0]?.base64;
      } else {
        // In MATCH_STYLE mode, imageIndex refers to styleImages
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
