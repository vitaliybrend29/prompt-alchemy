
import React, { useState, useEffect } from 'react';
import ImageUploader from './components/ImageUploader';
import { UploadedImage, LoadingState, GenerationMode, PromptGroup, GeneratedPrompt } from './types';
import { generatePrompts } from './services/geminiService';
import { generateGeminiImage } from './services/imageGenerationService';
import { WandIcon, CopyIcon, SparklesIcon, ImageIcon, UserIcon, TrashIcon, TelegramIcon, SettingsIcon, PlayIcon, GridIcon } from './components/Icons';

const MAX_IMAGES_PER_CATEGORY = 5;
const MAX_HISTORY_ITEMS = 10;

const createThumbnail = (base64: string, maxWidth = 200): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = img.width / img.height;
      canvas.width = maxWidth;
      canvas.height = maxWidth / ratio;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = base64;
  });
};

const App: React.FC = () => {
  const [styleImages, setStyleImages] = useState<UploadedImage[]>([]);
  const [subjectImages, setSubjectImages] = useState<UploadedImage[]>([]);
  const [promptCount, setPromptCount] = useState<number>(3);
  const [genMode, setGenMode] = useState<GenerationMode>(GenerationMode.MATCH_STYLE);
  const [customSceneText, setCustomSceneText] = useState<string>('');
  const [history, setHistory] = useState<PromptGroup[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>(LoadingState.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  
  // Приоритет: 1. Переменная окружения Vercel, 2. LocalStorage
  const [imgbbKey, setImgbbKey] = useState(process.env.IMGBB_API_KEY || localStorage.getItem('imgbb_key') || '');

  useEffect(() => {
    const checkApiKey = async () => {
      // @ts-ignore
      if (window.aistudio) {
        // @ts-ignore
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          // @ts-ignore
          await window.aistudio.openSelectKey();
        }
      }
    };
    checkApiKey();
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('prompt_alchemy_v5');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        localStorage.removeItem('prompt_alchemy_v5');
      }
    }
  }, []);

  useEffect(() => {
    try {
      const historyToSave = history.slice(0, MAX_HISTORY_ITEMS);
      localStorage.setItem('prompt_alchemy_v5', JSON.stringify(historyToSave));
    } catch (e) {}
  }, [history]);

  useEffect(() => {
    if (imgbbKey && imgbbKey !== process.env.IMGBB_API_KEY) {
      localStorage.setItem('imgbb_key', imgbbKey);
    }
  }, [imgbbKey]);

  const convertToPublicUrl = async (image: UploadedImage): Promise<string | undefined> => {
    const keyToUse = imgbbKey || process.env.IMGBB_API_KEY;
    
    if (!keyToUse || keyToUse === 'undefined') {
      setError("Please set an ImgBB API Key in Settings to convert images to links.");
      return undefined;
    }

    try {
      const formData = new FormData();
      const base64Data = image.base64.split(',')[1];
      formData.append('image', base64Data);

      const response = await fetch(`https://api.imgbb.com/1/upload?key=${keyToUse}`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      if (result.success && result.data && result.data.url) {
        console.log("Image successfully converted to link:", result.data.url);
        return result.data.url; // Это прямая ссылка i.ibb.co
      } else {
        throw new Error(result.error?.message || "ImgBB upload failed");
      }
    } catch (e: any) {
      setError(`Image conversion failed: ${e.message}`);
      return undefined;
    }
  };

  const handleImageUpload = async (newImages: UploadedImage[], setter: React.Dispatch<React.SetStateAction<UploadedImage[]>>) => {
    // 1. Добавляем временные объекты
    setter(prev => [...prev, ...newImages].slice(0, MAX_IMAGES_PER_CATEGORY));

    // 2. Последовательно загружаем каждый файл
    for (const img of newImages) {
      setter(prev => prev.map(i => i.id === img.id ? { ...i, isUploading: true } : i));
      
      const url = await convertToPublicUrl(img);
      
      setter(prev => prev.map(i => {
        if (i.id === img.id) {
          return { ...i, publicUrl: url, isUploading: false };
        }
        return i;
      }));
    }
  };

  const handleGenerate = async () => {
    const hasSubject = subjectImages.length > 0;
    const hasStyle = styleImages.length > 0;
    
    if (genMode === GenerationMode.CUSTOM_SCENE && (!hasSubject || !customSceneText.trim())) {
      setError("Add a subject photo and describe the scene.");
      return;
    }
    if (genMode === GenerationMode.MATCH_STYLE && !hasStyle) {
      setError("Add at least one style reference image.");
      return;
    }
    if ((genMode === GenerationMode.RANDOM_CREATIVE || genMode === GenerationMode.CHARACTER_SHEET) && !hasSubject) {
      setError("Add a subject photo for this mode.");
      return;
    }

    // КРИТИЧЕСКИЙ МОМЕНТ: Проверяем наличие ПУБЛИЧНЫХ ссылок
    const isConverting = [...subjectImages, ...styleImages].some(img => img.isUploading);
    if (isConverting) {
      setError("Still converting images to links... please wait.");
      return;
    }

    const missingUrls = [...subjectImages, ...styleImages].some(img => !img.publicUrl);
    if (missingUrls) {
      setError("Some images failed to upload to ImgBB. Please re-upload them or check your API key.");
      return;
    }

    setError(null);
    setLoadingState(LoadingState.ANALYZING);

    try {
      const results = await generatePrompts(styleImages, subjectImages, promptCount, genMode, customSceneText);

      const promptsWithThumbnails: GeneratedPrompt[] = await Promise.all(
        results.map(async (p) => ({
          text: p.text,
          referenceImage: p.referenceImage ? await createThumbnail(p.referenceImage) : undefined
        }))
      );

      // Сохраняем в историю ТОЛЬКО публичные ссылки
      const newGroup: PromptGroup = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        prompts: promptsWithThumbnails,
        styleReferences: styleImages.map(i => i.publicUrl!),
        subjectReferences: subjectImages.map(i => i.publicUrl!),
        mode: genMode,
      };

      setHistory(prev => [newGroup, ...prev].slice(0, MAX_HISTORY_ITEMS));
      setLoadingState(LoadingState.IDLE);
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
      setLoadingState(LoadingState.ERROR);
    }
  };

  const handleGenImage = async (groupIndex: number, promptIndex: number) => {
    const group = history[groupIndex];
    const promptObj = group.prompts[promptIndex];
    
    setHistory(prev => {
      const next = [...prev];
      next[groupIndex].prompts[promptIndex] = { ...next[groupIndex].prompts[promptIndex], isGenerating: true, error: undefined };
      return next;
    });

    try {
      const faceRef = group.subjectReferences[0];
      
      // Если в старой истории лежит base64, пытаемся найти актуальную ссылку из текущего стейта
      let finalFaceUrl = faceRef;
      if (!faceRef || !faceRef.startsWith('http')) {
        if (subjectImages.length > 0 && subjectImages[0].publicUrl) {
          finalFaceUrl = subjectImages[0].publicUrl;
        } else {
          throw new Error("This history item has no public link. Please clear history and upload the photo again.");
        }
      }
      
      const imageUrl = await generateGeminiImage(promptObj.text, finalFaceUrl);
      
      setHistory(prev => {
        const next = [...prev];
        next[groupIndex].prompts[promptIndex] = { ...next[groupIndex].prompts[promptIndex], isGenerating: false, generatedImageUrl: imageUrl };
        return next;
      });
    } catch (err: any) {
      setHistory(prev => {
        const next = [...prev];
        next[groupIndex].prompts[promptIndex] = { ...next[groupIndex].prompts[promptIndex], isGenerating: false, error: err.message };
        return next;
      });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Флаг занятости загрузкой
  const isAnyImageUploading = [...subjectImages, ...styleImages].some(img => img.isUploading);

  return (
    <div className="min-h-screen bg-background text-slate-200 pb-20 selection:bg-indigo-500/30">
      <header className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b border-slate-800 px-4 py-4 mb-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg shadow-lg">
              <SparklesIcon className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight hidden lg:block">Prompt Alchemy</h1>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-full transition-colors ${showSettings ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
              title="API Key Settings"
            >
              <SettingsIcon className="w-5 h-5" />
            </button>
            <a 
              href="https://t.me/promtalchhemy1_bot" 
              target="_blank" 
              rel="noopener noreferrer"
              className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-full border border-slate-700 text-xs text-indigo-400 font-medium transition-colors"
            >
              <TelegramIcon className="w-3.5 h-3.5" /> Bot
            </a>
            {history.length > 0 && (
              <button 
                onClick={() => { if(confirm('Clear history? (Highly recommended after changing API keys)')) setHistory([]); }} 
                className="text-xs text-slate-500 hover:text-red-400 flex items-center gap-1 transition-colors"
              >
                <TrashIcon className="w-3 h-3" /> Clear History
              </button>
            )}
          </div>
        </div>

        {showSettings && (
          <div className="max-w-6xl mx-auto px-4 mt-4 animate-in slide-in-from-top duration-300">
            <div className="bg-surface border border-slate-700 rounded-2xl p-6 shadow-2xl grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <SettingsIcon className="w-4 h-4 text-indigo-400" />
                  Gemini & Kie.ai
                </h3>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  System uses the primary selected API key for both prompt alchemy and image generation via Kie.ai.
                </p>
                <button 
                  // @ts-ignore
                  onClick={() => window.aistudio.openSelectKey()}
                  className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-colors"
                >
                  Select / Change Primary Key
                </button>
              </div>

              <div className="space-y-4 border-l border-slate-800 pl-0 md:pl-6">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-emerald-400" />
                  ImgBB Converter (Direct PNG Link)
                </h3>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Required for Kie.ai. If set in Vercel (IMGBB_API_KEY), manual input is not needed. <a href="https://api.imgbb.com/" target="_blank" className="text-indigo-400 underline">Get a free key here</a>.
                </p>
                <input 
                  type="password"
                  value={imgbbKey}
                  onChange={(e) => setImgbbKey(e.target.value)}
                  placeholder={process.env.IMGBB_API_KEY ? "Using Vercel API Key..." : "Paste ImgBB API Key here..."}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-4 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* INPUT PANEL */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface rounded-2xl p-5 border border-slate-700/50 shadow-2xl sticky top-24">
            <div className="space-y-6">
              <ImageUploader 
                label="Target (Person's Face)"
                images={subjectImages}
                maxCount={MAX_IMAGES_PER_CATEGORY}
                onImagesUpload={(imgs) => handleImageUpload(imgs, setSubjectImages)}
                onRemove={(id) => setSubjectImages(prev => prev.filter(i => i.id !== id))}
                icon={<UserIcon className="w-4 h-4 text-purple-400" />}
              />

              {genMode === GenerationMode.MATCH_STYLE && (
                <ImageUploader 
                  label="Style Reference"
                  images={styleImages}
                  maxCount={MAX_IMAGES_PER_CATEGORY}
                  onImagesUpload={(imgs) => handleImageUpload(imgs, setStyleImages)}
                  onRemove={(id) => setStyleImages(prev => prev.filter(i => i.id !== id))}
                  icon={<ImageIcon className="w-4 h-4 text-indigo-400" />}
                />
              )}

              {genMode === GenerationMode.CUSTOM_SCENE && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
                    <SparklesIcon className="w-4 h-4 text-pink-400" />
                    Describe the Scene
                  </label>
                  <textarea 
                    value={customSceneText}
                    onChange={(e) => setCustomSceneText(e.target.value)}
                    placeholder="E.g. sitting in a vintage library with glowing magical books..."
                    className="w-full h-24 bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-none transition-all placeholder:text-slate-600"
                  />
                </div>
              )}

              <div className="space-y-4 pt-4 border-t border-slate-700/50">
                <div className="grid grid-cols-1 gap-2 bg-slate-900/50 p-1 rounded-xl border border-slate-700 overflow-hidden">
                  <div className="grid grid-cols-2 gap-1 p-1">
                    <button onClick={() => setGenMode(GenerationMode.MATCH_STYLE)} className={`py-1.5 text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${genMode === GenerationMode.MATCH_STYLE ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-800'}`}>
                      <ImageIcon className="w-3 h-3" /> Style
                    </button>
                    <button onClick={() => setGenMode(GenerationMode.CUSTOM_SCENE)} className={`py-1.5 text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${genMode === GenerationMode.CUSTOM_SCENE ? 'bg-pink-600 text-white' : 'text-slate-500 hover:bg-slate-800'}`}>
                      <SparklesIcon className="w-3 h-3" /> Scene
                    </button>
                    <button onClick={() => setGenMode(GenerationMode.CHARACTER_SHEET)} className={`py-1.5 text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${genMode === GenerationMode.CHARACTER_SHEET ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-slate-800'}`}>
                      <GridIcon className="w-3 h-3" /> Multi-Angle
                    </button>
                    <button onClick={() => setGenMode(GenerationMode.RANDOM_CREATIVE)} className={`py-1.5 text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${genMode === GenerationMode.RANDOM_CREATIVE ? 'bg-purple-600 text-white' : 'text-slate-500 hover:bg-slate-800'}`}>
                      <WandIcon className="w-3 h-3" /> Random
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider ml-1">Variations</span>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 5].map(n => (
                      <button key={n} onClick={() => setPromptCount(n)} className={`py-1.5 rounded-lg text-xs font-bold border transition-all ${promptCount === n ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>{n}</button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={loadingState === LoadingState.ANALYZING || isAnyImageUploading}
                  className="w-full py-3 px-4 rounded-xl text-white font-bold shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all bg-gradient-to-r from-indigo-600 to-purple-600 hover:shadow-indigo-500/20"
                >
                  {loadingState === LoadingState.ANALYZING ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  ) : isAnyImageUploading ? (
                    <><span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin"></span> Converting to links...</>
                  ) : (
                    <><WandIcon className="w-4 h-4" /> Start Alchemy</>
                  )}
                </button>
                {error && <p className="text-[10px] text-red-400 text-center font-bold bg-red-400/10 py-2 rounded-lg mt-2">{error}</p>}
              </div>
            </div>
          </div>
        </div>

        {/* OUTPUT AREA */}
        <div className="lg:col-span-8 space-y-6">
          {history.length === 0 && loadingState === LoadingState.IDLE && (
            <div className="flex flex-col items-center justify-center h-[500px] border-2 border-dashed border-slate-800 rounded-3xl text-slate-600 bg-slate-900/10">
              <SparklesIcon className="w-12 h-12 mb-4 opacity-10" />
              <p className="text-sm font-medium">Synthesizer is idle. Upload references to begin.</p>
            </div>
          )}

          {history.map((group, groupIdx) => (
            <div key={group.id} className="bg-surface/50 rounded-2xl border border-slate-800 overflow-hidden shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-slate-800/50 px-5 py-3 border-b border-slate-700/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-lg ${
                    group.mode === GenerationMode.CHARACTER_SHEET ? 'bg-emerald-600/20 text-emerald-400' :
                    group.mode === GenerationMode.CUSTOM_SCENE ? 'bg-pink-600/20 text-pink-400' :
                    'bg-indigo-600/20 text-indigo-400'
                  }`}>
                    {group.mode === GenerationMode.CHARACTER_SHEET ? <GridIcon className="w-4 h-4" /> : <SparklesIcon className="w-4 h-4" />}
                  </div>
                  <div className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                    {new Date(group.timestamp).toLocaleTimeString()} • {group.mode.replace('_', ' ')}
                  </div>
                </div>
              </div>

              <div className="p-5 space-y-8">
                {group.prompts.map((prompt, pIdx) => (
                  <div key={pIdx} className="space-y-4">
                    <div className="flex flex-col sm:flex-row gap-4 group">
                      {prompt.referenceImage && (
                        <div className="flex-shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-slate-700 shadow-md">
                          <img src={prompt.referenceImage} alt="Ref" className="w-full h-full object-cover" />
                        </div>
                      )}
                      
                      <div className="flex-grow bg-slate-900/40 rounded-xl p-4 border border-slate-700/30 group-hover:border-indigo-500/30 transition-all relative">
                        <div className="flex justify-between items-start gap-3 mb-2">
                          <span className="text-[9px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-bold uppercase tracking-wider">Variation {pIdx + 1}</span>
                          <div className="flex gap-2">
                             <button 
                              onClick={() => handleGenImage(groupIdx, pIdx)}
                              disabled={prompt.isGenerating}
                              className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1 rounded-lg transition-all opacity-0 group-hover:opacity-100 ${
                                prompt.isGenerating 
                                ? 'bg-indigo-500/20 text-indigo-400' 
                                : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-600/20'
                              }`}
                            >
                              {prompt.isGenerating ? (
                                <><span className="w-2.5 h-2.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></span> Generating...</>
                              ) : (
                                <><PlayIcon className="w-3 h-3" /> Gen Image</>
                              )}
                            </button>
                            <button onClick={() => copyToClipboard(prompt.text)} className="text-slate-500 hover:text-white p-1.5 bg-slate-800 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                              <CopyIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <p className="text-sm text-slate-300 leading-relaxed font-mono selection:bg-indigo-500/40">{prompt.text}</p>
                        {prompt.error && <p className="text-[10px] text-red-400 mt-2 font-bold">Error: {prompt.error}</p>}
                      </div>
                    </div>

                    {prompt.generatedImageUrl && (
                      <div className="ml-0 sm:ml-28 rounded-2xl overflow-hidden border border-slate-700 bg-slate-900 shadow-2xl max-w-sm aspect-square relative group/res animate-in zoom-in fade-in duration-500">
                        <img src={prompt.generatedImageUrl} alt="Generated" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/res:opacity-100 transition-opacity flex items-center justify-center gap-3">
                          <a href={prompt.generatedImageUrl} target="_blank" rel="noreferrer" className="px-4 py-2 bg-indigo-600 text-white rounded-full text-xs font-bold hover:bg-indigo-500 transition-all">View Original</a>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default App;
