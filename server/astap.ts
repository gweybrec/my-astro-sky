import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fsp, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { parseFITSHeader, wcsToCorrespondences } from './wcs-reader.js';
import type { WCSData } from './wcs-reader.js';
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
    const { stdout, stderr } = await execFileAsync(exec.cmd, exec.args, { timeout: 5_000 });
    const output = (stdout || stderr || '').trim().split('\n')[0];
    console.log(`[ASTAP] version: ${output}`);
  } catch {
    console.log(`[ASTAP] version check failed for: ${bin}`);
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
  diagnostics?: string;
}

function getASTAPBin(): string {
  return getSetting('ASTAP_PATH') || '/opt/astap/astap_cli';
}

function useWSLForASTAP(): boolean {
  return shouldUseWSL(getSetting('USE_WSL_FOR_ASTAP'));
}

export async function solveWithASTAP(
  buffer: Buffer,
  ext: string,
  width: number,
  height: number,
  hints?: { ra?: number; dec?: number; fov?: number; radius?: number },
  lang: ServerLang = 'en',
  signal?: AbortSignal,
): Promise<SolveResult> {
  const bin = getASTAPBin();
  const useWSL = useWSLForASTAP();
  void logSolverVersion(bin, ['-v'], useWSL);
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'astap-'));
  const imgName = `input${ext}`;
  const imgPath = path.join(tmpDir, imgName);
  const wcsPath = path.join(tmpDir, 'input.wcs');

  try {
    await fsp.writeFile(imgPath, buffer);

    // Build ASTAP command with optional hints
    const args = ['-f', wslPath(imgPath, useWSL), '-wcs', '-z', '0'];
    
    // Add position hints if provided
    if (hints?.ra !== undefined && hints?.dec !== undefined) {
      const raHours = hints.ra / 15;
      const spd = 90 + hints.dec;
      console.log(`[ASTAP] Using hints: RA=${hints.ra}° (${raHours}h), Dec=${hints.dec}°, SPD=${spd}`);
      args.push('-ra', String(raHours)); // Convert degrees to hours
      // SPD (South Pole Distance) = 90 + Dec (works for both hemispheres)
      args.push('-spd', String(spd));
    } else {
      console.log('[ASTAP] No hints provided, solving entire sky');
    }
    
    // Add FOV hint if provided
    if (hints?.fov !== undefined && hints.fov > 0) {
      args.push('-fov', String(hints.fov));
    }
    
    // Add search radius (smaller if we have hints, larger otherwise)
    const searchRadius = hints?.radius || (hints?.ra !== undefined ? 10 : 180);
    args.push('-r', String(searchRadius));
    
    // Use slow mode with relaxed tolerance for heavily processed images
    args.push('-speed', 'slow');
    args.push('-t', '0.020'); // Relaxed quad tolerance
    args.push('-s', '800'); // More stars

    const exec = wrapExecForWSL(bin, args, useWSL);

    try {
      await execFileAsync(exec.cmd, exec.args, {
        timeout: 60_000,
        env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
        signal,
      } as any);
    } catch (err: any) {
      if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || signal?.aborted) {
        const abortErr = new Error('SOLVE_CANCELED');
        (abortErr as any).code = 'SOLVE_CANCELED';
        throw abortErr;
      }
      if (err.killed || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
        return { success: false, error: msg.astap.timeout() };
      }
      // ASTAP may return non-zero even on success; check if .wcs was produced
      if (!existsSync(wcsPath)) {
        const stderr = err.stderr?.toString() || '';
        const stdout = err.stdout?.toString() || '';
        const fullOutput = stderr || stdout || err.message || '';
        
        // Log full output for debugging
        console.log('[ASTAP] Full output:', fullOutput);
        
        // Extract key information from ASTAP output
        const lines = fullOutput.split('\n');
        let starsFound = 0;
        let quadsFound = 0;
        let fovTried = '';
        let noSolution = false;
        
        for (const line of lines) {
          if (line.includes('stars,') && line.includes('quads selected')) {
            const match = line.match(/(\d+) stars, (\d+) quads selected/);
            if (match) {
              starsFound = parseInt(match[1]);
              quadsFound = parseInt(match[2]);
            }
          }
          if (line.includes('Trying FOV:')) {
            const match = line.match(/Trying FOV: ([\d.]+)/);
            if (match) fovTried = match[1];
          }
          if (line.includes('No solution found')) {
            noSolution = true;
          }
        }
        
        // Check if it's likely a missing database issue
        if (fullOutput.includes('h18 not found') || fullOutput.includes('database not found') || (!stderr && !stdout)) {
          return { success: false, error: msg.astap.noDatabase(lang, path.dirname(bin)) };
        }
        
        // Provide informative error message with explanations
        const lastLines = fullOutput
          .split('\n')
          .map((s: string) => s.trim())
          .filter(Boolean)
          .slice(-6)
          .join('\n');
        const diagnostics = lastLines || undefined;

        if (noSolution) {
          let errorMsg = msg.astap.noSolution(lang, starsFound, quadsFound);
          if (fovTried) errorMsg += msg.astap.noSolutionFov(lang, fovTried);
          errorMsg += msg.astap.noSolutionCauses(lang);
          errorMsg += hints?.ra
            ? msg.astap.noSolutionHintGiven(lang)
            : msg.astap.noSolutionHintNone(lang);
          return { success: false, error: errorMsg, diagnostics };
        }
        
        return { success: false, error: msg.astap.failed(lang, starsFound), diagnostics };
      }
    }

    if (!existsSync(wcsPath)) {
      return { success: false, error: msg.astap.noWcsFile(lang) };
    }

    const wcsText = await fsp.readFile(wcsPath, 'utf-8');
    const parsed = parseFITSHeader(wcsText);

    const required = ['CRPIX1', 'CRPIX2', 'CRVAL1', 'CRVAL2', 'CD1_1', 'CD1_2', 'CD2_1', 'CD2_2'];
    for (const key of required) {
      if (typeof parsed[key] !== 'number') {
        return { success: false, error: msg.astap.missingWcsKey(lang, key) };
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
    
    // Validate solution if hints were provided
    if (hints?.ra !== undefined && hints?.dec !== undefined) {
      const deltaRA = Math.abs(wcs.CRVAL1 - hints.ra);
      const deltaDec = Math.abs(wcs.CRVAL2 - hints.dec);
      const distance = Math.sqrt(deltaRA * deltaRA + deltaDec * deltaDec);
      const maxDistance = searchRadius * 1.5; // Allow some margin
      
      if (distance > maxDistance) {
        console.log(`[ASTAP] Solution rejected: too far from hint. Expected RA=${hints.ra}°, Dec=${hints.dec}°, got RA=${wcs.CRVAL1.toFixed(2)}°, Dec=${wcs.CRVAL2.toFixed(2)}° (distance=${distance.toFixed(1)}° > ${maxDistance}°)`);
        return { success: false, error: msg.astap.badSolution(lang, distance.toFixed(1)) };
      }
      
      console.log(`[ASTAP] Solution validated: RA=${wcs.CRVAL1.toFixed(2)}°, Dec=${wcs.CRVAL2.toFixed(2)}° (distance from hint: ${distance.toFixed(1)}°)`);
    }

    // Try to generate correspondences from catalog stars
    let correspondences = wcsToCorrespondences(wcs, width, height);
    
    // If not enough catalog stars match (e.g., image has faint stars),
    // generate synthetic correspondences from WCS corners
    if (correspondences.length < 3) {
      console.log(`[ASTAP] Only ${correspondences.length} catalog matches, generating synthetic correspondences from WCS`);
      correspondences = generateSyntheticCorrespondences(wcs, width, height);
    }
    
    if (correspondences.length < 3) {
      return { success: false, error: msg.astap.notEnoughCatalogStars(lang) };
    }

    return { success: true, correspondences };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Generate synthetic correspondences from WCS solution
 * Used when catalog doesn't have matching stars (e.g., deep sky images with faint stars)
 */
function generateSyntheticCorrespondences(wcs: WCSData, width: number, height: number) {
  const DEG2RAD = Math.PI / 180;
  const correspondences = [];
  
  // Use 3 well-separated points near image center (not corners - projection breaks down far from CRPIX)
  // Use 20% and 80% positions to stay well within image bounds
  const points = [
    { px: width * 0.2, py: height * 0.2 },   // Top-left quadrant
    { px: width * 0.8, py: height * 0.2 },   // Top-right quadrant  
    { px: width * 0.5, py: height * 0.8 },   // Bottom center
  ];
  
  const ra0Rad = wcs.CRVAL1 * DEG2RAD;
  const dec0Rad = wcs.CRVAL2 * DEG2RAD;
  const cosDec0 = Math.cos(dec0Rad);
  const sinDec0 = Math.sin(dec0Rad);
  
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    
    // Convert display coordinates to FITS pixel coordinates
    // Display: (0,0) at top-left, FITS: (1,1) at bottom-left
    const fitsPx = point.px + 1;
    const fitsPy = height - point.py;
    
    // Pixel offset from reference pixel (in FITS coordinates)
    const dx = fitsPx - wcs.CRPIX1;
    const dy = fitsPy - wcs.CRPIX2;
    
    // Apply CD matrix to get standard coordinates (degrees)
    const xi = wcs.CD1_1 * dx + wcs.CD1_2 * dy;
    const eta = wcs.CD2_1 * dx + wcs.CD2_2 * dy;
    
    // TAN (gnomonic) deprojection: standard coords → celestial coords
    // Standard formulas from FITS WCS Paper II
    const xiRad = xi * DEG2RAD;
    const etaRad = eta * DEG2RAD;
    
    // RA calculation
    const raRad = ra0Rad + Math.atan2(xiRad, cosDec0 - etaRad * sinDec0);
    
    // Dec calculation  
    const rTheta = Math.sqrt(xiRad * xiRad + etaRad * etaRad);
    const sinDec = (sinDec0 + etaRad * cosDec0) / Math.sqrt(1 + xiRad * xiRad + etaRad * etaRad);
    const decRad = Math.asin(Math.max(-1, Math.min(1, sinDec)));
    
    const ra = (raRad / DEG2RAD + 360) % 360;
    const dec = decRad / DEG2RAD;
    
    const raHours = Math.floor(ra / 15);
    const raMin = Math.floor((ra / 15 - raHours) * 60);
    const decDeg = Math.floor(Math.abs(dec));
    const decSign = dec >= 0 ? '+' : '-';
    
    correspondences.push({
      pointIndex: i,
      photoX: point.px,
      photoY: point.py,
      starHip: 0,  // Synthetic point
      starName: `${raHours}h${raMin}m ${decSign}${decDeg}°`,
      starRa: ra,    // RA in degrees
      starDec: dec,  // Dec in degrees
    });
  }
  
  return correspondences;
}
