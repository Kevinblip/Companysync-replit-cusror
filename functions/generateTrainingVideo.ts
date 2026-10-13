import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  // Simple health check endpoint
  if (req.url.includes('?health=true')) {
    return Response.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      message: 'Function is running' 
    });
  }
  
  console.log('\n🎬 === VIDEO GENERATION REQUEST STARTED ===');
  console.log('Request method:', req.method);
  console.log('Request URL:', req.url);
  
  let base44, user, slides, videoTitle, requestBody;
  
  try {
    console.log('Step 1: Creating Base44 client...');
    base44 = createClientFromRequest(req);
    console.log('✅ Base44 client created');
    
    console.log('Step 2: Authenticating user...');
    user = await base44.auth.me();
    
    if (!user) {
      console.error('❌ Authentication failed - no user');
      return Response.json({ 
        error: 'Unauthorized',
        success: false,
        step_failed: 'authentication'
      }, { status: 401 });
    }
    console.log('✅ User authenticated:', user.email);

    console.log('Step 3: Parsing request body...');
    try {
      requestBody = await req.json();
      slides = requestBody.slides;
      videoTitle = requestBody.videoTitle;
      console.log('✅ Request parsed:', { 
        slideCount: slides?.length, 
        videoTitle,
        firstSlideHasImage: !!slides?.[0]?.imageUrl,
        firstSlideHasAudio: !!slides?.[0]?.audioUrl
      });
    } catch (parseError) {
      console.error('❌ Failed to parse request body:', parseError.message);
      return Response.json({
        error: 'Invalid request body: ' + parseError.message,
        success: false,
        step_failed: 'request_parsing'
      }, { status: 400 });
    }

    if (!slides || slides.length === 0) {
      console.error('❌ No slides provided');
      return Response.json({ error: 'No slides provided' }, { status: 400 });
    }

    console.log('Step 4: Checking FFmpeg availability...');
    // Check if FFmpeg is available
    let ffmpegAvailable = false;
    try {
      const ffmpegCheck = new Deno.Command("ffmpeg", {
        args: ["-version"],
        stdout: "piped",
        stderr: "piped"
      });
      const checkOutput = await ffmpegCheck.output();
      ffmpegAvailable = checkOutput.success;
      console.log('✅ FFmpeg available:', ffmpegAvailable);
    } catch (e) {
      console.warn('⚠️ FFmpeg not found:', e.message);
      console.warn('This is expected on Deno Deploy - will return slide assets for manual assembly');
      ffmpegAvailable = false;
    }

    // IMPORTANT: FFmpeg is NOT available on Deno Deploy
    // Return slide data for client-side assembly or manual download
    if (!ffmpegAvailable) {
      console.log('📦 FFmpeg not available - returning slide data for download');
      
      return Response.json({
        success: false,
        error: 'Video generation requires FFmpeg which is not available on this platform',
        message: 'Download slides individually or use a local video editor to combine them',
        slides: slides.map((slide, i) => ({
          number: i + 1,
          imageUrl: slide.imageUrl,
          audioUrl: slide.audioUrl,
          caption: slide.caption
        }))
      }, { status: 500 });
    }



    // FFmpeg is available - proceed with video generation
    const tempDir = await Deno.makeTempDir();
    
    try {
      console.log('🎬 Starting video generation with FFmpeg...');
      
      // Download all images and audio files
      const slideFiles = [];

      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];

        console.log(`\n📥 Processing slide ${i + 1}/${slides.length}:`, {
          hasImage: !!slide.imageUrl,
          hasAudio: !!slide.audioUrl,
          imageUrl: slide.imageUrl?.substring(0, 100)
        });

        // Download image with better error handling
        try {
          if (!slide.imageUrl) {
            throw new Error('No image URL provided');
          }

          const imageResponse = await fetch(slide.imageUrl, {
            signal: AbortSignal.timeout(30000) // 30 second timeout
          });
          
          if (!imageResponse.ok) {
            throw new Error(`HTTP ${imageResponse.status}: ${imageResponse.statusText}`);
          }
          
          const imageBlob = await imageResponse.blob();
          if (!imageBlob || imageBlob.size === 0) {
            throw new Error('Image download returned empty file');
          }
          
          const imageExt = slide.imageUrl.split('.').pop().split('?')[0] || 'jpg';
          const imagePath = `${tempDir}/slide_${i}.${imageExt}`;
          await Deno.writeFile(imagePath, new Uint8Array(await imageBlob.arrayBuffer()));
          console.log(`✓ Image downloaded: ${imagePath} (${imageBlob.size} bytes)`);

          // Download audio if exists
          let audioPath = null;
          let audioDuration = 5; // Default 5 seconds if no audio

          if (slide.audioUrl) {
            try {
              const audioResponse = await fetch(slide.audioUrl, {
                signal: AbortSignal.timeout(30000)
              });
              
              if (!audioResponse.ok) {
                console.warn(`⚠️ Audio download failed (${audioResponse.status}), will use silent audio`);
              } else {
                const audioBlob = await audioResponse.blob();
                if (audioBlob && audioBlob.size > 0) {
                  audioPath = `${tempDir}/audio_${i}.mp3`;
                  await Deno.writeFile(audioPath, new Uint8Array(await audioBlob.arrayBuffer()));
                  console.log(`✓ Audio downloaded: ${audioPath} (${audioBlob.size} bytes)`);

                  // Get audio duration using ffprobe
                  try {
                    const probeCmd = new Deno.Command("ffprobe", {
                      args: [
                        "-v", "error",
                        "-show_entries", "format=duration",
                        "-of", "default=noprint_wrappers=1:nokey=1",
                        audioPath
                      ],
                      stdout: "piped",
                      stderr: "piped"
                    });

                    const probeOutput = await probeCmd.output();
                    if (probeOutput.success) {
                      const durationStr = new TextDecoder().decode(probeOutput.stdout).trim();
                      audioDuration = parseFloat(durationStr) || 5;
                      console.log(`✓ Audio duration: ${audioDuration}s`);
                    } else {
                      console.warn(`⚠️ ffprobe failed, using default duration`);
                    }
                  } catch (probeError) {
                    console.warn(`⚠️ Failed to probe audio:`, probeError.message);
                  }
                }
              }
            } catch (audioError) {
              console.warn(`⚠️ Audio processing error:`, audioError.message);
            }
          }

          slideFiles.push({
            imagePath,
            audioPath,
            duration: audioDuration
          });
        } catch (imageError) {
          console.error(`❌ Failed to process slide ${i + 1}:`, imageError.message);
          throw new Error(`Slide ${i + 1} failed: ${imageError.message}`);
        }
      }

      console.log('Slide files prepared:', slideFiles.map((s, i) => ({
        slide: i + 1,
        hasAudio: !!s.audioPath,
        duration: s.duration
      })));

      // Create individual video segments first, then concatenate
      const segmentPaths = [];

      for (let i = 0; i < slideFiles.length; i++) {
        const { imagePath, audioPath, duration } = slideFiles[i];
        const segmentPath = `${tempDir}/segment_${i}.mp4`;

        console.log(`\n=== Creating segment ${i + 1}/${slideFiles.length} ===`);
        console.log(`Image: ${imagePath}`);
        console.log(`Audio: ${audioPath || 'NONE (will generate silence)'}`);
        console.log(`Duration: ${duration}s`);

        try {
          if (audioPath) {
            // Simpler approach: video with audio
            const segmentArgs = [
              "-loop", "1",
              "-i", imagePath,
              "-i", audioPath,
              "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=30",
              "-c:v", "libx264",
              "-preset", "ultrafast",
              "-crf", "23",
              "-c:a", "aac",
              "-b:a", "128k",
              "-shortest",
              "-movflags", "+faststart",
              "-y",
              segmentPath
            ];

            console.log(`FFmpeg command: ffmpeg ${segmentArgs.join(' ')}`);

            const segmentCmd = new Deno.Command("ffmpeg", {
              args: segmentArgs,
              stdout: "piped",
              stderr: "piped"
            });

            const segmentOutput = await segmentCmd.output();
            const stderrText = new TextDecoder().decode(segmentOutput.stderr);

            if (!segmentOutput.success) {
              console.error(`\n❌ SEGMENT ${i + 1} FAILED:`);
              console.error(stderrText);
              throw new Error(`Segment ${i + 1} failed: ${stderrText.slice(-300)}`);
            }

            console.log(`✅ Segment ${i + 1} created with audio`);

          } else {
            // Video with generated silent audio
            const segmentArgs = [
              "-loop", "1",
              "-t", duration.toString(),
              "-i", imagePath,
              "-f", "lavfi",
              "-t", duration.toString(),
              "-i", "anullsrc=r=44100:cl=stereo",
              "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=30",
              "-c:v", "libx264",
              "-preset", "ultrafast",
              "-crf", "23",
              "-c:a", "aac",
              "-b:a", "128k",
              "-movflags", "+faststart",
              "-y",
              segmentPath
            ];

            console.log(`FFmpeg command: ffmpeg ${segmentArgs.join(' ')}`);

            const segmentCmd = new Deno.Command("ffmpeg", {
              args: segmentArgs,
              stdout: "piped",
              stderr: "piped"
            });

            const segmentOutput = await segmentCmd.output();
            const stderrText = new TextDecoder().decode(segmentOutput.stderr);

            if (!segmentOutput.success) {
              console.error(`\n❌ SEGMENT ${i + 1} FAILED:`);
              console.error(stderrText);
              throw new Error(`Segment ${i + 1} failed: ${stderrText.slice(-300)}`);
            }

            console.log(`✅ Segment ${i + 1} created with silent audio`);
          }

          segmentPaths.push(segmentPath);

        } catch (error) {
          console.error(`\n❌ ERROR creating segment ${i + 1}:`, error.message);
          throw error;
        }
      }

      // Create concat file
      console.log('\n=== Concatenating segments ===');
      const concatFilePath = `${tempDir}/concat.txt`;
      const concatContent = segmentPaths.map(p => `file '${p}'`).join('\n');
      await Deno.writeTextFile(concatFilePath, concatContent);
      console.log('Concat file contents:');
      console.log(concatContent);

      const outputPath = `${tempDir}/output.mp4`;
      const concatArgs = [
        "-f", "concat",
        "-safe", "0",
        "-i", concatFilePath,
        "-c", "copy",
        "-movflags", "+faststart",
        "-y",
        outputPath
      ];

      console.log(`\nFFmpeg concat command: ffmpeg ${concatArgs.join(' ')}`);

      const concatCmd = new Deno.Command("ffmpeg", {
        args: concatArgs,
        stdout: "piped",
        stderr: "piped"
      });

      const concatOutput = await concatCmd.output();
      const concatStderr = new TextDecoder().decode(concatOutput.stderr);

      if (!concatOutput.success) {
        console.error('\n❌ CONCATENATION FAILED:');
        console.error(concatStderr);
        throw new Error(`Concatenation failed: ${concatStderr.slice(-300)}`);
      }

      console.log('\n✅ Video concatenation complete!');
      
      // Verify output file exists and has content
      const fileInfo = await Deno.stat(outputPath);
      console.log(`Output file size: ${fileInfo.size} bytes`);
      
      if (fileInfo.size === 0) {
        throw new Error('Generated video file is empty');
      }
      
      // Read the output video file
      const videoData = await Deno.readFile(outputPath);
      console.log(`Video data read: ${videoData.length} bytes`);
      
      const videoBlob = new Blob([videoData], { type: 'video/mp4' });
      const videoFile = new File([videoBlob], `${videoTitle || 'training'}_${Date.now()}.mp4`, { type: 'video/mp4' });
      
      console.log('Uploading video to storage...');
      console.log(`File details: name=${videoFile.name}, size=${videoFile.size}, type=${videoFile.type}`);
      
      // Upload to storage with error handling
      try {
        const uploadResult = await base44.integrations.Core.UploadFile({ file: videoFile });
        console.log('✅ Upload complete:', uploadResult.file_url);
        
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n🎉 VIDEO GENERATION COMPLETE in ${totalTime}s`);
        
        return Response.json({ 
          video_url: uploadResult.file_url,
          success: true,
          generation_time: totalTime
        });
      } catch (uploadError) {
        console.error('❌ Upload failed:', uploadError.message);
        console.error('Upload error details:', uploadError);
        throw new Error(`File upload failed: ${uploadError.message}`);
      }
      
    } catch (videoGenError) {
      console.error('\n❌ Video generation failed:', videoGenError.message);
      console.error('Stack:', videoGenError.stack);
      
      // Fallback: Create ZIP file with all assets
      console.log('📦 Falling back to ZIP file creation...');
      
      try {
        // Download all assets for ZIP
        for (let i = 0; i < slides.length; i++) {
          const slide = slides[i];

          // Download image if not already downloaded
          const imageExt = slide.imageUrl.split('.').pop().split('?')[0] || 'jpg';
          const imagePath = `${tempDir}/slide_${i + 1}.${imageExt}`;
          
          if (!(await Deno.stat(imagePath).catch(() => null))) {
            const imageResponse = await fetch(slide.imageUrl);
            const imageBlob = await imageResponse.blob();
            await Deno.writeFile(imagePath, new Uint8Array(await imageBlob.arrayBuffer()));
          }

          // Download audio if exists and not already downloaded
          if (slide.audioUrl) {
            const audioPath = `${tempDir}/slide_${i + 1}_audio.mp3`;
            if (!(await Deno.stat(audioPath).catch(() => null))) {
              const audioResponse = await fetch(slide.audioUrl);
              const audioBlob = await audioResponse.blob();
              await Deno.writeFile(audioPath, new Uint8Array(await audioBlob.arrayBuffer()));
            }
          }

          // Create a text file with slide info
          const slideInfo = `Slide ${i + 1}\nCaption: ${slide.caption || 'N/A'}\nNarration: ${slide.narration || 'N/A'}\n`;
          await Deno.writeTextFile(`${tempDir}/slide_${i + 1}_info.txt`, slideInfo);
        }

        // Create README
        const readme = `Training Video Assets\n\nVideo Title: ${videoTitle}\nSlides: ${slides.length}\n\nVideo generation failed, but all assets are here.\nUse any video editing software to combine these into your training video.\n\nError: ${videoGenError.message}`;
        await Deno.writeTextFile(`${tempDir}/README.txt`, readme);

        // Create zip
        const zipPath = `${tempDir}/training_assets.tar.gz`;
        const zipCmd = new Deno.Command("tar", {
          args: ["-czf", zipPath, "-C", tempDir, "."],
          stdout: "piped",
          stderr: "piped"
        });
        await zipCmd.output();

        // Upload zip
        const zipData = await Deno.readFile(zipPath);
        const zipBlob = new Blob([zipData], { type: 'application/gzip' });
        const zipFile = new File([zipBlob], `${videoTitle}_assets.tar.gz`, { type: 'application/gzip' });
        const uploadResult = await base44.integrations.Core.UploadFile({ file: zipFile });

        console.log('✅ ZIP fallback successful');

        return Response.json({
          video_url: uploadResult.file_url,
          success: true,
          message: 'Video generation failed - providing assets as ZIP file instead',
          original_error: videoGenError.message
        });
      } catch (zipError) {
        console.error('❌ ZIP fallback also failed:', zipError.message);
        throw new Error(`Video generation failed: ${videoGenError.message}. ZIP fallback also failed: ${zipError.message}`);
      }
    } finally {
      // Cleanup temp directory
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch (e) {
        console.error('Cleanup error:', e);
      }
    }

  } catch (error) {
    console.error('\n❌ === FATAL ERROR IN VIDEO GENERATION ===');
    console.error('Error message:', error?.message);
    console.error('Error name:', error?.name);
    console.error('Error stack:', error?.stack);
    
    // Try to serialize the entire error object
    try {
      console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    } catch (serializeError) {
      console.error('Could not serialize error:', serializeError.message);
    }
    
    // Include context about where the error occurred
    let errorContext = 'Unknown stage';
    if (!base44) errorContext = 'Creating Base44 client';
    else if (!user) errorContext = 'Authenticating user';
    else if (!slides) errorContext = 'Parsing request body';
    else errorContext = 'Processing video generation';
    
    console.error('Error occurred during:', errorContext);
    
    return Response.json({ 
      error: error?.message || 'Unknown error occurred',
      error_type: error?.name || 'Error',
      error_context: errorContext,
      details: error?.stack?.slice(0, 500) || 'No stack trace available',
      success: false 
    }, { status: 500 });
  }
});