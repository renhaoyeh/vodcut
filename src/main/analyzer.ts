import { ipcMain, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { getProjectById, settingsStore, projectPaths, writeProjectFile, readProjectFile, saveGroqRateLimits, saveGroqError, clearGroqError, modelToFilename } from './store';
import { getGroqClient, extractRateLimitHeaders } from './groq-client';

const SYSTEM_PROMPT = `你是一位專業的影片剪輯顧問。使用者會給你一段影片的逐字稿（SRT 格式，含時間戳記），
請你分析內容並以 **純 JSON** 回傳（不要加 markdown code fence），格式如下：

{
  "sections": [
    {
      "title": "段落標題",
      "startMs": 0,
      "endMs": 150000,
      "summary": "這段在講什麼"
    }
  ],
  "clips": [
    {
      "title": "建議短片標題",
      "startMs": 60000,
      "endMs": 180000,
      "reason": "推薦理由"
    }
  ]
}

規則：
- sections 是整支影片的段落大綱，應連續且不重疊，涵蓋這段逐字稿的所有內容。切分粒度要細：每個段落只涵蓋一個主題或論點，不要把多個主題合併成一段（例如避免「A與B」這種標題）。寧可多切幾段也不要少切
- clips 是推薦剪成 YouTube 短片的片段，可與 sections 重疊
- **時間精準度**：startMs 和 endMs 必須取自 SRT 中實際出現的字幕時間戳（換算成毫秒）。找到主題轉換處最近的那條字幕，用它的開始時間作為 startMs 或結束時間作為 endMs。絕對不要自己湊整數或估算
- title 和 summary 請用繁體中文
- 只回傳 JSON，不要有任何其他文字`;

export interface AnalysisSection {
  title: string;
  startMs: number;
  endMs: number;
  summary: string;
}

export interface AnalysisClip {
  title: string;
  startMs: number;
  endMs: number;
  reason: string;
}

export interface AnalysisData {
  sections: AnalysisSection[];
  clips: AnalysisClip[];
}

// --------------- Groq ---------------

async function callGroq(systemPrompt: string, userMessage: string, model: string): Promise<string> {
  const apiKey = settingsStore.get('groqApiKey', '') as string;
  if (!apiKey) throw new Error('Groq API key not set. Please configure it in Settings.');

  const client = getGroqClient(apiKey);
  try {
    const { data, response } = await client.chat.completions
      .create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      })
      .withResponse();

    saveGroqRateLimits(apiKey, extractRateLimitHeaders(response));
    clearGroqError(apiKey);

    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`Groq returned empty response: ${JSON.stringify(data).slice(0, 500)}`);
    return content;
  } catch (err) {
    saveGroqError(apiKey, (err as Error).message);
    throw err;
  }
}

// --------------- Chunking (for Groq free tier) ---------------

const TOKENS_PER_BLOCK = 30;
const RESERVED_TOKENS = 3500;

const GROQ_MODEL_TPM: Record<string, number> = {
  'llama-3.3-70b-versatile': 12_000,
  'llama-3.1-8b-instant': 6_000,
  'meta-llama/llama-4-scout-17b-16e-instruct': 30_000,
};

function splitSrtIntoChunks(srtContent: string, maxBlocks: number): string[] {
  const blocks = srtContent.split(/\n\s*\n/).filter((b) => b.trim());
  const chunks: string[] = [];
  for (let i = 0; i < blocks.length; i += maxBlocks) {
    chunks.push(blocks.slice(i, i + maxBlocks).join('\n\n'));
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --------------- Parse ---------------

function parseAnalysisResponse(output: string): AnalysisData {
  let cleaned = output;
  if (cleaned.startsWith('```')) {
    const lines = cleaned.split('\n');
    cleaned = lines.filter((l) => !l.trim().startsWith('```')).join('\n');
  }

  let data: any;
  try {
    data = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`LLM returned invalid JSON: ${(e as Error).message}\n\nRaw:\n${output.slice(0, 500)}`);
  }

  if (!data.sections || !data.clips) {
    throw new Error(`LLM response missing 'sections' or 'clips'.`);
  }

  return data as AnalysisData;
}

// --------------- Main handler ---------------

export function registerAnalyzerHandlers(): void {
  ipcMain.handle('analyzer:analyze', async (event, projectId: string, _provider: string, model: string) => {
    const project = getProjectById(projectId);
    if (!project) return { success: false, error: 'Project not found' };

    const paths = projectPaths(projectId);
    if (!fs.existsSync(paths.srt)) return { success: false, error: 'No SRT file. Transcribe first.' };

    const win = BrowserWindow.fromWebContents(event.sender);

    try {
      win?.webContents.send('analyzer:status', projectId, 'analyzing');

      const srtContent = fs.readFileSync(paths.srt, 'utf8');

      const tpm = GROQ_MODEL_TPM[model] ?? 12_000;
      const maxBlocks = Math.max(50, Math.floor((tpm - RESERVED_TOKENS) / TOKENS_PER_BLOCK));
      const chunks = splitSrtIntoChunks(srtContent, maxBlocks);

      // Find the last timestamp in the SRT to clamp analysis results
      const maxMs = (() => {
        const matches = [...srtContent.matchAll(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g)];
        if (matches.length === 0) return Infinity;
        const last = matches[matches.length - 1];
        return (+last[1] * 3600 + +last[2] * 60 + +last[3]) * 1000 + +last[4];
      })();

      console.log(`[analyzer] model=${model} tpm=${tpm} maxBlocks=${maxBlocks} chunks=${chunks.length} srtLength=${srtContent.length} maxMs=${maxMs}`);

      // Resume from saved progress
      interface AnalysisProgress {
        model: string;
        currentChunk: number;
        numChunks: number;
        sections: AnalysisSection[];
        clips: AnalysisClip[];
      }
      const saved = readProjectFile<AnalysisProgress>(projectId, paths.analysisProgress);
      const canResume = saved && saved.model === model && saved.numChunks === chunks.length && saved.currentChunk < chunks.length;

      const allSections: AnalysisSection[] = canResume ? saved.sections : [];
      const allClips: AnalysisClip[] = canResume ? saved.clips : [];
      let startChunk = canResume ? saved.currentChunk : 0;

      if (canResume) {
        console.log(`[analyzer] resuming from chunk ${startChunk + 1}/${chunks.length}`);
        win?.webContents.send('analyzer:status', projectId, JSON.stringify({ key: 'player.analyzingResume', current: startChunk, total: chunks.length }));
      }

      for (let i = startChunk; i < chunks.length; i++) {
        const chunkLabel = chunks.length > 1 ? JSON.stringify({ key: 'player.analyzingChunk', current: i + 1, total: chunks.length }) : 'analyzing';
        win?.webContents.send('analyzer:status', projectId, chunkLabel);

        const userMessage = `以下是逐字稿內容${chunkLabel}（注意：這段逐字稿的時間範圍到 ${maxMs} 毫秒為止，所有時間戳不得超過此值）：\n\n${chunks[i]}`;
        console.log(`[analyzer] chunk ${i + 1}/${chunks.length} sending (${userMessage.length} chars)...`);
        const t0 = Date.now();
        const output = await callGroq(SYSTEM_PROMPT, userMessage, model);
        console.log(`[analyzer] chunk ${i + 1}/${chunks.length} done in ${((Date.now() - t0) / 1000).toFixed(1)}s (${output.length} chars)`);
        const partial = parseAnalysisResponse(output);

        allSections.push(...partial.sections);
        allClips.push(...partial.clips);

        // Persist progress after each chunk
        writeProjectFile(paths.analysisProgress, {
          model, currentChunk: i + 1, numChunks: chunks.length,
          sections: allSections, clips: allClips,
        });

        // Wait between chunks to respect rate limit
        if (i < chunks.length - 1) {
          console.log(`[analyzer] waiting 60s for rate limit...`);
          // Send countdown updates every second
          for (let s = 60; s > 0; s--) {
            win?.webContents.send('analyzer:status', projectId, JSON.stringify({ key: 'player.analyzingWait', seconds: s, current: i + 1, total: chunks.length }));
            await sleep(1_000);
          }
        }
      }

      // Clean up progress file
      try { fs.unlinkSync(paths.analysisProgress); } catch {}

      // Clamp timestamps to SRT duration
      for (const sec of allSections) {
        sec.startMs = Math.min(sec.startMs, maxMs);
        sec.endMs = Math.min(sec.endMs, maxMs);
      }
      for (const clip of allClips) {
        clip.startMs = Math.min(clip.startMs, maxMs);
        clip.endMs = Math.min(clip.endMs, maxMs);
      }

      const analysisData: AnalysisData = { sections: allSections, clips: allClips };

      // Save analysis per model
      if (!fs.existsSync(paths.analysisDir)) fs.mkdirSync(paths.analysisDir, { recursive: true });
      const modelFile = path.join(paths.analysisDir, `${modelToFilename(model)}.json`);
      writeProjectFile(modelFile, analysisData);

      // Also keep legacy analysis.json (latest result) + copy next to video
      writeProjectFile(paths.analysis, analysisData);
      const videoDir = path.dirname(project.filePath);
      const videoName = path.basename(project.filePath, path.extname(project.filePath));
      try { fs.writeFileSync(path.join(videoDir, `${videoName}.analysis.json`), JSON.stringify(analysisData, null, 2), 'utf8'); } catch {}

      win?.webContents.send('analyzer:status', projectId, 'done');
      return { success: true, data: analysisData, model };
    } catch (err) {
      win?.webContents.send('analyzer:status', projectId, 'error');
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('analyzer:getProgress', (_event, projectId: string) => {
    const paths = projectPaths(projectId);
    return readProjectFile<{ model: string; currentChunk: number; numChunks: number }>(projectId, paths.analysisProgress);
  });

  ipcMain.handle('analyzer:getData', (_event, projectId: string) => {
    const paths = projectPaths(projectId);
    return readProjectFile<AnalysisData>(projectId, paths.analysis);
  });

  /** List all saved analysis models for a project, in ANALYSIS_MODELS order. */
  ipcMain.handle('analyzer:listModels', (_event, projectId: string) => {
    const paths = projectPaths(projectId);
    if (!fs.existsSync(paths.analysisDir)) return [];
    const saved = new Set(
      fs.readdirSync(paths.analysisDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, '').replace(/_/g, '/'))
    );
    // Return in canonical model order, then any unknown models at the end
    const MODEL_ORDER = [
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
    ];
    const ordered = MODEL_ORDER.filter((m) => saved.has(m));
    for (const m of saved) {
      if (!ordered.includes(m)) ordered.push(m);
    }
    return ordered;
  });

  /** Load analysis for a specific model. */
  ipcMain.handle('analyzer:getDataForModel', (_event, projectId: string, model: string) => {
    const paths = projectPaths(projectId);
    const modelFile = path.join(paths.analysisDir, `${modelToFilename(model)}.json`);
    try {
      return JSON.parse(fs.readFileSync(modelFile, 'utf8')) as AnalysisData;
    } catch {
      return null;
    }
  });
}
