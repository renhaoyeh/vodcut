import { ipcMain, BrowserWindow } from 'electron';
import https from 'https';
import fs from 'fs';
import { getProjectById, updateProject, settingsStore, projectPaths, writeProjectFile, readProjectFile } from './store';

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

// --------------- HTTP helper ---------------

function httpsPost(hostname: string, urlPath: string, headers: Record<string, string>, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname,
      path: urlPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) {
          reject(new Error(`API error (${res.statusCode}): ${text}`));
          return;
        }
        resolve(text);
      });
    });

    req.on('error', (err: Error) => reject(new Error(`API request failed: ${err.message}`)));
    req.setTimeout(300_000, () => {
      req.destroy();
      reject(new Error('API request timed out (300s)'));
    });
    req.write(body);
    req.end();
  });
}

// --------------- Groq ---------------

function callGroq(systemPrompt: string, userMessage: string, model: string): Promise<string> {
  const apiKey = settingsStore.get('groqApiKey', '') as string;
  if (!apiKey) return Promise.reject(new Error('Groq API key not set. Please configure it in Settings.'));

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  return httpsPost('api.groq.com', '/openai/v1/chat/completions', {
    'Authorization': `Bearer ${apiKey}`,
  }, body).then((text) => {
    const json = JSON.parse(text);
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error(`Groq returned empty response: ${text.slice(0, 500)}`);
    return content;
  });
}

// --------------- Gemini ---------------

function callGemini(systemPrompt: string, userMessage: string, model: string): Promise<string> {
  const apiKey = settingsStore.get('geminiApiKey', '') as string;
  if (!apiKey) return Promise.reject(new Error('Gemini API key not set. Please configure it in Settings.'));

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  return httpsPost('generativelanguage.googleapis.com', '/v1beta/openai/chat/completions', {
    'Authorization': `Bearer ${apiKey}`,
  }, body).then((text) => {
    const json = JSON.parse(text);
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error(`Gemini returned empty response: ${text.slice(0, 500)}`);
    return content;
  });
}

// --------------- Dispatcher ---------------

function callLLM(provider: string, model: string, systemPrompt: string, userMessage: string): Promise<string> {
  if (provider === 'gemini') return callGemini(systemPrompt, userMessage, model);
  return callGroq(systemPrompt, userMessage, model);
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
  ipcMain.handle('analyzer:analyze', async (event, projectId: string, provider: string, model: string) => {
    const project = getProjectById(projectId);
    if (!project) return { success: false, error: 'Project not found' };

    const paths = projectPaths(projectId);
    if (!fs.existsSync(paths.srt)) return { success: false, error: 'No SRT file. Transcribe first.' };

    const win = BrowserWindow.fromWebContents(event.sender);

    try {
      win?.webContents.send('analyzer:status', projectId, 'analyzing');

      const srtContent = fs.readFileSync(paths.srt, 'utf8');

      let analysisData: AnalysisData;

      if (provider === 'gemini') {
        // Gemini has large context — send everything at once
        const userMessage = `以下是逐字稿內容：\n\n${srtContent}`;
        const output = await callLLM(provider, model, SYSTEM_PROMPT, userMessage);
        analysisData = parseAnalysisResponse(output);
      } else {
        // Groq free tier — chunk if needed
        const tpm = GROQ_MODEL_TPM[model] ?? 12_000;
        const maxBlocks = Math.max(50, Math.floor((tpm - RESERVED_TOKENS) / TOKENS_PER_BLOCK));
        const chunks = splitSrtIntoChunks(srtContent, maxBlocks);

        const allSections: AnalysisSection[] = [];
        const allClips: AnalysisClip[] = [];

        for (let i = 0; i < chunks.length; i++) {
          const chunkLabel = chunks.length > 1 ? `（第 ${i + 1}/${chunks.length} 段）` : '';
          win?.webContents.send('analyzer:status', projectId, `analyzing${chunkLabel}`);

          const userMessage = `以下是逐字稿內容${chunkLabel}：\n\n${chunks[i]}`;
          const output = await callLLM(provider, model, SYSTEM_PROMPT, userMessage);
          const partial = parseAnalysisResponse(output);

          allSections.push(...partial.sections);
          allClips.push(...partial.clips);

          // Wait between chunks to respect rate limit
          if (i < chunks.length - 1) {
            await sleep(60_000);
          }
        }

        analysisData = { sections: allSections, clips: allClips };
      }

      // Save analysis to project folder
      writeProjectFile(paths.analysis, analysisData);

      win?.webContents.send('analyzer:status', projectId, 'done');
      return { success: true, data: analysisData };
    } catch (err) {
      win?.webContents.send('analyzer:status', projectId, 'error');
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('analyzer:getData', (_event, projectId: string) => {
    const paths = projectPaths(projectId);
    return readProjectFile<AnalysisData>(projectId, paths.analysis);
  });
}
