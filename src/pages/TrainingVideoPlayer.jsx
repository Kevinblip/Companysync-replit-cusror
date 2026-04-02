import { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Play, Pause, Volume2, VolumeX, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function TrainingVideoPlayer() {
  const params = new URLSearchParams(window.location.search);
  const videoId = params.get('id');
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef(null);

  const { data: video, isLoading } = useQuery({
    queryKey: ['training-video', videoId],
    queryFn: async () => {
      const response = await base44.functions.invoke('getPublicTrainingVideo', { videoId });
      return response.data.video;
    },
    enabled: !!videoId,
  });

  const handleAudioEnded = () => {
    if (currentSlide < (video?.slides?.length || 0) - 1) {
      setCurrentSlide(currentSlide + 1);
    } else {
      setIsPlaying(false);
    }
  };

  useEffect(() => {
    if (!isPlaying || !video?.slides?.[currentSlide]) return;

    const slide = video.slides[currentSlide];
    
    if (slide.audioUrl && audioRef.current) {
      // Validate audio URL before setting
      if (!slide.audioUrl.startsWith('http')) {
        console.warn('Invalid audio URL, skipping to next slide');
        if (currentSlide < video.slides.length - 1) {
          setCurrentSlide(currentSlide + 1);
        } else {
          setIsPlaying(false);
        }
        return;
      }

      // Reset audio element first
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = slide.audioUrl;
      audioRef.current.muted = isMuted;
      
      // Play with a small delay to ensure source is loaded
      const playTimer = setTimeout(() => {
        audioRef.current?.play().catch(err => {
          console.error('Audio playback failed:', err);
          // Auto-advance on playback error
          if (currentSlide < video.slides.length - 1) {
            setCurrentSlide(currentSlide + 1);
          } else {
            setIsPlaying(false);
          }
        });
      }, 50);
      
      return () => clearTimeout(playTimer);
    } else {
      // No audio, advance after 3 seconds
      const timer = setTimeout(() => {
        if (currentSlide < video.slides.length - 1) {
          setCurrentSlide(currentSlide + 1);
        } else {
          setIsPlaying(false);
        }
      }, 3000);
      
      return () => clearTimeout(timer);
    }
  }, [isPlaying, currentSlide, video, isMuted]);

  const togglePlayPause = () => {
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      // Stop and reset any current audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.src = '';
      }
      
      // Force reset to first slide
      setCurrentSlide(0);
      setIsPlaying(false); // Ensure it's stopped first
      
      // Start playing after a brief delay to ensure state is updated
      requestAnimationFrame(() => {
        setIsPlaying(true);
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white text-xl">Loading training video...</div>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white text-xl">Training video not found</div>
      </div>
    );
  }

  const slides = video.slides || [];
  const currentSlideData = slides[currentSlide];

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <h1 className="text-2xl font-bold text-white">{video.title}</h1>
        {video.description && (
          <p className="text-gray-400 mt-1">{video.description}</p>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-6xl">
          <Card className="bg-black border-2 border-gray-700">
            <CardContent className="p-0">
              {/* Video Display */}
              <div className="relative aspect-video bg-black">
                {currentSlideData?.imageUrl && (
                  <img
                    src={currentSlideData.imageUrl}
                    alt={`Slide ${currentSlide + 1}`}
                    className="w-full h-full object-contain"
                  />
                )}
                
                {/* Caption Overlay */}
                {currentSlideData?.caption && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-75 text-white p-4 text-center">
                    <p className="text-lg">{currentSlideData.caption}</p>
                  </div>
                )}

                {/* Play/Pause Overlay */}
                {!isPlaying && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Button
                      size="lg"
                      onClick={togglePlayPause}
                      className="bg-blue-600 hover:bg-blue-700 w-20 h-20 rounded-full"
                    >
                      <Play className="w-10 h-10" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="bg-gray-800 p-4">
                <div className="flex items-center justify-between mb-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))}
                    disabled={currentSlide === 0 || isPlaying}
                    className="text-white hover:bg-gray-700"
                  >
                    <ChevronLeft className="w-5 h-5 mr-1" />
                    Previous
                  </Button>

                  <div className="text-white text-sm font-medium">
                    Slide {currentSlide + 1} of {slides.length}
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentSlide(Math.min(slides.length - 1, currentSlide + 1))}
                    disabled={currentSlide === slides.length - 1 || isPlaying}
                    className="text-white hover:bg-gray-700"
                  >
                    Next
                    <ChevronRight className="w-5 h-5 ml-1" />
                  </Button>
                </div>

                <div className="flex items-center justify-center gap-4">
                  <Button
                    onClick={togglePlayPause}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {isPlaying ? (
                      <>
                        <Pause className="w-4 h-4 mr-2" />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Start Training
                      </>
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsMuted(!isMuted)}
                    className="text-white hover:bg-gray-700"
                  >
                    {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const shareUrl = window.location.href;
                      navigator.clipboard.writeText(shareUrl);
                      toast.success('Share link copied to clipboard!');
                    }}
                    className="text-white hover:bg-gray-700"
                    title="Share this training video"
                  >
                    <Share2 className="w-5 h-5" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (video.video_url) {
                        const link = document.createElement('a');
                        link.href = video.video_url;
                        link.download = `${video.title || 'training-video'}.mp4`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        toast.success('Downloading video...');
                      } else {
                        toast.error('Video file not available. Generate the video first in the builder.');
                      }
                    }}
                    className="text-white hover:bg-gray-700"
                    title="Download training video"
                  >
                    <Download className="w-5 h-5" />
                  </Button>
                </div>

                {/* Progress Bar */}
                <div className="mt-4 bg-gray-700 h-2 rounded-full overflow-hidden">
                  <div 
                    className="bg-blue-600 h-full transition-all duration-300"
                    style={{ width: `${((currentSlide + 1) / slides.length) * 100}%` }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Hidden audio player */}
      <audio 
        ref={audioRef} 
        onEnded={handleAudioEnded}
        onError={(e) => {
          console.error('Audio load error:', e);
          // Auto-advance if audio fails to load
          if (currentSlide < (video?.slides?.length || 0) - 1) {
            setCurrentSlide(currentSlide + 1);
          } else {
            setIsPlaying(false);
          }
        }}
        crossOrigin="anonymous"
        className="hidden"
      />
    </div>
  );
}