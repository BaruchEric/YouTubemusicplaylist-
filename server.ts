import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const MODEL_NAME = 'gemini-4-hydrogen';

interface TrackLookupInput {
  id: string;
  fileName: string;
  relativePath: string;
  folderName: string;
  title: string;
  artist: string;
  album: string;
  year: string;
  duration?: number;
}

interface RawSuggestion {
  trackId?: string;
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  confidence?: string;
  reason?: string;
}

interface SearchSource {
  title: string;
  uri: string;
}

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractJsonPayload(rawText: string): { suggestions?: RawSuggestion[] } {
  const trimmed = rawText.trim();
  if (!trimmed) return { suggestions: [] };

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate) as { suggestions?: RawSuggestion[] };
  } catch {
    const startIdx = candidate.indexOf('{');
    const endIdx = candidate.lastIndexOf('}');
    if (startIdx >= 0 && endIdx > startIdx) {
      return JSON.parse(candidate.slice(startIdx, endIdx + 1)) as {
        suggestions?: RawSuggestion[];
      };
    }
    throw new Error('Could not parse structured metadata response from Google Search lookup.');
  }
}

function sanitizeYear(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  const match = String(raw).match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : '';
}

function sanitizeConfidence(raw: unknown): 'high' | 'medium' | 'low' {
  const norm = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (norm === 'high' || norm === 'medium' || norm === 'low') return norm;
  return 'medium';
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/api/metadata/suggest', async (req, res) => {
    const body = req.body as { tracks?: TrackLookupInput[] } | undefined;
    const tracks = Array.isArray(body?.tracks) ? body.tracks : [];

    if (tracks.length === 0) {
      res.status(400).json({ error: 'Provide at least one track to look up.' });
      return;
    }

    if (tracks.length > 25) {
      res.status(400).json({ error: 'A maximum of 25 tracks can be queried per request.' });
      return;
    }

    const ai = createGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'Google Search metadata lookup is unavailable because GEMINI_API_KEY is not configured in Settings > Secrets.',
      });
      return;
    }

    const compactTracks = tracks.map((t) => ({
      trackId: String(t.id ?? ''),
      fileName: String(t.fileName ?? ''),
      relativePath: String(t.relativePath ?? ''),
      folderName: String(t.folderName ?? ''),
      currentTitle: String(t.title ?? ''),
      currentArtist: String(t.artist ?? ''),
      currentAlbum: String(t.album ?? ''),
      currentYear: String(t.year ?? ''),
      durationSec: typeof t.duration === 'number' && Number.isFinite(t.duration) ? Math.round(t.duration) : 0,
    }));

    const prompt = [
      'Cross-reference the following local audio files using Google Search to identify accurate recording metadata (artist, album, original 4-digit release year, and clean canonical title).',
      'Use filename patterns (e.g. "01 - Artist - Track.flac", "track_name_320kbps.mp3"), parent folder/album path structure (e.g. "Artist/2013 - Album/01 Track.mp3"), and sibling tracks from the same folder to infer shared album releases accurately.',
      'Only return values you can verify via search or reliably cross-reference from the release discography. Leave any uncertain field as an empty string "" and mark confidence honestly as "high", "medium", or "low".',
      '',
      'Tracks to identify:',
      JSON.stringify(compactTracks, null, 2),
    ].join('\n');

    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          systemInstruction:
            'You are a music discography metadata specialist. Always use Google Search grounding to verify artist names, official album/EP/single titles, and 4-digit release years for audio files. Return concise, accurate JSON matching the schema without inventing uncertain metadata.',
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    trackId: {
                      type: Type.STRING,
                      description: 'Exact trackId from the input array.',
                    },
                    title: {
                      type: Type.STRING,
                      description: 'Clean canonical song title if identified, else empty string.',
                    },
                    artist: {
                      type: Type.STRING,
                      description: 'Verified primary artist name, or empty string if uncertain.',
                    },
                    album: {
                      type: Type.STRING,
                      description: 'Verified album, EP, or single name, or empty string if uncertain.',
                    },
                    year: {
                      type: Type.STRING,
                      description: '4-digit original release year (YYYY), or empty string if uncertain.',
                    },
                    confidence: {
                      type: Type.STRING,
                      description: 'Confidence level: high, medium, or low.',
                    },
                    reason: {
                      type: Type.STRING,
                      description: 'Brief 1-sentence note citing the matched release or filename cue.',
                    },
                  },
                  required: ['trackId', 'artist', 'album', 'year', 'confidence'],
                },
              },
            },
            required: ['suggestions'],
          },
        },
      });

      const parsed = extractJsonPayload(response.text ?? '{}');
      const allowedIds = new Set(compactTracks.map((t) => t.trackId));
      const rawList = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];

      const suggestions = rawList
        .filter((item) => typeof item?.trackId === 'string' && allowedIds.has(item.trackId))
        .map((item) => ({
          trackId: item.trackId!,
          title: typeof item.title === 'string' ? item.title.trim() : '',
          artist: typeof item.artist === 'string' ? item.artist.trim() : '',
          album: typeof item.album === 'string' ? item.album.trim() : '',
          year: sanitizeYear(item.year),
          confidence: sanitizeConfidence(item.confidence),
          reason: typeof item.reason === 'string' ? item.reason.trim() : '',
        }));

      const rawChunks =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const seenUris = new Set<string>();
      const sources: SearchSource[] = [];
      for (const chunk of rawChunks) {
        const uri = chunk?.web?.uri?.trim();
        if (!uri || seenUris.has(uri)) continue;
        seenUris.add(uri);
        sources.push({
          uri,
          title: chunk?.web?.title?.trim() || uri,
        });
      }

      res.json({
        suggestions,
        sources: sources.slice(0, 12),
      });
    } catch (err: unknown) {
      const errorObj = err as { status?: number; message?: string };
      const statusCode =
        typeof errorObj?.status === 'number' && errorObj.status >= 400 && errorObj.status < 600
          ? errorObj.status
          : 500;
      const rawMsg = errorObj?.message || 'Metadata lookup request failed.';
      let friendlyMessage = rawMsg;

      if (statusCode === 403 || rawMsg.includes('API_KEY_INVALID') || rawMsg.includes('PERMISSION_DENIED')) {
        friendlyMessage =
          'API key rejected by Gemini API. Please check your GEMINI_API_KEY in Settings > Secrets.';
      } else if (statusCode === 429 || rawMsg.includes('RESOURCE_EXHAUSTED')) {
        friendlyMessage =
          'Rate limit reached for Google Search metadata lookup. Wait a moment and try again.';
      }

      res.status(statusCode).json({ error: friendlyMessage });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`CrateSync server listening on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start CrateSync server:', err);
  process.exit(1);
});
