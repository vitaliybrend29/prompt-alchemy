
import React, { useState, useEffect } from 'react';
import ImageUploader from './components/ImageUploader';
import { UploadedImage, LoadingState, GenerationMode, PromptGroup, GeneratedPrompt } from './types';
import { generatePrompts } from './services/geminiService';
import { createTask, pollTaskStatus } from './services/imageGenerationService';
import { WandIcon, CopyIcon, SparklesIcon, ImageIcon, UserIcon, TrashIcon, GridIcon } from './components/Icons';

const MAX_HISTORY_ITEMS = 20;

const ASPECT_RATIOS = [
  { id: '1:1', label: '1:1' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '4:3', label: '4:3' },
  { id: '3:2', label: '3:2' }
];

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
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  const [genMode, setGenMode] = useState<GenerationMode>(GenerationMode.MATCH_STYLE);
  const [customSceneText, setCustomSceneText] = useState<string>('');
  const [history, setHistory] = useState<PromptGroup[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>(LoadingState.IDLE);
  const [error, setError] = useState<string | null>(null);

  // Используем callback из env или пустую строку, так как шестеренку убрали
  const callbackUrl = process.env.KIE_CALLBACK_URL || '';

  useEffect(() => {
    const saved = localStorage.getItem('alchemy_v6_history');
    if (saved) {
      try {
        const parsed: PromptGroup[] = JSON.parse(saved);
        setHistory(parsed);
        parsed.forEach((group, gIdx) => {
          group.prompts.forEach((p, pIdx) => {
            if (p.taskId && !p.generatedImageUrl && !p.error) {
              resumePolling(gIdx, pIdx, p.taskId);
            }
          });
        });
      } catch (e) {
        localStorage.removeItem('alchemy_v6_history');
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('alchemy_v6_history', JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)));
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
    const key = process.env.IMGBB_API_KEY;
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
    if (subjectImages.length === 0) { setError("Upload at least one model photo."); return; }
    if (genMode === GenerationMode.MATCH_STYLE && styleImages.length === 0) { setError("Upload a style reference."); return; }
    
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
      const faceUrls = group.subjectReferences;
      if (faceUrls.length === 0) throw new Error("Photos are not ready. Wait for upload.");
      
      const taskId = await createTask(prompt.text, faceUrls, aspectRatio, callbackUrl);
      resumePolling(groupIdx, promptIdx, taskId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const clearHistory = () => {
    if (confirm("Reset everything?")) {
      setHistory([]);
      localStorage.removeItem('alchemy_v6_history');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans tracking-tight">
      <header className="sticky top-0 z-40 bg-slate-950/70 backdrop-blur-xl border-b border-white/5 py-4 px-8">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 group">
            <div className="p-2 bg-indigo-600/20 rounded-xl group-hover:scale-110 transition-transform">
              <SparklesIcon className="w-5 h-5 text-indigo-400" />
            </div>
            <h1 className="text-xl font-black uppercase tracking-widest text-white italic">Alchemy v6</h1>
          </div>
          <button onClick={clearHistory} className="text-[10px] font-bold text-slate-500 hover:text-red-400 uppercase tracking-widest flex items-center gap-2 px-4 py-2 rounded-full border border-white/5 transition-colors">
            <TrashIcon className="w-3.5 h-3.5" /> Clear History
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 mt-12 grid grid-cols-1 lg:grid-cols-12 gap-12 pb-32">
        {/* SIDEBAR: Configuration */}
        <div className="lg:col-span-4 space-y-10">
          <section className="space-y-8">
            <ImageUploader 
              label="The Subject (Model)" 
              images={subjectImages} 
              onImagesUpload={imgs => handleImageUpload(imgs, setSubjectImages)} 
              onRemove={id => setSubjectImages(p => p.filter(i => i.id !== id))} 
              icon={<UserIcon className="w-4 h-4 text-indigo-400" />} 
              maxCount={5} // До 5 фото
            />

            <div className="space-y-4">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <GridIcon className="w-4 h-4" /> Mode & Ratio
              </label>
              
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: GenerationMode.MATCH_STYLE, icon: <ImageIcon className="w-5 h-5" />, label: 'Style' },
                  { id: GenerationMode.CUSTOM_SCENE, icon: <WandIcon className="w-5 h-5" />, label: 'Custom' },
                  { id: GenerationMode.CHARACTER_SHEET, icon: <GridIcon className="w-5 h-5" />, label: 'Sheets' },
                  { id: GenerationMode.RANDOM_CREATIVE, icon: <SparklesIcon className="w-5 h-5" />, label: 'Random' }
                ].map(m => (
                  <button 
                    key={m.id} 
                    onClick={() => setGenMode(m.id as GenerationMode)}
                    className={`aspect-square rounded-2xl border transition-all flex items-center justify-center ${
                      genMode === m.id 
                      ? 'bg-indigo-600 border-indigo-400 text-white shadow-xl shadow-indigo-500/10' 
                      : 'bg-slate-900 border-white/5 text-slate-500 hover:border-white/20'
                    }`}
                  >
                    {m.icon}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-5 gap-1.5 p-1.5 bg-slate-900/50 rounded-2xl border border-white/5">
                {ASPECT_RATIOS.map(ratio => (
                  <button
                    key={ratio.id}
                    onClick={() => setAspectRatio(ratio.id)}
                    className={`py-2 text-[10px] font-black rounded-xl transition-all ${
                      aspectRatio === ratio.id 
                      ? 'bg-indigo-600 text-white shadow-lg' 
                      : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {ratio.label}
                  </button>
                ))}
              </div>
            </div>

            {genMode === GenerationMode.MATCH_STYLE && (
              <ImageUploader 
                label="Visual Context (Style)" 
                images={styleImages} 
                onImagesUpload={imgs => handleImageUpload(imgs, setStyleImages)} 
                onRemove={id => setStyleImages(p => p.filter(i => i.id !== id))} 
                icon={<ImageIcon className="w-4 h-4 text-emerald-400" />} 
                maxCount={1}
              />
            )}

            {genMode === GenerationMode.CUSTOM_SCENE && (
              <textarea 
                value={customSceneText} 
                onChange={e => setCustomSceneText(e.target.value)} 
                placeholder="Describe your scene here..." 
                className="w-full h-32 bg-slate-900 border border-white/5 rounded-2xl p-4 text-sm text-slate-200 outline-none focus:border-indigo-500/50 transition-colors resize-none shadow-inner" 
              />
            )}

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Quantity</label>
                <div className="flex gap-2">
                  {[1, 3, 5].map(c => (
                    <button 
                      key={c} 
                      onClick={() => setPromptCount(c)} 
                      className={`w-8 h-8 rounded-lg text-xs font-black transition-all ${
                        promptCount === c ? 'bg-slate-200 text-black' : 'text-slate-500 hover:text-white'
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
                className="w-full py-5 rounded-3xl font-black bg-white text-black text-xs uppercase tracking-widest hover:bg-indigo-400 hover:text-white transition-all disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-black"
              >
                {loadingState === LoadingState.ANALYZING ? 'Processing...' : 'Start Transmutation'}
              </button>
              
              {error && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-2xl text-[10px] text-red-400 text-center font-bold uppercase">{error}</div>}
            </div>
          </section>
        </div>

        {/* MAIN: Stream of Consciousness */}
        <div className="lg:col-span-8 space-y-12">
          {history.map((group, gIdx) => (
            <div key={group.id} className="space-y-6">
              <div className="flex items-center gap-4 px-2">
                <div className="h-px flex-grow bg-white/5"></div>
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Session {new Date(group.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                <div className="h-px flex-grow bg-white/5"></div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-1 gap-8">
                {group.prompts.map((p, pi) => (
                  <div key={pi} className="group/card bg-slate-900/30 border border-white/5 rounded-[2.5rem] p-6 flex flex-col md:flex-row gap-8 hover:bg-slate-900/50 transition-colors duration-500 overflow-hidden">
                    
                    {/* Image Result Side */}
                    <div className="md:w-1/2 aspect-square relative rounded-[2rem] overflow-hidden bg-slate-950 border border-white/5 shadow-2xl">
                      {p.generatedImageUrl ? (
                        <img src={p.generatedImageUrl} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-slate-700">
                          {p.isGenerating ? (
                            <div className="flex flex-col items-center gap-3">
                              <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
                              <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400">Forging image...</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-3">
                              <ImageIcon className="w-12 h-12 opacity-20" />
                              <span className="text-[9px] font-black uppercase tracking-widest opacity-40">Awaiting creation</span>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {p.generatedImageUrl && (
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/card:opacity-100 transition-opacity flex items-center justify-center">
                          <a href={p.generatedImageUrl} target="_blank" rel="noreferrer" className="px-6 py-3 bg-white text-black text-[10px] font-black uppercase rounded-full tracking-widest hover:scale-105 transition-transform">Download</a>
                        </div>
                      )}
                    </div>

                    {/* Text Data Side */}
                    <div className="md:w-1/2 flex flex-col justify-between py-2">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">Variant 0{pi + 1}</span>
                          <div className="flex gap-2">
                            <button onClick={() => navigator.clipboard.writeText(p.text)} className="p-2 hover:bg-white/5 rounded-full text-slate-500 hover:text-white transition-colors">
                              <CopyIcon className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleGenImage(gIdx, pi)} 
                              disabled={p.isGenerating}
                              className={`px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
                                p.isGenerating ? 'bg-slate-800 text-slate-600' : 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500'
                              }`}
                            >
                              {p.isGenerating ? 'Wait...' : 'Render'}
                            </button>
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed text-slate-300 font-medium selection:bg-indigo-500/30">{p.text}</p>
                      </div>

                      {p.error && <p className="mt-4 text-[9px] text-red-400 font-bold bg-red-400/5 p-3 rounded-2xl border border-red-400/10 italic">! {p.error}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {history.length === 0 && (
            <div className="h-96 flex flex-col items-center justify-center text-slate-800 border-2 border-dashed border-white/5 rounded-[4rem]">
              <SparklesIcon className="w-16 h-16 mb-6 opacity-5" />
              <p className="text-xs font-black uppercase tracking-[0.4em] opacity-10">Waiting for first reaction</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
