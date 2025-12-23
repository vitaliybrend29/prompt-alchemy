
import React, { useState, useEffect } from 'react';
import ImageUploader from './components/ImageUploader';
import { UploadedImage, LoadingState, GenerationMode, PromptGroup, GeneratedPrompt } from './types';
import { generatePrompts } from './services/geminiService';
import { createTask, pollTaskStatus } from './services/imageGenerationService';
import { WandIcon, CopyIcon, SparklesIcon, ImageIcon, UserIcon, TrashIcon, SettingsIcon, GridIcon } from './components/Icons';

const MAX_IMAGES_PER_CATEGORY = 5;
const MAX_HISTORY_ITEMS = 20;

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

  useEffect(() => {
    const saved = localStorage.getItem('prompt_alchemy_history');
    if (saved) {
      try {
        const parsed: PromptGroup[] = JSON.parse(saved);
        setHistory(parsed);
        parsed.forEach((group, gIdx) => {
          group.prompts.forEach((p, pIdx) => {
            if (p.taskId && !p.generatedImageUrl && !p.error) resumePolling(gIdx, pIdx, p.taskId);
          });
        });
      } catch (e) { localStorage.removeItem('prompt_alchemy_history'); }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('prompt_alchemy_history', JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)));
  }, [history]);

  const resumePolling = async (groupIdx: number, promptIdx: number, taskId: string) => {
    setHistory(prev => prev.map((g, gi) => gi === groupIdx ? {
      ...g, prompts: g.prompts.map((p, pi) => pi === promptIdx ? { ...p, isGenerating: true, taskId } : p)
    } : g));

    try {
      const url = await pollTaskStatus(taskId);
      setHistory(prev => prev.map((g, gi) => gi === groupIdx ? {
        ...g, prompts: g.prompts.map((p, pi) => pi === promptIdx ? { ...p, isGenerating: false, generatedImageUrl: url } : p)
      } : g));
    } catch (err: any) {
      setHistory(prev => prev.map((g, gi) => gi === groupIdx ? {
        ...g, prompts: g.prompts.map((p, pi) => pi === promptIdx ? { ...p, isGenerating: false, error: err.message } : p)
      } : g));
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
    setter(prev => [...prev, ...newImages].slice(0, MAX_IMAGES_PER_CATEGORY));
    for (const img of newImages) {
      setter(prev => prev.map(i => i.id === img.id ? { ...i, isUploading: true } : i));
      const url = await convertToPublicUrl(img);
      setter(prev => prev.map(i => i.id === img.id ? { ...i, publicUrl: url, isUploading: false } : i));
    }
  };

  const handleGenerate = async () => {
    if (subjectImages.length === 0) { setError("Upload a face photo first."); return; }
    if (genMode === GenerationMode.MATCH_STYLE && styleImages.length === 0) { setError("Upload style references."); return; }
    
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
        styleReferences: styleImages.map(i => i.publicUrl!),
        subjectReferences: subjectImages.map(i => i.publicUrl!),
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
    try {
      const taskId = await createTask(prompt.text, group.subjectReferences[0], callbackUrl);
      resumePolling(groupIdx, promptIdx, taskId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const clearHistory = () => {
    if (window.confirm("Clear all history?")) setHistory([]);
  };

  return (
    <div className="min-h-screen bg-background text-slate-200 pb-20">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-slate-800 px-4 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SparklesIcon className="w-6 h-6 text-indigo-500" />
            <h1 className="text-xl font-bold text-white">Prompt Alchemy</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={clearHistory} className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-all">
              <TrashIcon className="w-5 h-5" />
            </button>
            <button onClick={() => setShowSettings(!showSettings)} className={`p-2 rounded-full ${showSettings ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-400'}`}>
              <SettingsIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
        {showSettings && (
          <div className="max-w-6xl mx-auto mt-4 p-4 bg-surface rounded-xl border border-slate-700 shadow-xl space-y-4">
            <input type="password" value={imgbbKey} onChange={e => { setImgbbKey(e.target.value); localStorage.setItem('imgbb_key', e.target.value); }} placeholder="ImgBB API Key..." className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs" />
            <input type="text" value={callbackUrl} onChange={e => { setCallbackUrl(e.target.value); localStorage.setItem('kie_callback_url', e.target.value); }} placeholder="Callback URL..." className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs" />
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-4 mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface rounded-2xl p-5 border border-slate-700 shadow-2xl sticky top-24">
            <div className="space-y-6">
              <ImageUploader label="Face Reference" images={subjectImages} onImagesUpload={imgs => handleImageUpload(imgs, setSubjectImages)} onRemove={id => setSubjectImages(p => p.filter(i => i.id !== id))} icon={<UserIcon className="w-4 h-4 text-indigo-400" />} maxCount={1} />
              <div className="grid grid-cols-4 gap-2">
                {[GenerationMode.MATCH_STYLE, GenerationMode.CUSTOM_SCENE, GenerationMode.CHARACTER_SHEET, GenerationMode.RANDOM_CREATIVE].map(m => (
                  <button key={m} onClick={() => setGenMode(m)} className={`p-3 rounded-xl border transition-all flex flex-col items-center gap-1 ${genMode === m ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 bg-slate-900/50 hover:border-slate-500'}`}>
                    {m === GenerationMode.MATCH_STYLE && <ImageIcon className="w-4 h-4" />}
                    {m === GenerationMode.CUSTOM_SCENE && <WandIcon className="w-4 h-4" />}
                    {m === GenerationMode.CHARACTER_SHEET && <GridIcon className="w-4 h-4" />}
                    {m === GenerationMode.RANDOM_CREATIVE && <SparklesIcon className="w-4 h-4" />}
                    <span className="text-[8px] font-bold uppercase">{m.split('_')[0]}</span>
                  </button>
                ))}
              </div>
              {genMode === GenerationMode.MATCH_STYLE && <ImageUploader label="Style References" images={styleImages} onImagesUpload={imgs => handleImageUpload(imgs, setStyleImages)} onRemove={id => setStyleImages(p => p.filter(i => i.id !== id))} icon={<ImageIcon className="w-4 h-4" />} />}
              {genMode === GenerationMode.CUSTOM_SCENE && <textarea value={customSceneText} onChange={e => setCustomSceneText(e.target.value)} placeholder="Describe the scene..." className="w-full h-24 bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs resize-none outline-none" />}
              
              <div className="flex items-center justify-between p-2 bg-slate-900/50 rounded-xl border border-slate-700">
                <span className="text-xs font-bold text-slate-400 ml-2">COUNT:</span>
                <div className="flex gap-1">
                  {[1, 3, 5].map(c => (
                    <button key={c} onClick={() => setPromptCount(c)} className={`w-8 h-8 rounded-lg text-xs font-bold ${promptCount === c ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-500 hover:text-white'}`}>{c}</button>
                  ))}
                </div>
              </div>

              <button onClick={handleGenerate} disabled={loadingState === LoadingState.ANALYZING} className="w-full py-4 rounded-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-xl hover:shadow-indigo-500/20 active:scale-[0.98] transition-all disabled:opacity-50">
                {loadingState === LoadingState.ANALYZING ? 'Analysing...' : 'Alchemy Start'}
              </button>
              {error && <p className="text-[10px] text-red-400 text-center font-bold bg-red-500/10 p-2 rounded-lg">{error}</p>}
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 space-y-6">
          {history.map((group, gIdx) => (
            <div key={group.id} className="bg-surface/50 border border-slate-800 rounded-2xl overflow-hidden shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-slate-800/50 px-5 py-3 border-b border-slate-700/50 flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{new Date(group.timestamp).toLocaleTimeString()} • {group.mode}</span>
              </div>
              <div className="p-6 space-y-8">
                {group.prompts.map((p, pi) => (
                  <div key={pi} className="space-y-4">
                    <div className="flex gap-4">
                      {p.referenceImage && <img src={p.referenceImage} className="w-20 h-20 rounded-xl object-cover border border-slate-700 shadow-lg" />}
                      <div className="flex-grow bg-slate-900/40 border border-slate-800 rounded-xl p-4">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-[10px] font-black text-indigo-500/50">#0{pi + 1}</span>
                          <div className="flex gap-2">
                            <button onClick={() => handleGenImage(gIdx, pi)} className={`text-[10px] px-3 py-1 rounded-lg font-bold flex items-center gap-2 ${p.isGenerating ? 'bg-slate-700 text-slate-400' : 'bg-indigo-600 text-white'}`}>
                              {p.isGenerating ? <><span className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"></span> Working</> : 'Gen Image'}
                            </button>
                            <button onClick={() => navigator.clipboard.writeText(p.text)} className="p-1.5 bg-slate-800 text-slate-400 hover:text-white rounded-lg"><CopyIcon className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed text-slate-300 font-mono selection:bg-indigo-500/30">{p.text}</p>
                        {p.error && <p className="text-[10px] text-red-400 mt-2 font-bold">{p.error}</p>}
                      </div>
                    </div>
                    {p.generatedImageUrl && (
                      <div className="ml-24 max-w-sm rounded-2xl overflow-hidden border border-slate-700 shadow-2xl group relative aspect-square">
                        <img src={p.generatedImageUrl} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <a href={p.generatedImageUrl} target="_blank" rel="noreferrer" className="px-4 py-2 bg-white text-black text-xs font-bold rounded-full">Open Original</a>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {history.length === 0 && (
            <div className="h-64 flex flex-col items-center justify-center text-slate-600 border-2 border-dashed border-slate-800 rounded-3xl">
              <SparklesIcon className="w-12 h-12 mb-4 opacity-10" />
              <p className="text-sm font-medium">Your alchemy history is empty</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
