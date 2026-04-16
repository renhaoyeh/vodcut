import { ipcMain, BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getProjectById, projectPaths, writeProjectFile, readProjectFile, modelToFilename } from './store';

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

// --------------- Claude CLI ---------------

async function callClaude(srtPath: string, model?: string, onProgress?: (chars: number) => void): Promise<string> {
  const prompt = `${SYSTEM_PROMPT}\n\n逐字稿檔案路徑：${srtPath}\n請讀取這個檔案並進行分析。`;

  return new Promise((resolve, reject) => {
    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--allowedTools', 'Read',
    ];
    if (model) {
      args.push('--model', model);
    }
    const proc = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let fullText = '';
    let stderr = '';

    let phase = 'thinking';  // thinking → reading → generating

    const rl = createInterface({ input: proc.stdout });
    rl.on('line', (line: string) => {
      if (!line.trim()) return;
      try {
        const evt = JSON.parse(line);
        const deltaType = evt.event?.delta?.type ?? '';

        // Track phase transitions for progress display
        if (deltaType === 'thinking_delta' && phase !== 'thinking') {
          phase = 'thinking';
        } else if (deltaType === 'input_json_delta' && phase !== 'reading') {
          phase = 'reading';
          onProgress?.(-1);  // signal "reading" phase
        } else if (deltaType === 'text_delta') {
          phase = 'generating';
          fullText += evt.event.delta.text;
          onProgress?.(fullText.length);
        }

        // Final result
        if (evt.type === 'result' && typeof evt.result === 'string') {
          fullText = evt.result;
        }
      } catch { /* skip non-JSON lines */ }
    });

    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`claude CLI failed (exit ${code}): ${stderr.trim()}`));
        return;
      }
      const output = fullText.trim();
      if (!output) {
        reject(new Error('claude CLI returned empty output'));
        return;
      }
      resolve(output);
    });

    proc.on('error', (err: Error) => {
      reject(new Error(`claude CLI failed: ${err.message}`));
    });
  });
}

// --------------- Parse ---------------

function parseAnalysisResponse(output: string): AnalysisData {
  let cleaned = output;

  // Strip markdown code fences if present
  if (cleaned.includes('```')) {
    cleaned = cleaned.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '');
  }

  // Try direct parse first
  let data: any;
  try {
    data = JSON.parse(cleaned.trim());
  } catch {
    // Extract JSON object from mixed text (Claude may add explanation before/after)
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`No JSON object found in LLM output.\n\nRaw:\n${output.slice(0, 500)}`);
    }
    try {
      data = JSON.parse(cleaned.slice(start, end + 1));
    } catch (e) {
      throw new Error(`LLM returned invalid JSON: ${(e as Error).message}\n\nRaw:\n${output.slice(0, 500)}`);
    }
  }

  if (!data.sections || !data.clips) {
    throw new Error(`LLM response missing 'sections' or 'clips'.`);
  }

  return data as AnalysisData;
}

// --------------- Main handler ---------------

export function registerAnalyzerHandlers(): void {
  ipcMain.handle('analyzer:analyze', async (event, projectId: string, requestedModel?: string) => {
    const project = getProjectById(projectId);
    if (!project) return { success: false, error: 'Project not found' };

    const paths = projectPaths(projectId);
    if (!fs.existsSync(paths.srt)) return { success: false, error: 'No SRT file. Transcribe first.' };

    const win = BrowserWindow.fromWebContents(event.sender);
    const model = requestedModel || 'claude';

    try {
      win?.webContents.send('analyzer:status', projectId, 'analyzing');

      const srtContent = fs.readFileSync(paths.srt, 'utf8');

      // Find the last timestamp in the SRT to clamp analysis results
      const maxMs = (() => {
        const matches = [...srtContent.matchAll(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g)];
        if (matches.length === 0) return Infinity;
        const last = matches[matches.length - 1];
        return (+last[1] * 3600 + +last[2] * 60 + +last[3]) * 1000 + +last[4];
      })();

      console.log(`[analyzer] using Claude CLI (model=${model}), srtLength=${srtContent.length} maxMs=${maxMs}`);

      // Write SRT to temp file to avoid command-line length limits
      const tmpPath = path.join(os.tmpdir(), `vodcut-${projectId}.srt`);
      fs.writeFileSync(tmpPath, srtContent, 'utf8');

      let analysisData: AnalysisData;
      try {
        const t0 = Date.now();
        const output = await callClaude(tmpPath, requestedModel || undefined, (chars) => {
          if (chars === -1) {
            // Reading file phase
            win?.webContents.send('analyzer:status', projectId, JSON.stringify({ key: 'player.analyzingReading' }));
          } else {
            // Generating response phase
            win?.webContents.send('analyzer:status', projectId, JSON.stringify({ key: 'player.analyzingProgress', chars }));
          }
        });
        console.log(`[analyzer] Claude done in ${((Date.now() - t0) / 1000).toFixed(1)}s (${output.length} chars)`);
        analysisData = parseAnalysisResponse(output);
      } finally {
        try { fs.unlinkSync(tmpPath); } catch {}
      }

      // Clamp timestamps
      for (const sec of analysisData.sections) {
        sec.startMs = Math.min(sec.startMs, maxMs);
        sec.endMs = Math.min(sec.endMs, maxMs);
      }
      for (const clip of analysisData.clips) {
        clip.startMs = Math.min(clip.startMs, maxMs);
        clip.endMs = Math.min(clip.endMs, maxMs);
      }

      // Save analysis
      if (!fs.existsSync(paths.analysisDir)) fs.mkdirSync(paths.analysisDir, { recursive: true });
      const modelFile = path.join(paths.analysisDir, `${modelToFilename(model)}.json`);
      writeProjectFile(modelFile, analysisData);

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

  ipcMain.handle('analyzer:getData', (_event, projectId: string) => {
    const paths = projectPaths(projectId);
    return readProjectFile<AnalysisData>(projectId, paths.analysis);
  });

  ipcMain.handle('analyzer:listModels', (_event, projectId: string) => {
    const paths = projectPaths(projectId);
    if (!fs.existsSync(paths.analysisDir)) return [];
    return fs.readdirSync(paths.analysisDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, '').replace(/_/g, '/'));
  });

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
