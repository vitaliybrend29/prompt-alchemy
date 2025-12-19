
import React, { useState, useEffect } from 'react';
import ImageUploader from './components/ImageUploader';
import { UploadedImage, LoadingState, GenerationMode, PromptGroup, GeneratedPrompt } from './types';
import { generatePrompts } from './services/geminiService';
import { WandIcon, CopyIcon, SparklesIcon, ImageIcon, UserIcon, TrashIcon } from './components/Icons';

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
  const [isRandomMode, setIsRandomMode] = useState<boolean>(false);
  const [history, setHistory] = useState<PromptGroup[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>(LoadingState.IDLE);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('prompt_alchemy_v3_compact');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        localStorage.removeItem('prompt_alchemy_v3_compact');
      }
    }
  }, []);

  useEffect(() => {
    try {
      const historyToSave = history.slice(0, MAX_HISTORY_ITEMS);
      localStorage.setItem('prompt_alchemy_v3_compact', JSON.stringify(historyToSave));
    } catch (e) {}
  }, [history]);

  const handleGenerate = async () => {
    const hasSubject = subjectImages.length > 0;
    const hasStyle = styleImages.length > 0;
    const canGen = (isRandomMode && hasSubject) || hasStyle;

    if (!canGen) {
      setError("Add at least one reference image.");
      return;
    }
    
    setError(null);
    setLoadingState(LoadingState.ANALYZING);

    try {
      const mode = isRandomMode ? GenerationMode.RANDOM_CREATIVE : GenerationMode.MATCH_STYLE;
      const results = await generatePrompts(styleImages, subjectImages, promptCount, mode);

      const promptsWithThumbnails: GeneratedPrompt[] = await Promise.all(
        results.map(async (p) => ({
          text: p.text,
          referenceImage: p.referenceImage ? await createThumbnail(p.referenceImage) : undefined
        }))
      );

      const newGroup: PromptGroup = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        prompts: promptsWithThumbnails,
        styleReferences: [],
        subjectReferences: [],
        mode
      };

      setHistory(prev => [newGroup, ...prev].slice(0, MAX_HISTORY_ITEMS));
      setLoadingState(LoadingState.IDLE);
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
      setLoadingState(LoadingState.ERROR);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="min-h-screen bg-background text-slate-200 pb-20 selection:bg-indigo-500/30">
      <header className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b border-slate-800 px-4 py-4 mb-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg shadow-lg">
              <SparklesIcon className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">Prompt Alchemy</h1>
          </div>
          <div className="flex items-center gap-4">
            {history.length > 0 && (
              <button 
                onClick={() => { if(confirm('Clear history?')) setHistory([]); }} 
                className="text-xs text-slate-500 hover:text-red-400 flex items-center gap-1 transition-colors"
              >
                <TrashIcon className="w-3 h-3" /> Clear History
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* INPUT PANEL */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface rounded-2xl p-5 border border-slate-700/50 shadow-2xl sticky top-24">
            <div className="space-y-6">
              <ImageUploader 
                label="Subject (The Girl)"
                images={subjectImages}
                maxCount={MAX_IMAGES_PER_CATEGORY}
                onImagesUpload={(imgs) => setSubjectImages(prev => [...prev, ...imgs].slice(0, MAX_IMAGES_PER_CATEGORY))}
                onRemove={(id) => setSubjectImages(prev => prev.filter(i => i.id !== id))}
                icon={<UserIcon className="w-4 h-4 text-purple-400" />}
              />

              <div className={isRandomMode ? 'opacity-40 pointer-events-none grayscale' : ''}>
                <ImageUploader 
                  label="Style Reference"
                  images={styleImages}
                  maxCount={MAX_IMAGES_PER_CATEGORY}
                  onImagesUpload={(imgs) => setStyleImages(prev => [...prev, ...imgs].slice(0, MAX_IMAGES_PER_CATEGORY))}
                  onRemove={(id) => setStyleImages(prev => prev.filter(i => i.id !== id))}
                  icon={<ImageIcon className="w-4 h-4 text-indigo-400" />}
                />
              </div>

              <div className="space-y-4 pt-4 border-t border-slate-700/50">
                <div className="flex bg-slate-900/50 p-1 rounded-xl border border-slate-700">
                  <button onClick={() => setIsRandomMode(false)} className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${!isRandomMode ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500'}`}>Match Style</button>
                  <button onClick={() => setIsRandomMode(true)} className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${isRandomMode ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-sm' : 'text-slate-500'}`}>Random Creative</button>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider ml-1">Prompts per image</span>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 5].map(n => (
                      <button key={n} onClick={() => setPromptCount(n)} className={`py-1.5 rounded-lg text-xs font-bold border transition-all ${promptCount === n ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>{n}</button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={loadingState === LoadingState.ANALYZING}
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
                >
                  {loadingState === LoadingState.ANALYZING ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  ) : (
                    <><WandIcon className="w-4 h-4" /> Generate Alchemy</>
                  )}
                </button>
                {error && <p className="text-[10px] text-red-400 text-center">{error}</p>}
              </div>
            </div>
          </div>
        </div>

        {/* OUTPUT/HISTORY LIST */}
        <div className="lg:col-span-8 space-y-6">
          {history.length === 0 && loadingState === LoadingState.IDLE && (
            <div className="flex flex-col items-center justify-center h-96 border-2 border-dashed border-slate-800 rounded-3xl text-slate-600">
              <SparklesIcon className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-sm">Upload images and hit generate to begin.</p>
            </div>
          )}

          {history.map((group) => (
            <div key={group.id} className="bg-surface/50 rounded-2xl border border-slate-800 overflow-hidden shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-slate-800/50 px-5 py-3 border-b border-slate-700/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 rounded-lg bg-slate-700/50">
                    {group.mode === GenerationMode.RANDOM_CREATIVE ? <UserIcon className="w-4 h-4 text-purple-400" /> : <ImageIcon className="w-4 h-4 text-indigo-400" />}
                  </div>
                  <div className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                    {new Date(group.timestamp).toLocaleTimeString()} • {group.mode.replace('_', ' ')} • {group.prompts.length} Prompts
                  </div>
                </div>
              </div>

              <div className="p-5 space-y-6">
                {group.prompts.map((prompt, idx) => (
                  <div key={idx} className="flex gap-4 group">
                    {prompt.referenceImage && (
                      <div className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-slate-700 shadow-md bg-slate-800">
                        <img src={prompt.referenceImage} alt="Ref" className="w-full h-full object-cover" />
                      </div>
                    )}
                    
                    <div className="flex-grow bg-slate-900/40 rounded-xl p-4 border border-slate-700/30 hover:border-indigo-500/30 transition-all relative">
                      <div className="flex justify-between items-start gap-3 mb-2">
                        <span className="text-[9px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-bold uppercase tracking-tighter">AI Output</span>
                        <button onClick={() => copyToClipboard(prompt.text)} className="text-slate-500 hover:text-white p-1 bg-slate-800 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                          <CopyIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-sm text-slate-300 leading-relaxed font-mono select-all">{prompt.text}</p>
                    </div>
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
