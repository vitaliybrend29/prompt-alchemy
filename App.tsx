
import React, { useState, useEffect } from 'react';
import ImageUploader from './components/ImageUploader';
import { UploadedImage, LoadingState, GenerationMode, PromptGroup, GeneratedPrompt } from './types';
import { generatePrompts } from './services/geminiService';
import { createTask, pollTaskStatus } from './services/imageGenerationService';
import { WandIcon, CopyIcon, SparklesIcon, ImageIcon, UserIcon, TrashIcon, SettingsIcon, GridIcon } from './components/Icons';

const MAX_HISTORY_ITEMS = 25;

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
  const [imgbbKey, setImgbbKey] = useState(localStorage.getItem('imgbb_key') || '');
  
  const defaultCallback = typeof window !== 'undefined' ? `${window.location.origin}/api/callback` : '';
  const [callbackUrl, setCallbackUrl] = useState(localStorage.getItem('kie_callback_url') || defaultCallback);

  // Восстановление истории и активных опросов при загрузке
  useEffect(() => {
    const saved = localStorage.getItem('alchemy_history_v5');
    if (saved) {
      try {
        const parsed: PromptGroup[] = JSON.parse(saved);
        setHistory(parsed);
        // Запускаем опрос для всех незавершенных задач
        parsed.forEach((group, gIdx) => {
          group.prompts.forEach((p, pIdx) => {
            if (p.taskId && !p.generatedImageUrl && !p.error) {
              resumePolling(gIdx, pIdx, p.taskId);
            }
          });
        });
      } catch (e) {
        localStorage.removeItem('alchemy_history_v5');
      }
    }
  }, []);

  // Синхронизация истории с localStorage
  useEffect(() => {
    localStorage.setItem('alchemy_history_v5', JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)));
  }, [history]);

  const resumePolling = async (groupIdx: number, promptIdx: number, taskId: string) => {
    setHistory(prev => {
      const next = [...prev];
      if (next[groupIdx]?.prompts[promptIdx]) {
        next[groupIdx].prompts[promptIdx] = { 
          ...next[groupIdx].prompts[promptIdx], 
          isGenerating: true, 
          taskId,
          error: undefined 
        };
      }
      return next;
    });

    try {
      const url = await pollTaskStatus(taskId);
      setHistory(prev => {
        const next = [...prev];
        if (next[groupIdx]?.prompts[promptIdx]) {
          next[groupIdx].prompts[promptIdx] = { 
            ...next[groupIdx].prompts[promptIdx], 
            isGenerating: false, 
            generatedImageUrl: url,
            error: undefined 
          };
        }
        return next;
      });
    } catch (err: any) {
      setHistory(prev => {
        const next = [...prev];
        if (next[groupIdx]?.prompts[promptIdx]) {
          next[groupIdx].prompts[promptIdx] = { 
            ...next[groupIdx].prompts[promptIdx], 
            isGenerating: false, 
            error: err.message 
          };
        }
        return next;
      });
    }
  };

  const convertToPublicUrl = async (image: UploadedImage): Promise<string | undefined> => {
    const key = imgbbKey || process.env.IMGBB_API_KEY;
    if (!key) return undefined;
    try {
      const fd = new FormData();
      fd.append('image', image.base64.split(',')[1]);
      const res = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, { method: 'POST', body: fd });
      const data = await res.json();
      return data.success ? data.data.url : undefined;
    } catch (e) { return undefined; }
  };

  const handleImageUpload = async (newImages: UploadedImage[], setter: React.Dispatch<React.SetStateAction<UploadedImage[]>>) => {
    setter(prev => [...prev, ...newImages].slice(0, 5));
    for (const img of newImages) {
      setter(prev => prev.map(i => i.id === img.id ? { ...i, isUploading: true } : i));
      const url = await convertToPublicUrl(img);
      setter(prev => prev.map(i => i.id === img.id ? { ...i, publicUrl: url, isUploading: false } : i));
    }
  };

  const handleGenerate = async () => {
    if (subjectImages.length === 0) { setError("Загрузите фото лица."); return; }
    if (genMode === GenerationMode.MATCH_STYLE && styleImages.length === 0) { setError("Загрузите референс стиля."); return; }
    
    setError(null);
    setLoadingState(LoadingState.ANALYZING);
    try {
      const results = await generatePrompts(styleImages, subjectImages, promptCount, genMode, customSceneText);
      const prompts: GeneratedPrompt[] = await Promise.all(results.map(async (p) => ({
        text: p.text,
        referenceImage: p.referenceImage ? await createThumbnail(p.referenceImage) : undefined
      })));
      
      const newGroup: PromptGroup = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        prompts,
        styleReferences: styleImages.map(i => i.publicUrl!).filter(Boolean),
        subjectReferences: subjectImages.map(i => i.publicUrl!).filter(Boolean),
        mode: genMode,
      };
      
      setHistory(prev => [newGroup, ...prev]);
      setLoadingState(LoadingState.IDLE);
    } catch (err: any) {
      setError(err.message);
      setLoadingState(LoadingState.ERROR);
    }
  };

  const handleGenImage = async (groupIdx: number, promptIdx: number) => {
    const group = history[groupIdx];
    const prompt = group.prompts[promptIdx];
    if (prompt.isGenerating) return;

    try {
      const faceUrl = group.subjectReferences[0];
      if (!faceUrl) throw new Error("Публичная ссылка на лицо еще не готова. Подождите пару секунд.");
      
      const taskId = await createTask(prompt.text, faceUrl, callbackUrl);
      resumePolling(groupIdx, promptIdx, taskId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const clearHistory = () => {
    if (confirm("Удалить всю историю?")) {
      setHistory([]);
      localStorage.removeItem('alchemy_history_v5');
    }
  };

  return (
    <div className="min-h-screen bg-background text-slate-200 pb-20 selection:bg-indigo-500/30">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-slate-800 px-4 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SparklesIcon className="w-7 h-7 text-indigo-500 drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
            <h1 className="text-xl font-black text-white tracking-tighter uppercase italic">Prompt Alchemy</h1>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={clearHistory}
              title="Очистить историю"
              className="p-2.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-all"
            >
              <TrashIcon className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setShowSettings(!showSettings)} 
              className={`p-2.5 rounded-full transition-all ${showSettings ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-white'}`}
            >
              <SettingsIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        {showSettings && (
          <div className="max-w-6xl mx-auto mt-4 p-6 bg-surface rounded-3xl border border-slate-700 shadow-2xl space-y-4 animate-in slide-in-from-top-4 duration-300">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">ImgBB API Key (для публичных ссылок)</label>
                <input 
                  type="password" 
                  value={imgbbKey} 
                  onChange={e => { setImgbbKey(e.target.value); localStorage.setItem('imgbb_key', e.target.value); }} 
                  placeholder="Введите ключ ImgBB..." 
                  className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-3 text-xs outline-none focus:border-indigo-500 transition-colors" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Callback URL (Webhook)</label>
                <input 
                  type="text" 
                  value={callbackUrl} 
                  onChange={e => { setCallbackUrl(e.target.value); localStorage.setItem('kie_callback_url', e.target.value); }} 
                  placeholder="https://your-app.vercel.app/api/callback" 
                  className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-3 text-xs outline-none focus:border-indigo-500 transition-colors" 
                />
              </div>
            </div>
            <p className="text-[9px] text-slate-500 italic">Сайт опрашивает сервер Kie.ai напрямую. Коллбэк нужен для внешних уведомлений (например, в Telegram).</p>
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-4 mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface rounded-[2.5rem] p-7 border border-slate-700/50 shadow-2xl sticky top-24">
            <div className="space-y-8">
              <ImageUploader 
                label="Person (Face)" 
                images={subjectImages} 
                onImagesUpload={imgs => handleImageUpload(imgs, setSubjectImages)} 
                onRemove={id => setSubjectImages(p => p.filter(i => i.id !== id))} 
                icon={<UserIcon className="w-4 h-4 text-purple-400" />} 
                maxCount={1} 
              />
              
              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <WandIcon className="w-3.5 h-3.5" /> Режим генерации
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { id: GenerationMode.MATCH_STYLE, icon: <ImageIcon className="w-5 h-5" />, label: 'Style' },
                    { id: GenerationMode.CUSTOM_SCENE, icon: <WandIcon className="w-5 h-5" />, label: 'Scene' },
                    { id: GenerationMode.CHARACTER_SHEET, icon: <GridIcon className="w-5 h-5" />, label: 'Angles' },
                    { id: GenerationMode.RANDOM_CREATIVE, icon: <SparklesIcon className="w-5 h-5" />, label: 'Random' }
                  ].map(m => (
                    <button 
                      key={m.id} 
                      onClick={() => setGenMode(m.id as GenerationMode)}
                      title={m.label}
                      className={`aspect-square rounded-2xl border transition-all flex items-center justify-center ${
                        genMode === m.id 
                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20 scale-105' 
                        : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-500'
                      }`}
                    >
                      {m.icon}
                    </button>
                  ))}
                </div>
              </div>

              {genMode === GenerationMode.MATCH_STYLE && (
                <ImageUploader 
                  label="Style Reference" 
                  images={styleImages} 
                  onImagesUpload={imgs => handleImageUpload(imgs, setStyleImages)} 
                  onRemove={id => setStyleImages(p => p.filter(i => i.id !== id))} 
                  icon={<ImageIcon className="w-4 h-4 text-sky-400" />} 
                />
              )}

              {genMode === GenerationMode.CUSTOM_SCENE && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Описание сцены</label>
                  <textarea 
                    value={customSceneText} 
                    onChange={e => setCustomSceneText(e.target.value)} 
                    placeholder="Например: в костюме киберпанка под дождем..." 
                    className="w-full h-24 bg-slate-900 border border-slate-700 rounded-2xl p-4 text-xs text-slate-300 outline-none focus:border-indigo-500 transition-colors resize-none" 
                  />
                </div>
              )}
              
              <div className="flex items-center justify-between p-3.5 bg-slate-900/50 rounded-2xl border border-slate-700">
                <span className="text-[10px] font-black text-slate-400 ml-2 uppercase tracking-tighter">Варианты промтов:</span>
                <div className="flex gap-1.5">
                  {[1, 3, 5].map(c => (
                    <button 
                      key={c} 
                      onClick={() => setPromptCount(c)} 
                      className={`w-9 h-9 rounded-xl text-xs font-black transition-all ${
                        promptCount === c ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-white'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <button 
                onClick={handleGenerate} 
                disabled={loadingState === LoadingState.ANALYZING} 
                className="w-full py-5 rounded-2xl font-black bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-xl hover:shadow-indigo-500/20 active:scale-95 transition-all disabled:opacity-50 uppercase tracking-widest text-xs"
              >
                {loadingState === LoadingState.ANALYZING ? 'Пробуждение алхимии...' : 'Запустить трансмутацию'}
              </button>
              
              {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl animate-pulse">
                  <p className="text-[10px] text-red-400 text-center font-bold uppercase">{error}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 space-y-6">
          {history.map((group, gIdx) => (
            <div key={group.id} className="bg-surface/30 border border-slate-800/50 rounded-[2.5rem] overflow-hidden shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-500 backdrop-blur-sm">
              <div className="bg-slate-800/20 px-8 py-4 border-b border-slate-700/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
                    {new Date(group.timestamp).toLocaleTimeString()} • {group.mode}
                  </span>
                </div>
              </div>
              
              <div className="p-8 space-y-12">
                {group.prompts.map((p, pi) => (
                  <div key={pi} className="space-y-6">
                    <div className="flex flex-col md:flex-row gap-6">
                      {p.referenceImage && (
                        <div className="relative shrink-0">
                          <img src={p.referenceImage} className="w-24 h-24 rounded-[1.5rem] object-cover border border-slate-700 shadow-xl" />
                          <div className="absolute -top-2 -left-2 bg-indigo-600 text-[8px] font-black px-2 py-0.5 rounded-full shadow-lg">STYLE</div>
                        </div>
                      )}
                      
                      <div className="flex-grow bg-slate-900/40 border border-slate-800/50 rounded-3xl p-6 relative group/prompt">
                        <div className="flex justify-between items-start mb-4">
                          <span className="text-[10px] font-black text-indigo-500/40">ОПУС #{pi + 1}</span>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => handleGenImage(gIdx, pi)} 
                              disabled={p.isGenerating}
                              className={`text-[10px] px-5 py-2 rounded-xl font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
                                p.isGenerating 
                                ? 'bg-slate-800 text-slate-500 cursor-not-allowed' 
                                : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-600/20'
                              }`}
                            >
                              {p.isGenerating ? (
                                <><span className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"></span> Поллинг...</>
                              ) : p.generatedImageUrl ? 'Перегенерировать' : 'Создать фото'}
                            </button>
                            <button 
                              onClick={() => navigator.clipboard.writeText(p.text)} 
                              className="p-2.5 bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-colors"
                            >
                              <CopyIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed text-slate-300 font-medium selection:bg-indigo-500/40 italic">"{p.text}"</p>
                        
                        {p.isGenerating && (
                           <div className="mt-4 flex flex-col gap-2">
                             <div className="flex items-center gap-3 text-[9px] text-indigo-400 font-bold bg-indigo-500/5 p-2 rounded-xl border border-indigo-500/10">
                                <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping"></div>
                                ID ЗАДАЧИ: {p.taskId}
                             </div>
                             <p className="text-[8px] text-slate-600 ml-2">Ожидание ответа от сервера (до 2-3 минут)...</p>
                           </div>
                        )}
                        
                        {p.error && (
                          <div className="mt-4 p-3 bg-red-400/10 border border-red-400/20 rounded-xl">
                            <p className="text-[10px] text-red-400 font-bold">Ошибка: {p.error}</p>
                            <button onClick={() => handleGenImage(gIdx, pi)} className="text-[8px] mt-1 text-indigo-400 underline uppercase">Попробовать еще раз</button>
                          </div>
                        )}
                      </div>
                    </div>

                    {p.generatedImageUrl && (
                      <div className="md:ml-32 max-w-lg rounded-[2.5rem] overflow-hidden border border-slate-700 shadow-[0_30px_60px_rgba(0,0,0,0.6)] group relative aspect-square bg-slate-900">
                        <img src={p.generatedImageUrl} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex flex-col justify-end p-8">
                          <div className="flex gap-3">
                            <a 
                              href={p.generatedImageUrl} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="flex-grow py-4 bg-white text-black text-xs font-black uppercase text-center rounded-2xl hover:bg-slate-200 transition-colors"
                            >
                              Открыть оригинал
                            </a>
                            <button 
                              onClick={() => navigator.clipboard.writeText(p.generatedImageUrl!)}
                              className="p-4 bg-slate-800 text-white rounded-2xl hover:bg-slate-700"
                            >
                              <CopyIcon className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                        <div className="absolute top-6 right-6 bg-indigo-600 text-white text-[10px] font-black px-4 py-1.5 rounded-full shadow-2xl ring-4 ring-indigo-600/20">READY</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          
          {history.length === 0 && (
            <div className="h-96 flex flex-col items-center justify-center text-slate-800 border-4 border-dashed border-slate-800/30 rounded-[4rem]">
              <SparklesIcon className="w-20 h-20 mb-8 opacity-5" />
              <p className="text-xl font-black uppercase tracking-[0.3em] opacity-10 italic">Пространство алхимии</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
