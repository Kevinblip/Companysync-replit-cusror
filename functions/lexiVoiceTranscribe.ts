import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import OpenAI from 'npm:openai@4.77.0';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const openai = new OpenAI({
            apiKey: Deno.env.get('Open_AI_Api_Key')
        });

        // Get audio blob from request
        const formData = await req.formData();
        const audioBlob = formData.get('audio');

        if (!audioBlob) {
            console.error('❌ No audio blob in FormData');
            return Response.json({ 
                error: 'No audio provided',
                fallback: true 
            }, { status: 200 });
        }

            console.log('🎤 Starting audio transcription...');
            console.log('📊 Audio blob size:', audioBlob.size, 'bytes');
            console.log('📊 Audio blob type:', audioBlob.type);
            console.log('📊 Audio blob name:', audioBlob.name);

        // Validate audio size (Whisper requires at least 0.1 seconds of audio)
        if (audioBlob.size < 3000) {
            console.warn('⚠️ Audio too small (<3KB), using browser fallback');
            return Response.json({
                success: false,
                error: 'Audio too short',
                fallback: true
            }, { status: 200 });
        }

        if (audioBlob.size > 25 * 1024 * 1024) {
            console.warn('⚠️ Audio too large (>25MB), using browser fallback');
            return Response.json({
                success: false,
                error: 'Audio file too large',
                fallback: true
            }, { status: 200 });
        }

        try {
            // Just use the blob directly if it's already a File/Blob
            let audioFile = audioBlob;

            // If it's not already a File, create one
            if (!(audioBlob instanceof File)) {
                const audioBuffer = await audioBlob.arrayBuffer();

                if (audioBuffer.byteLength === 0) {
                    console.warn('⚠️ Empty audio buffer');
                    return Response.json({
                        success: false,
                        error: 'Empty audio',
                        fallback: true
                    }, { status: 200 });
                }

                // Whisper supports: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm
                // Default to mp3 for best compatibility
                const fileName = 'audio.mp3';
                const mimeType = 'audio/mpeg';

                audioFile = new File([audioBuffer], fileName, { type: mimeType });
                console.log('📤 Created MP3 file:', audioBuffer.byteLength, 'bytes');
            } else {
                console.log('📤 Using uploaded file directly:', audioFile.name, audioFile.size, 'bytes');
            }

            console.log('🚀 Calling Whisper API...');

            // Call Whisper
            const transcription = await openai.audio.transcriptions.create({
                file: audioFile,
                model: 'whisper-1',
                response_format: 'text'
            });

            const text = typeof transcription === 'string' ? transcription : transcription.text;

            if (!text || text.trim().length === 0) {
                console.warn('⚠️ Empty transcription');
                return Response.json({
                    success: false,
                    error: 'No speech detected',
                    fallback: true
                }, { status: 200 });
            }

            console.log('✅ Whisper success:', text);

            return Response.json({
                success: true,
                text: text
            });

        } catch (whisperError) {
            console.error('❌ Whisper failed:', whisperError.message);
            console.error('📋 Full error:', JSON.stringify(whisperError, null, 2));

            // Log OpenAI-specific error details
            if (whisperError.status) {
                console.error('📋 HTTP Status:', whisperError.status);
            }
            if (whisperError.error) {
                console.error('📋 Error object:', JSON.stringify(whisperError.error));
            }

            // Always fallback gracefully
            return Response.json({
                success: false,
                error: whisperError.message || 'Transcription failed',
                fallback: true
            }, { status: 200 });
        }

    } catch (error) {
        console.error('❌ Transcription error:', error);
        return Response.json({
            error: error.message,
            success: false,
            fallback: true
        }, { status: 500 });
    }
});