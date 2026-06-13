import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fsp, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { parseFITSHeader, wcsToCorrespondences } from './wcs-reader.js';
import type { WCSData } from './wcs-reader.js';
import { normalizeDSOAliases } from './dso-utils.js';
import { getSetting } from './db.js';
import { shouldUseWSL, wrapExecForWSL, wslPath } from './wsl-utils.js';
import { msg } from './messages.js';
import type { ServerLang } from './messages.js';

const execFileAsync = promisify(execFile);

const loggedVersions = new Set<string>();
async function logSolverVersion(bin: string, versionArgs: string[], useWSL: boolean): Promise<void> {
  if (loggedVersions.has(bin)) return;
  loggedVersions.add(bin);
  try {
    const exec = wrapExecForWSL(bin, versionArgs, useWSL);
    const { stdout } = await execFileAsync(exec.cmd, exec.args, { timeout: 5_000 });
    console.log(`[solve-field] version: ${stdout.trim().split('\n')[0]}`);
  } catch {
    console.log(`[solve-field] version check failed for: ${bin}`);
  }
}

interface SolveResult {
  success: boolean;
  correspondences?: Array<{
    pointIndex: number;
    photoX: number;
    photoY: number;
    starHip: number;
    starName: string;
  }>;
  error?: string;
  diagnostics?: string; // raw solver output shown in collapsible details
  dsoIds?: string[];
}

function getSolveFieldBin(): string {
  return getSetting('SOLVE_FIELD_PATH') || 'solve-field';
}

function getAstrometryDataDir(): string | undefined {
  return getSetting('ASTROMETRY_DATA_DIR');
}

function useWSLForSolveField(): boolean {
  return shouldUseWSL(getSetting('USE_WSL_FOR_SOLVE_FIELD'));
}

export async function solveWithSolveField(
  buffer: Buffer,
  ext: string,
  width: number,
  height: number,
  hints?: { ra?: number; dec?: number; fov?: number; radius?: number },
  lang: ServerLang = 'en',
  signal?: AbortSignal,
): Promise<SolveResult> {
  const bin = getSolveFieldBin();
  const useWSL = useWSLForSolveField();
  void logSolverVersion(bin, ['--version'], useWSL);
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'solve-field-'));
  const imgName = `input${ext}`;
  const imgPath = path.join(tmpDir, imgName);
  const wcsPath = path.join(tmpDir, 'input.wcs');

  try {
    // Write the original buffer to temp file WITHOUT rotation
    // solve-field will solve it in its original orientation
    await fsp.writeFile(imgPath, buffer);
    
    console.log(`[solve-field] Image dimensions: ${width}×${height}`);

    // Build solve-field command
    const args = [
      wslPath(imgPath, useWSL),
      '--overwrite',           // Allow overwriting output files
      '--no-plots',            // Skip visualization generation for speed
      '--crpix-center',        // Use image center as reference pixel
      '--no-verify',           // Skip verification plots
      '--no-remove-lines',     // Don't remove temp files (we do it)
      '--uniformize', '0',     // Disable Python uniformize step (requires pyfits/astropy)
      '--dir', wslPath(tmpDir, useWSL), // Output directory
    ];
    
    // Add scale hints if FOV is provided
    if (hints?.fov !== undefined && hints.fov > 0) {
      // Calculate arcsec/pixel scale from FOV
      const fovDegrees = hints.fov;
      const arcsecPerPixel = (fovDegrees * 3600) / width;
      
      // Set scale bounds with 20% tolerance
      const scaleLow = arcsecPerPixel * 0.8;
      const scaleHigh = arcsecPerPixel * 1.2;
      
      args.push('--scale-low', String(scaleLow));
      args.push('--scale-high', String(scaleHigh));
      args.push('--scale-units', 'arcsecperpix');
      
      console.log(`[solve-field] Using FOV hint: ${fovDegrees}° → scale ${scaleLow.toFixed(2)}-${scaleHigh.toFixed(2)} arcsec/px`);
    } else {
      // Estimate scale from image dimensions (typical DSLR/CCD range)
      const estimatedScale = 2.0; // arcsec/pixel (typical for 50mm lens on APS-C)
      args.push('--scale-low', String(estimatedScale * 0.2));  // 0.4 arcsec/px
      args.push('--scale-high', String(estimatedScale * 5.0)); // 10 arcsec/px
      args.push('--scale-units', 'arcsecperpix');
      console.log('[solve-field] No FOV hint, using wide scale range: 0.4-10 arcsec/px');
    }
    
    // Add position hints if provided
    if (hints?.ra !== undefined && hints?.dec !== undefined) {
      args.push('--ra', String(hints.ra));
      args.push('--dec', String(hints.dec));
      
      // Calculate search radius
      const radius = hints?.radius || (hints.fov ? hints.fov * 1.5 : 10);
      args.push('--radius', String(radius));
      
      console.log(`[solve-field] Using position hints: RA=${hints.ra}°, Dec=${hints.dec}°, radius=${radius}°`);
    } else {
      console.log('[solve-field] No position hints, searching entire sky');
    }
    
    // Downsample large images for speed
    if (width > 2048 || height > 2048) {
      args.push('--downsample', '2');
      console.log('[solve-field] Image is large, downsampling by 2x for speed');
    }
    
    // Add data directory if specified
    const dataDir = getAstrometryDataDir();
    if (dataDir) {
      args.push('--config', '/etc/astrometry.cfg');
    }

    const exec = wrapExecForWSL(bin, args, useWSL);
    console.log(`[solve-field] Running: ${exec.cmd} ${exec.args.join(' ')}`);

    let solveStdout = '';
    try {
      // No timeout - let solve-field run until completion or failure
      const { stdout, stderr } = await execFileAsync(exec.cmd, exec.args, {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for output
        env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
        signal,
      } as any);
      solveStdout = String(stdout ?? '');
      console.log('[solve-field] stdout:', stdout);
      if (stderr) console.log('[solve-field] stderr:', stderr);
      
    } catch (err: any) {
      if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || signal?.aborted) {
        const abortErr = new Error('SOLVE_CANCELED');
        (abortErr as any).code = 'SOLVE_CANCELED';
        throw abortErr;
      }

      if (err?.code === 'ENOENT') {
        return { success: false, error: msg.solveField.notFound(lang, bin) };
      }

      // Check if WCS file was produced despite error exit code
      if (!existsSync(wcsPath)) {
        const stderr = err.stderr?.toString() || '';
        const stdout = err.stdout?.toString() || '';
        // Combine both streams — solve-field splits diagnostics between them
        const fullOutput = [stderr, stdout, err.message || ''].filter(Boolean).join('\n').trim();
        solveStdout = stdout;
        
        console.log('[solve-field] Full output:', fullOutput);
        
        // Parse output for diagnostics
        let noSolution = false;
        let fieldsExamined = 0;
        let matchesFound = 0;
        
        for (const line of fullOutput.split('\n')) {
          if (line.includes('Field: examined')) {
            const match = line.match(/examined (\d+)/);
            if (match) fieldsExamined = parseInt(match[1]);
          }
          if (line.includes('matches')) {
            const match = line.match(/(\d+) matches/);
            if (match) matchesFound = parseInt(match[1]);
          }
          if (line.includes('Failed to solve') || line.includes('no match found')) {
            noSolution = true;
          }
        }
        
        // Check for missing index files
        if (fullOutput.includes('no index files') || fullOutput.includes('Could not find index')) {
          return { success: false, error: msg.solveField.noIndexFiles(lang) };
        }

        // Python uniformize dependency missing — this is handled by --uniformize 0 but
        // catch it explicitly in case another Python step fails in the future
        if (fullOutput.includes('NoPyfits') || fullOutput.includes('astrometry.util.uniformize')) {
          return { success: false, error: msg.solveField.noPyfits(lang) };
        }
        
        // Collect raw output as diagnostics for the collapsible details section
        const diagnostics = fullOutput
          .split('\n')
          .map((s: string) => s.trim())
          .filter(Boolean)
          .slice(-6)
          .join('\n') || undefined;

        // Provide informative error message
        if (noSolution) {
          let errorMsg = msg.solveField.noSolution(lang, fieldsExamined, matchesFound);
          errorMsg += msg.solveField.noSolutionCauses(lang);
          
          if (!hints?.ra && !hints?.fov) {
            errorMsg += msg.solveField.noSolutionHintNone(lang);
          } else if (!hints?.fov) {
            errorMsg += msg.solveField.noSolutionHintNoFov(lang);
          } else {
            errorMsg += msg.solveField.noSolutionHintFull(lang);
          }
          
          return { success: false, error: errorMsg, diagnostics };
        }
        
        return {
          success: false,
          error: msg.solveField.failed(lang, fieldsExamined),
          diagnostics,
        };
      }
    }

    if (!existsSync(wcsPath)) {
      return { success: false, error: msg.solveField.noWcsFile(lang) };
    }

    const wcsText = await fsp.readFile(wcsPath, 'utf-8');
    const parsed = parseFITSHeader(wcsText);

    const required = ['CRPIX1', 'CRPIX2', 'CRVAL1', 'CRVAL2', 'CD1_1', 'CD1_2', 'CD2_1', 'CD2_2'];
    for (const key of required) {
      if (typeof parsed[key] !== 'number') {
        return { success: false, error: msg.solveField.missingWcsKey(lang, key) };
      }
    }

    const wcs: WCSData = {
      CRPIX1: parsed.CRPIX1 as number,
      CRPIX2: parsed.CRPIX2 as number,
      CRVAL1: parsed.CRVAL1 as number,
      CRVAL2: parsed.CRVAL2 as number,
      CD1_1: parsed.CD1_1 as number,
      CD1_2: parsed.CD1_2 as number,
      CD2_1: parsed.CD2_1 as number,
      CD2_2: parsed.CD2_2 as number,
      NAXIS1: width,
      NAXIS2: height,
    };

    console.log(`[solve-field] Solution found: RA=${wcs.CRVAL1.toFixed(4)}°, Dec=${wcs.CRVAL2.toFixed(4)}°`);

    // Generate correspondences from catalog stars.
    // solve-field receives a JPEG/PNG (screen/display convention): pixel (1,1) = upper-left,
    // Y increases downward → fitsYConvention=false.
    const correspondences = wcsToCorrespondences(wcs, width, height, false);
    
    if (correspondences.length < 3) {
      return { 
        success: false, 
        error: msg.solveField.notEnoughStars(lang, correspondences.length),
      };
    }

    console.log(`[solve-field] Generated ${correspondences.length} correspondences`);

    // Parse "Your field contains:" DSO list from stdout
    const dsoIds = parseSolveFieldDSOs(solveStdout, normalizeDSOAliases);

    return {
      success: true,
      correspondences,
      dsoIds,
    };

  } catch (err: any) {
    if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.code === 'SOLVE_CANCELED' || signal?.aborted) {
      const abortErr = new Error('SOLVE_CANCELED');
      (abortErr as any).code = 'SOLVE_CANCELED';
      throw abortErr;
    }
    console.error('[solve-field] Unexpected error:', err);
    return { 
      success: false, 
      error: err.message || 'solve-field error'
    };
  } finally {
    // Clean up temp directory
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn('[solve-field] Failed to clean up temp directory:', cleanupErr);
    }
  }
}

/**
 * Parse the "Your field contains:" block from solve-field stdout.
 * Each line may contain slash-separated aliases: "NGC 5457 / M 101"
 * Returns normalized IDs with spaces removed: ["NGC5457", "M101"]
 */
export function parseSolveFieldDSOs(
  stdout: string,
  normalize: (entries: string[]) => string[] = normalizeDSOAliases,
): string[] {
  const lineEntries: string[] = [];
  const lines = stdout.split('\n');
  let inSection = false;
  for (const line of lines) {
    if (line.trim() === 'Your field contains:') { inSection = true; continue; }
    if (!inSection) continue;
    const trimmed = line.trim();
    if (!trimmed) break; // blank line ends the section
    lineEntries.push(trimmed);
  }
  return normalize(lineEntries);
}
