import { ipcMain, BrowserWindow, app } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { projectPaths, settingsStore } from './store';

// deep-filter-static exports the absolute path to the platform-specific binary
// (downloaded at npm install time, like ffmpeg-static).
const deepFilterPath: string = require('deep-filter-static');

// --------------- Denoise ---------------

export function isDenoiseAvailable(): boolean {
  return fs.existsSync(deepFilterPath);
}

export async function denoiseAudio(
  inputPath: string,
  outputPath: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (!fs.existsSync(deepFilterPath)) {
    throw new Error('DeepFilter binary not found. Run npm install.');
  }

  // deep-filter writes <filename> into --output-dir.
  // We use a temp dir then move the result to the desired outputPath.
  const tmpDir = path.join(app.getPath('temp'), `vodcut-denoise-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const proc = spawn(deepFilterPath, [
      inputPath,
      '-o', tmpDir,
    ], { windowsHide: true });

    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      // DeepFilterNet prints progress like "50%"
      const m = d.toString().match(/(\d+)%/);
      if (m) onProgress?.(parseInt(m[1], 10));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        reject(new Error(`deep-filter exited ${code}: ${stderr.slice(-400)}`));
        return;
      }

      // Find the output file in tmpDir (same basename as input)
      const outName = fs.readdirSync(tmpDir).find((f) => f.endsWith('.wav'));
      if (!outName) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        reject(new Error('deep-filter produced no output file'));
        return;
      }

      fs.renameSync(path.join(tmpDir, outName), outputPath);
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      onProgress?.(100);
      resolve();
    });

    proc.on('error', (err) => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      reject(err);
    });
  });
}

// --------------- IPC Handlers ---------------

export function registerDenoiseHandlers(): void {
  ipcMain.handle('denoise:isAvailable', () => {
    return isDenoiseAvailable();
  });

  ipcMain.handle('denoise:run', async (event, projectId: string) => {
    const paths = projectPaths(projectId);
    if (!fs.existsSync(paths.audio)) {
      return { success: false, error: 'Audio not extracted yet.' };
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    try {
      await denoiseAudio(paths.audio, paths.audioDenoised, (percent) => {
        win?.webContents.send('denoise:progress', projectId, percent);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('denoise:getEnabled', () => {
    return settingsStore.get('denoiseEnabled');
  });

  ipcMain.handle('denoise:setEnabled', (_event, enabled: boolean) => {
    settingsStore.set('denoiseEnabled', enabled);
    return { success: true };
  });
}
