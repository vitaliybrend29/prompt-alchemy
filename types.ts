
export interface UploadedImage {
  id: string;
  file?: File;
  previewUrl: string;
  base64: string;
  mimeType: string;
  publicUrl?: string;
  isUploading?: boolean;
}

export enum GenerationMode {
  MATCH_STYLE = 'MATCH_STYLE',
  RANDOM_CREATIVE = 'RANDOM_CREATIVE',
  CUSTOM_SCENE = 'CUSTOM_SCENE',
  CHARACTER_SHEET = 'CHARACTER_SHEET',
  NSFC = 'NSFC',
}

export interface GeneratedPrompt {
  id: string; // Уникальный ID для удаления
  text: string;
  referenceImage?: string;
  isGenerating?: boolean;
  generatedImageUrls?: string[]; // Изменено на массив
  error?: string;
  taskId?: string;
}

export interface PromptGroup {
  id: string;
  timestamp: number;
  prompts: GeneratedPrompt[];
  styleReferences: string[];
  subjectReferences: string[];
  mode: GenerationMode;
}

export enum LoadingState {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  ERROR = 'ERROR',
}
