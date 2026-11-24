import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createAiAccessGuard, parseEmailList, readFirebaseProjectId } from './server/aiAccess.ts';

const PORT = Number(process.env.PORT) || 3000;
// 0.0.0.0 suits a container deploy. Set BIND_HOST=127.0.0.1 to keep a local server off the network.
const HOST = process.env.BIND_HOST?.trim() || '0.0.0.0';
const MODEL_NAME = 'gemini-4-hydrogen';

const CANONICAL_GENRES = [
  'Electronic',
  'Hip-Hop / Rap',
  'Pop',
  'Rock',
  'Indie / Alternative',
  'R&B / Soul',
  'Funk / Disco',
  'Jazz',
  'Blues',
  'Classical',
  'Metal',
  'Punk / Hardcore',
  'Country / Folk',
  'Latin / Afrobeats',
  'Reggae / Dub',
  'Ambient / Lo-Fi',
  'World / Global',
  'Soundtrack / Score',
  'Acoustic / Instrumental',
  'Podcast / Spoken',
] as const;

interface GenreClassifyInput {
  id: string;
  title: string;
  artist: string;
  album: string;
  fileName: string;
  relativePath: string;
  folderName: string;
  year: string;
  duration?: number;
  currentGenre?: string;
}

interface RawGenreClassification {
  trackId?: string;
  genre?: string;
  subgenre?: string;
  confidence?: string;
}

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

function readTrackArray<T>(body: unknown): Array<Partial<T>> {
  const raw = (body as { tracks?: unknown } | null | undefined)?.tracks;
  if (!Array.isArray(raw)) return [];
  // Drop null / primitive entries so the field mapping below cannot throw outside try/catch
  return raw.filter(
    (t): t is Partial<T> => typeof t === 'object' && t !== null && !Array.isArray(t)
  );
}

type AsyncHandler = (req: express.Request, res: express.Response) => Promise<void>;

// Express 4 does not catch rejected promises from async handlers; an escaped rejection
// crashes Node 22. Forward any error to Express's error handler instead.
function asyncRoute(handler: AsyncHandler): express.RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

async function startServer() {
  const app = express();

  // Every /api route spends Gemini quota, so each request needs a Google sign-in. The guard
  // runs before body parsing so an unauthenticated request is turned away without reading it.
  app.use(
    '/api',
    createAiAccessGuard({
      projectId: readFirebaseProjectId(path.resolve(process.cwd(), 'firebase-applet-config.json')),
      allowedEmails: parseEmailList(process.env.GEMINI_ALLOWED_EMAILS),
    })
  );
  app.use(express.json({ limit: '1mb' }));

  app.post('/api/metadata/suggest', asyncRoute(async (req, res) => {
    const tracks = readTrackArray<TrackLookupInput>(req.body);

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
  }));

  app.post('/api/genres/classify', asyncRoute(async (req, res) => {
    const tracks = readTrackArray<GenreClassifyInput>(req.body);

    if (tracks.length === 0) {
      res.status(400).json({ error: 'Provide at least one track to classify.' });
      return;
    }

    if (tracks.length > 60) {
      res.status(400).json({ error: 'A maximum of 60 tracks can be classified per request.' });
      return;
    }

    const ai = createGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'Deep genre classification is unavailable because GEMINI_API_KEY is not configured in Settings > Secrets.',
      });
      return;
    }

    const compactTracks = tracks.map((t) => ({
      trackId: String(t.id ?? ''),
      title: String(t.title ?? ''),
      artist: String(t.artist ?? ''),
      album: String(t.album ?? ''),
      fileName: String(t.fileName ?? ''),
      folderName: String(t.folderName ?? ''),
      relativePath: String(t.relativePath ?? ''),
      year: String(t.year ?? ''),
      durationSec:
        typeof t.duration === 'number' && Number.isFinite(t.duration) ? Math.round(t.duration) : 0,
      currentGenre: String(t.currentGenre ?? ''),
    }));

    const prompt = [
      'Classify each audio track below into its most accurate primary music genre using your music knowledge of the artist, album, track title, filename, and folder context.',
      `Prefer one of these canonical genres whenever appropriate: ${CANONICAL_GENRES.join(', ')}.`,
      'If a track clearly belongs to a distinct genre outside that list, provide a concise standard genre name (2-3 words max).',
      'Do NOT return "Other", "Unknown", "Misc", or "General". Only return an empty string "" if the file has zero identifiable artist/title/album cues (e.g. "audio_001.mp3" with Unknown Artist).',
      'Also return a concise subgenre when identifiable (e.g. "Deep House", "Boom Bap", "Shoegaze", "Neo-Soul", "Classic Rock", "Baroque").',
      '',
      'Tracks to classify:',
      JSON.stringify(compactTracks, null, 2),
    ].join('\n');

    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'You are a musicologist and audio library curator. Accurately classify tracks by artist, album, title, and filename cues into clean canonical music genres. Return valid JSON matching the schema.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              classifications: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    trackId: {
                      type: Type.STRING,
                      description: 'Exact trackId from the input array.',
                    },
                    genre: {
                      type: Type.STRING,
                      description: 'Accurate primary music genre, or empty string if completely unidentifiable.',
                    },
                    subgenre: {
                      type: Type.STRING,
                      description: 'Specific subgenre if known, else empty string.',
                    },
                    confidence: {
                      type: Type.STRING,
                      description: 'Confidence level: high, medium, or low.',
                    },
                  },
                  required: ['trackId', 'genre', 'confidence'],
                },
              },
            },
            required: ['classifications'],
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const jsonCandidate = fenced ? fenced[1].trim() : rawText;
      const parsed = JSON.parse(jsonCandidate) as {
        classifications?: RawGenreClassification[];
      };

      const allowedIds = new Set(compactTracks.map((t) => t.trackId));
      const bannedOutputs = new Set([
        'other',
        'unknown',
        'unclassified',
        'untagged',
        'misc',
        'miscellaneous',
        'general',
        'none',
        'n/a',
      ]);

      const rawList = Array.isArray(parsed.classifications) ? parsed.classifications : [];
      const classifications = rawList
        .filter((item) => typeof item?.trackId === 'string' && allowedIds.has(item.trackId))
        .map((item) => {
          const cleanGenre = typeof item.genre === 'string' ? item.genre.trim() : '';
          const validGenre =
            cleanGenre && !bannedOutputs.has(cleanGenre.toLowerCase()) ? cleanGenre : '';
          const cleanSub = typeof item.subgenre === 'string' ? item.subgenre.trim() : '';
          return {
            trackId: item.trackId!,
            genre: validGenre,
            subgenre: cleanSub,
            confidence: sanitizeConfidence(item.confidence),
          };
        })
        .filter((item) => item.genre.length > 0);

      res.json({ classifications });
    } catch (err: unknown) {
      const errorObj = err as { status?: number; message?: string };
      const statusCode =
        typeof errorObj?.status === 'number' && errorObj.status >= 400 && errorObj.status < 600
          ? errorObj.status
          : 500;
      const rawMsg = errorObj?.message || 'Deep genre classification failed.';
      let friendlyMessage = rawMsg;

      if (
        statusCode === 403 ||
        rawMsg.includes('API_KEY_INVALID') ||
        rawMsg.includes('PERMISSION_DENIED')
      ) {
        friendlyMessage =
          'API key rejected by Gemini API. Please check your GEMINI_API_KEY in Settings > Secrets.';
      } else if (statusCode === 429 || rawMsg.includes('RESOURCE_EXHAUSTED')) {
        friendlyMessage =
          'Rate limit reached for genre classification. Wait a moment and try again.';
      }

      res.status(statusCode).json({ error: friendlyMessage });
    }
  }));

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
    // Firebase authorizes Google sign-in on localhost but not on 127.0.0.1, so point there.
    console.log(`CrateSync server listening on ${HOST}:${PORT}, open http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start CrateSync server:', err);
  process.exit(1);
});
