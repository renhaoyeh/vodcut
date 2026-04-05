import { ipcMain, BrowserWindow } from 'electron';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { getProjectById, updateProject, settingsStore } from './store';

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
- sections 是整支影片的段落大綱，應連續且不重疊，涵蓋整部影片。切分粒度要細：每個段落只涵蓋一個主題或論點，不要把多個主題合併成一段（例如避免「A與B」這種標題）。寧可多切幾段也不要少切
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

function callGroqChat(systemPrompt: string, userMessage: string): Promise<string> {
  const apiKey = settingsStore.get('analysisApiKey', '') as string;
  if (!apiKey) {
    return Promise.reject(new Error('Groq Analysis API key not set. Please configure it in Settings.'));
  }

  const body = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) {
          reject(new Error(`Groq API error (${res.statusCode}): ${text}`));
          return;
        }
        try {
          const json = JSON.parse(text);
          const content = json.choices?.[0]?.message?.content;
          if (!content) {
            reject(new Error(`Groq returned empty response: ${text.slice(0, 500)}`));
            return;
          }
          resolve(content);
        } catch {
          reject(new Error(`Invalid Groq response: ${text.slice(0, 500)}`));
        }
      });
    });

    req.on('error', (err: Error) => reject(new Error(`Groq API request failed: ${err.message}`)));
    req.setTimeout(300_000, () => {
      req.destroy();
      reject(new Error('Groq API timed out (300s)'));
    });
    req.write(body);
    req.end();
  });
}

function parseAnalysisResponse(output: string): AnalysisData {
  // Strip markdown code fences if present
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

export function registerAnalyzerHandlers(): void {
  ipcMain.handle('analyzer:analyze', async (event, projectId: string) => {
    const project = getProjectById(projectId);
    if (!project) return { success: false, error: 'Project not found' };
    if (!project.srtPath) return { success: false, error: 'No SRT file. Transcribe first.' };
    if (!fs.existsSync(project.srtPath)) return { success: false, error: `SRT file not found: ${project.srtPath}` };

    const win = BrowserWindow.fromWebContents(event.sender);

    try {
      win?.webContents.send('analyzer:status', projectId, 'analyzing');

      const srtContent = fs.readFileSync(project.srtPath, 'utf8');
      const userMessage = `以下是逐字稿內容：\n\n${srtContent}`;

      const output = await callGroqChat(SYSTEM_PROMPT, userMessage);
      const analysisData = parseAnalysisResponse(output);

      // Save JSON file next to the video
      const videoDir = path.dirname(project.filePath);
      const videoName = path.basename(project.filePath, path.extname(project.filePath));
      const analysisPath = path.join(videoDir, `${videoName}.analysis.json`);
      fs.writeFileSync(analysisPath, JSON.stringify(analysisData, null, 2), 'utf8');

      updateProject(projectId, { analysisData, analysisPath });

      win?.webContents.send('analyzer:status', projectId, 'done');
      return { success: true, data: analysisData };
    } catch (err) {
      win?.webContents.send('analyzer:status', projectId, 'error');
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('analyzer:getData', (_event, projectId: string) => {
    const project = getProjectById(projectId);
    return project?.analysisData ?? null;
  });
}
