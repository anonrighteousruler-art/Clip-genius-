import React, { useState, useRef, useEffect } from 'react';
import { Camera, Image as ImageIcon, X, RefreshCcw, Play, Share, Download, Sparkles, Wand2, Music, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';

const getApiKey = async () => {
  // @ts-ignore
  if (window.aistudio && window.aistudio.hasSelectedApiKey) {
    // @ts-ignore
    const hasKey = await window.aistudio.hasSelectedApiKey();
    if (!hasKey) {
      // @ts-ignore
      await window.aistudio.openSelectKey();
    }
  }
  // @ts-ignore
  const injectedKey = window['process']?.env?.API_KEY || process.env.API_KEY;
  return injectedKey || process.env.GEMINI_API_KEY;
};

async function generateMedia(
  imageData: { base64: string, mimeType: string },
  promptData: any,
  onProgress: (msg: string) => void
) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("API Key required");

  const ai = new GoogleGenAI({ apiKey });

  const base64Image = imageData.base64;
  const mimeType = imageData.mimeType;

  let videoPrompt = "";
  let audioPrompt = "";

  if (promptData.type === 'simple') {
    videoPrompt = promptData.simpleDescription || "A visually stunning cinematic shot";
    audioPrompt = `Create a matching soundtrack for a video described as: ${promptData.simpleDescription || "cinematic"}`;
  } else {
    videoPrompt = `Opening: ${promptData.advOpening}. Mid: ${promptData.advMid}. Ending: ${promptData.advEnding}. Style: ${promptData.advStyle}.`;
    audioPrompt = `Create a ${promptData.advMusicGenre} soundtrack in a ${promptData.advMusicStyle} style for a video.`;
  }

  onProgress("Composing music...");
  let audioBase64 = "";
  let audioMimeType = "audio/wav";
  
  try {
    const audioStream = await ai.models.generateContentStream({
      model: "lyria-3-clip-preview",
      contents: {
        parts: [
          { text: audioPrompt },
          { inlineData: { data: base64Image, mimeType: mimeType } }
        ]
      }
    });

    for await (const chunk of audioStream) {
      const parts = chunk.candidates?.[0]?.content?.parts;
      if (!parts) continue;
      for (const part of parts) {
        if (part.inlineData?.data) {
          if (!audioBase64 && part.inlineData.mimeType) {
            audioMimeType = part.inlineData.mimeType;
          }
          audioBase64 += part.inlineData.data;
        }
      }
    }
  } catch (e: any) {
    console.error("Audio generation failed", e);
    const errMsg = e.message || JSON.stringify(e);
    if (errMsg.includes('403') || errMsg.includes('PERMISSION_DENIED') || errMsg.includes('Requested entity was not found')) {
      throw e;
    }
  }

  onProgress("Generating video (this takes a few minutes)...");
  
  let videoOp = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: videoPrompt,
    image: {
      imageBytes: base64Image,
      mimeType: mimeType
    },
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: '9:16'
    }
  });

  while (!videoOp.done) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    videoOp = await ai.operations.getVideosOperation({ operation: videoOp });
  }

  const videoUri = videoOp.response?.generatedVideos?.[0]?.video?.uri;
  if (!videoUri) throw new Error("Video generation failed to return a URI");

  onProgress("Finalizing...");

  const response = await fetch(videoUri, {
    headers: { 'x-goog-api-key': apiKey }
  });
  const videoBlob = await response.blob();
  const videoObjectUrl = URL.createObjectURL(videoBlob);

  let audioObjectUrl = null;
  if (audioBase64) {
    const binary = atob(audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const audioBlobOut = new Blob([bytes], { type: audioMimeType });
    audioObjectUrl = URL.createObjectURL(audioBlobOut);
  }

  return { videoObjectUrl, audioObjectUrl };
}

const CameraView = ({ onCapture, onClose }: { onCapture: (b: Blob) => void, onClose: () => void }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');

  useEffect(() => {
    let stream: MediaStream | null = null;
    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: false
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Camera error:", err);
      }
    };
    startCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [facingMode]);

  const handleCapture = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        canvas.toBlob(blob => {
          if (blob) onCapture(blob);
        }, 'image/jpeg', 0.9);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <video ref={videoRef} autoPlay playsInline className="flex-1 object-cover" />
      <div className="absolute top-4 right-4 flex gap-4">
        <button onClick={() => setFacingMode(p => p === 'user' ? 'environment' : 'user')} className="p-3 bg-black/50 rounded-full text-white backdrop-blur-md">
          <RefreshCcw size={24} />
        </button>
        <button onClick={onClose} className="p-3 bg-black/50 rounded-full text-white backdrop-blur-md">
          <X size={24} />
        </button>
      </div>
      <div className="absolute bottom-8 left-0 right-0 flex justify-center">
        <button onClick={handleCapture} className="w-20 h-20 rounded-full border-4 border-white/50 flex items-center justify-center">
          <div className="w-16 h-16 bg-white rounded-full"></div>
        </button>
      </div>
    </div>
  );
};

const PromptSheet = ({ onGenerate, onCancel }: { onGenerate: (data: any) => void, onCancel: () => void }) => {
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple');
  const [simpleDesc, setSimpleDesc] = useState('');
  
  const [advOpening, setAdvOpening] = useState('');
  const [advMid, setAdvMid] = useState('');
  const [advEnding, setAdvEnding] = useState('');
  const [advStyle, setAdvStyle] = useState('');
  const [advMusicGenre, setAdvMusicGenre] = useState('');
  const [advMusicStyle, setAdvMusicStyle] = useState('');

  const handleGenerate = () => {
    if (mode === 'simple') {
      onGenerate({ type: 'simple', simpleDescription: simpleDesc });
    } else {
      onGenerate({
        type: 'advanced',
        advOpening, advMid, advEnding, advStyle, advMusicGenre, advMusicStyle
      });
    }
  };

  return (
    <motion.div 
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      className="absolute bottom-0 left-0 right-0 bg-zinc-900/90 backdrop-blur-xl rounded-t-3xl p-6 text-white border-t border-white/10 max-h-[80vh] overflow-y-auto"
    >
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold flex items-center gap-2"><Wand2 size={20}/> Clip Setup</h2>
        <button onClick={onCancel} className="p-2 bg-white/10 rounded-full"><X size={20}/></button>
      </div>

      <div className="flex bg-black/40 rounded-full p-1 mb-6">
        <button 
          onClick={() => setMode('simple')}
          className={`flex-1 py-2 rounded-full text-sm font-medium transition-colors ${mode === 'simple' ? 'bg-white text-black' : 'text-white/60'}`}
        >
          Simple
        </button>
        <button 
          onClick={() => setMode('advanced')}
          className={`flex-1 py-2 rounded-full text-sm font-medium transition-colors ${mode === 'advanced' ? 'bg-white text-black' : 'text-white/60'}`}
        >
          Advanced
        </button>
      </div>

      {mode === 'simple' ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-white/60 mb-2">Describe the desired clip</label>
            <textarea 
              value={simpleDesc}
              onChange={e => setSimpleDesc(e.target.value)}
              placeholder="A neon hologram of a cat driving at top speed..."
              className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 h-32 resize-none"
            />
          </div>
          <p className="text-xs text-white/40 flex items-center gap-1"><Music size={12}/> Auto-music will be generated based on description.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-white/60 mb-2">Opening Scene</label>
            <input value={advOpening} onChange={e => setAdvOpening(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-white/30" placeholder="Camera pans across..." />
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-2">Middle Action</label>
            <input value={advMid} onChange={e => setAdvMid(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-white/30" placeholder="Subject performs action..." />
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-2">Ending Outcome</label>
            <input value={advEnding} onChange={e => setAdvEnding(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-white/30" placeholder="Fades to logo..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/60 mb-2">Visual Style</label>
              <input value={advStyle} onChange={e => setAdvStyle(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-white/30" placeholder="Cinematic, 35mm..." />
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-2">Music Genre</label>
              <input value={advMusicGenre} onChange={e => setAdvMusicGenre(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-white/30" placeholder="Synthwave..." />
            </div>
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-2">Music Mood</label>
            <input value={advMusicStyle} onChange={e => setAdvMusicStyle(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-white/30" placeholder="Upbeat, energetic..." />
          </div>
        </div>
      )}

      <button 
        onClick={handleGenerate}
        className="w-full mt-8 bg-white text-black font-semibold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-white/90 transition-colors"
      >
        <Sparkles size={20} /> Generate Clip
      </button>
    </motion.div>
  );
};

const Player = ({ videoUrl, audioUrl, onBack }: { videoUrl: string, audioUrl: string | null, onBack: () => void }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);

  useEffect(() => {
    if (videoRef.current && audioRef.current) {
      videoRef.current.play();
      audioRef.current.play();
    } else if (videoRef.current) {
      videoRef.current.play();
    }
  }, []);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        audioRef.current?.pause();
      } else {
        videoRef.current.play();
        audioRef.current?.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        const response = await fetch(videoUrl);
        const blob = await response.blob();
        const file = new File([blob], 'clip.mp4', { type: 'video/mp4' });
        
        await navigator.share({
          title: 'My ClipGenius Video',
          text: 'Check out this video I made!',
          files: [file]
        });
      } catch (err) {
        console.error("Share failed:", err);
      }
    } else {
      alert("Sharing not supported on this browser.");
    }
  };

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = 'clip.mp4';
    a.click();
    if (audioUrl) {
      const a2 = document.createElement('a');
      a2.href = audioUrl;
      a2.download = 'audio.wav';
      a2.click();
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <div className="relative flex-1 bg-zinc-900">
        <video 
          ref={videoRef} 
          src={videoUrl} 
          loop 
          playsInline 
          className="w-full h-full object-contain"
          onClick={togglePlay}
          onPlay={() => audioRef.current?.play()}
          onPause={() => audioRef.current?.pause()}
          onSeeked={() => {
            if (audioRef.current && videoRef.current) {
              audioRef.current.currentTime = videoRef.current.currentTime;
            }
          }}
        />
        {audioUrl && <audio ref={audioRef} src={audioUrl} loop />}
        
        <div className="absolute top-4 left-4 right-4 flex justify-between">
          <button onClick={onBack} className="p-3 bg-black/50 rounded-full text-white backdrop-blur-md">
            <X size={24} />
          </button>
          <div className="flex gap-2">
            <button onClick={handleDownload} className="p-3 bg-black/50 rounded-full text-white backdrop-blur-md">
              <Download size={24} />
            </button>
            <button onClick={handleShare} className="p-3 bg-white text-black rounded-full flex items-center gap-2 font-medium px-5">
              <Share size={20} /> Share
            </button>
          </div>
        </div>

        {!isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-20 h-20 bg-black/50 rounded-full flex items-center justify-center backdrop-blur-md text-white">
              <Play size={40} className="ml-2" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default function App() {
  const [state, setState] = useState<'idle' | 'capturing' | 'prompting' | 'generating' | 'result'>('idle');
  const [imageData, setImageData] = useState<{ base64: string, mimeType: string } | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState('');
  const [result, setResult] = useState<{videoUrl: string, audioUrl: string | null} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = (blob: Blob) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1];
      setImageData({ base64: base64Data, mimeType: blob.type });
      setImageUrl(URL.createObjectURL(blob));
      setState('prompting');
    };
    reader.onerror = () => {
      alert("Failed to read file.");
    };
    reader.readAsDataURL(blob);
  };

  const handleCapture = (blob: Blob) => {
    processFile(blob);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const handleGenerate = async (promptData: any) => {
    if (!imageData) return;
    setState('generating');
    try {
      const res = await generateMedia(imageData, promptData, setProgressMsg);
      setResult({ videoUrl: res.videoObjectUrl, audioUrl: res.audioObjectUrl });
      setState('result');
    } catch (err: any) {
      console.error(err);
      const errMsg = err.message || JSON.stringify(err);
      if (errMsg.includes('403') || errMsg.includes('PERMISSION_DENIED') || errMsg.includes('Requested entity was not found')) {
        // @ts-ignore
        if (window.aistudio && window.aistudio.openSelectKey) {
          // @ts-ignore
          await window.aistudio.openSelectKey();
          alert("Please try generating again with your selected paid API key.");
        } else {
          alert("Permission denied. Please ensure you are using a paid API key.");
        }
      } else {
        alert("Generation failed. Please try again.");
      }
      setState('prompting');
    }
  };

  return (
    <div className="min-h-screen bg-black text-white font-sans overflow-hidden relative">
      {state === 'idle' && (
        <div className="flex flex-col items-center justify-center min-h-screen p-6">
          <div className="mb-12 text-center">
            <div className="w-24 h-24 bg-white/10 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <Sparkles size={48} className="text-white" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight mb-2">ClipGenius</h1>
            <p className="text-white/60">Turn moments into cinematic clips</p>
          </div>

          <div className="flex flex-col w-full max-w-sm gap-4">
            <button 
              onClick={() => setState('capturing')}
              className="bg-white text-black py-4 rounded-2xl font-semibold flex items-center justify-center gap-3 text-lg hover:bg-white/90 transition-colors"
            >
              <Camera size={24} /> Capture Moment
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="bg-white/10 text-white py-4 rounded-2xl font-semibold flex items-center justify-center gap-3 text-lg hover:bg-white/20 transition-colors"
            >
              <ImageIcon size={24} /> Upload Photo
            </button>
            <input 
              type="file" 
              accept="image/*" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
          </div>
        </div>
      )}

      {state === 'capturing' && (
        <CameraView onCapture={handleCapture} onClose={() => setState('idle')} />
      )}

      {(state === 'prompting' || state === 'generating') && imageUrl && (
        <div className="fixed inset-0 flex flex-col">
          <div className="flex-1 relative">
            <img src={imageUrl} className="w-full h-full object-cover" alt="Preview" />
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            
            {state === 'generating' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
                <motion.div 
                  animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="w-32 h-32 rounded-full border-4 border-white/20 flex items-center justify-center mb-6"
                >
                  <Loader2 size={48} className="animate-spin text-white" />
                </motion.div>
                <p className="text-xl font-medium text-white text-center px-6">{progressMsg}</p>
              </div>
            )}
          </div>

          <AnimatePresence>
            {state === 'prompting' && (
              <PromptSheet 
                onGenerate={handleGenerate} 
                onCancel={() => setState('idle')} 
              />
            )}
          </AnimatePresence>
        </div>
      )}

      {state === 'result' && result && (
        <Player 
          videoUrl={result.videoUrl} 
          audioUrl={result.audioUrl} 
          onBack={() => setState('idle')} 
        />
      )}
    </div>
  );
}
