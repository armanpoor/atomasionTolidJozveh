/**
 * Generation-2 Automotive Physical Guardrails & Deterministic Telemetry Brief Engine.
 *
 * 100% Pure TypeScript, Zero-Token execution:
 * 1) Deterministic CSV Datalog & Dyno Telemetry Analyzer (Idle/Cruise/WOT/Overrun segmentation,
 *    WOT Lean/Rich detection, Peak Knock Retard, Boost deviation, Rail pressure drop, and
 *    Dyno torque-power mechanical coupling verification -> < 1,500-token engineering brief).
 * 2) Generation-2 Physical & Electrical Guardrails (PFI/GDI/CRDi rail pressure bounds,
 *    Fuel-specific AFR = Stoich * Lambda equation, Injector/Coil suppression diode trap,
 *    CAN 60Ω/120Ω vs 12V single-wire LIN-Bus, Dyno P_kW = (T_Nm * RPM) / 9549,
 *    Non-strict monotonic A2L AXIS_PTS with plateau warning, and true inverse ASAM RAT_FUNC).
 * 3) Non-Destructive Commercial Quarantine Policy: Anomalies never silently delete user data;
 *    they emit structured Persian engineering diagnostics and route units to 'staging'.
 */

import { toAsciiDigits } from '../formatParsers.ts';

export type PhysicalGuardIssueKind =
  | 'pfi_gdi_rail_pressure_mismatch'
  | 'stoichiometric_afr_lambda_mismatch'
  | 'electrical_or_bus_physics_mismatch'
  | 'dyno_power_torque_decoupling'
  | 'non_monotonic_zigzag_axis'
  | 'axis_plateau_clamp_notice'
  | 'invalid_asam_rat_func_coeffs';

export interface AutomotivePhysicalGuardIssue {
  id: string;
  kind: PhysicalGuardIssueKind;
  severity: 'quarantine_warning' | 'info_notice';
  titleFa: string;
  messageFa: string;
  detectedValue: string;
  expectedReferenceFa: string;
  quarantineToStaging: boolean;
}

export interface AutomotivePhysicalGuardReport {
  passed: boolean;
  quarantineRecommended: boolean;
  issues: AutomotivePhysicalGuardIssue[];
}

export interface AsamRatFuncCoeffs {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface InverseRatFuncResult {
  valid: boolean;
  isLinear: boolean;
  /** Physical = rawToPhysicalFactor * Raw + rawToPhysicalOffset */
  rawToPhysicalFactor: number | null;
  rawToPhysicalOffset: number | null;
  errorFa?: string;
}

/**
 * True ASAM MCD-2 MC (ASAP2) RAT_FUNC evaluator.
 * In official ASAM specification:
 *   f(x) = (a*x^2 + b*x + c) / (d*x^2 + e*x + f)
 * maps Physical value (x) -> Internal/Raw value (y).
 * Therefore, for linear conversion (a = 0, d = 0, e = 0):
 *   Raw = (b * Physical + c) / f   ==>   Physical = (f * Raw - c) / b
 * Both `b` and `f` MUST be non-zero for an invertible linear conversion.
 */
export function computeInverseAsamRatFunc(coeffs: AsamRatFuncCoeffs): InverseRatFuncResult {
  const { a, b, c, d, e, f } = coeffs;
  if ([a, b, c, d, e, f].some((v) => !Number.isFinite(v))) {
    return {
      valid: false,
      isLinear: false,
      rawToPhysicalFactor: null,
      rawToPhysicalOffset: null,
      errorFa: 'ضرایب RAT_FUNC در فایل A2L معتبر یا عددی نیستند.',
    };
  }

  const isLinear = Math.abs(a) < 1e-12 && Math.abs(d) < 1e-12 && Math.abs(e) < 1e-12;
  if (!isLinear) {
    // Non-linear rational function
    const denomConst = Math.abs(d) + Math.abs(e) + Math.abs(f);
    if (denomConst < 1e-12) {
      return {
        valid: false,
        isLinear: false,
        rawToPhysicalFactor: null,
        rawToPhysicalOffset: null,
        errorFa: 'مخرج تابع گویای RAT_FUNC در استاندارد A2L صفر است (تقسیم بر صفر).',
      };
    }
    return {
      valid: true,
      isLinear: false,
      rawToPhysicalFactor: null,
      rawToPhysicalOffset: null,
    };
  }

  if (Math.abs(b) < 1e-12 || Math.abs(f) < 1e-12) {
    return {
      valid: false,
      isLinear: true,
      rawToPhysicalFactor: null,
      rawToPhysicalOffset: null,
      errorFa: `فرمول خطی RAT_FUNC معکوس‌پذیر نیست (b=${b}, f=${f})؛ در استاندارد ASAM برای تبدیل Raw به Physical باید b ≠ 0 و f ≠ 0 باشند.`,
    };
  }

  const rawToPhysicalFactor = Number((f / b).toFixed(8));
  const rawToPhysicalOffset = Number((-c / b).toFixed(8));

  return {
    valid: true,
    isLinear: true,
    rawToPhysicalFactor,
    rawToPhysicalOffset,
  };
}

export interface AxisMonotonicityResult {
  valid: boolean;
  direction: 'ascending' | 'descending' | 'constant' | 'zigzag';
  hasPlateau: boolean;
  plateauIndices: number[];
  zigzagIndex: number | null;
  issue: AutomotivePhysicalGuardIssue | null;
}

/**
 * Validates WinOLS / A2L AXIS_PTS monotonicity according to real Bosch/Siemens/Valeo ECUs:
 * - Allows BOTH non-strictly ascending (x[i] >= x[i-1]) and non-strictly descending (x[i] <= x[i-1]) axes.
 * - Adjacent equal values (x[i] === x[i-1], plateau/clamp) emit a non-blocking info notice (WARN), NEVER a hard reject.
 * - Genuine zig-zag sign reversals emit a quarantine warning.
 */
export function validateA2lAxisMonotonicity(
  axisPoints: number[],
  axisLabel = 'AXIS_PTS'
): AxisMonotonicityResult {
  if (!Array.isArray(axisPoints) || axisPoints.length < 2) {
    return {
      valid: true,
      direction: 'constant',
      hasPlateau: false,
      plateauIndices: [],
      zigzagIndex: null,
      issue: null,
    };
  }

  const plateauIndices: number[] = [];
  let seenPositiveDelta = false;
  let seenNegativeDelta = false;
  let zigzagIndex: number | null = null;

  for (let i = 1; i < axisPoints.length; i++) {
    const delta = axisPoints[i] - axisPoints[i - 1];
    if (Math.abs(delta) < 1e-9) {
      plateauIndices.push(i);
    } else if (delta > 0) {
      seenPositiveDelta = true;
      if (seenNegativeDelta && zigzagIndex === null) {
        zigzagIndex = i;
      }
    } else if (delta < 0) {
      seenNegativeDelta = true;
      if (seenPositiveDelta && zigzagIndex === null) {
        zigzagIndex = i;
      }
    }
  }

  if (zigzagIndex !== null) {
    return {
      valid: false,
      direction: 'zigzag',
      hasPlateau: plateauIndices.length > 0,
      plateauIndices,
      zigzagIndex,
      issue: {
        id: `phys-axis-zigzag-${axisLabel}`,
        kind: 'non_monotonic_zigzag_axis',
        severity: 'quarantine_warning',
        titleFa: 'پرش زیگزاگی محور جدول کالیبراسیون (Non-Monotonic Axis)',
        messageFa: `محور «${axisLabel}» در اندیس ${zigzagIndex} (مقدار ${axisPoints[zigzagIndex]}) تغییر جهت زیگزاگی دارد که نشانه خطای آفست آدرس در WinOLS است.`,
        detectedValue: axisPoints.slice(0, 8).join(', '),
        expectedReferenceFa: 'یکنواخت صعودی یا یکنواخت نزولی (تساوی دو سلول مجاور برای Clamp مجاز است)',
        quarantineToStaging: true,
      },
    };
  }

  const direction = seenPositiveDelta
    ? 'ascending'
    : seenNegativeDelta
    ? 'descending'
    : 'constant';

  if (plateauIndices.length > 0) {
    return {
      valid: true,
      direction,
      hasPlateau: true,
      plateauIndices,
      zigzagIndex: null,
      issue: {
        id: `phys-axis-plateau-${axisLabel}`,
        kind: 'axis_plateau_clamp_notice',
        severity: 'info_notice',
        titleFa: 'نقطه فلت/کلمپ در محور جدول (Axis Plateau Notice)',
        messageFa: `در محور «${axisLabel}» دو نقطه مجاور برابر (${axisPoints[plateauIndices[0]]}) مشاهده شد (حالت Plateau/Clamp مجاز در کالیبراسیون).`,
        detectedValue: String(axisPoints[plateauIndices[0]]),
        expectedReferenceFa: 'یکنواخت غیراکید (صعودی یا نزولی)',
        quarantineToStaging: false,
      },
    };
  }

  return {
    valid: true,
    direction,
    hasPlateau: false,
    plateauIndices: [],
    zigzagIndex: null,
    issue: null,
  };
}

const FUEL_STOICH_MAP: Record<string, { labelFa: string; stoich: number }> = {
  gasoline: { labelFa: 'بنزین (۱۴.۷:۱)', stoich: 14.7 },
  e85: { labelFa: 'اتانول E85 (۹.۷۶:۱)', stoich: 9.76 },
  cng: { labelFa: 'گاز طبیعی CNG (۱۷.۲:۱)', stoich: 17.2 },
  lpg: { labelFa: 'گاز مایع LPG (۱۵.۵:۱)', stoich: 15.5 },
  diesel: { labelFa: 'دیزل (۱۴.۵:۱)', stoich: 14.5 },
};

function detectFuelContext(text: string): { labelFa: string; stoich: number } {
  if (/\b(?:e85|اتانول)\b/i.test(text)) return FUEL_STOICH_MAP.e85;
  if (/\b(?:cng|گاز\s*سوز|گاز\s*طبیعی|بای\s*فیول|دوگانه\s*سوز)\b/i.test(text)) return FUEL_STOICH_MAP.cng;
  if (/\b(?:lpg|گاز\s*مایع)\b/i.test(text)) return FUEL_STOICH_MAP.lpg;
  if (/\b(?:diesel|crdi|edc1[567]|دیزل|گازوئیل)\b/i.test(text)) return FUEL_STOICH_MAP.diesel;
  return FUEL_STOICH_MAP.gasoline;
}

/**
 * Verifies mechanical power-torque coupling:
 *   Metric:   P_kW = (T_Nm * RPM) / 9549
 *   Imperial: P_HP = (T_lbft * RPM) / 5252
 * Note: Supports both mechanical HP (1 kW = 1.34102 HP) and metric PS (1 kW = 1.35962 PS)
 * within the specified relative tolerance (default 3.5% + PS/HP allowance).
 */
export function verifyDynoTorquePowerCoupling(params: {
  rpm: number;
  torqueValue: number;
  torqueUnit: 'nm' | 'lb-ft';
  powerValue: number;
  powerUnit: 'kw' | 'hp';
  tolerancePercent?: number;
}): {
  valid: boolean;
  expectedPowerKw: number;
  expectedPowerHp: number;
  relativeErrorPercent: number;
} {
  const { rpm, torqueValue, torqueUnit, powerValue, powerUnit, tolerancePercent = 3.5 } = params;
  const torqueNm = torqueUnit === 'lb-ft' ? torqueValue * 1.35581795 : torqueValue;
  const expectedPowerKw = (torqueNm * rpm) / 9549;
  const expectedMechanicalHp = expectedPowerKw * 1.34102209;
  const expectedMetricPs = expectedPowerKw * 1.35962162;

  if (powerUnit === 'kw') {
    const err =
      expectedPowerKw > 0
        ? (Math.abs(powerValue - expectedPowerKw) / expectedPowerKw) * 100
        : 0;
    return {
      valid: err <= tolerancePercent,
      expectedPowerKw: Number(expectedPowerKw.toFixed(2)),
      expectedPowerHp: Number(expectedMechanicalHp.toFixed(2)),
      relativeErrorPercent: Number(err.toFixed(2)),
    };
  }

  // Compare against both mechanical HP (5252 RPM crossover) and metric PS (DIN)
  const errMech =
    expectedMechanicalHp > 0
      ? (Math.abs(powerValue - expectedMechanicalHp) / expectedMechanicalHp) * 100
      : 0;
  const errPs =
    expectedMetricPs > 0
      ? (Math.abs(powerValue - expectedMetricPs) / expectedMetricPs) * 100
      : 0;
  const bestErr = Math.min(errMech, errPs);

  return {
    valid: bestErr <= tolerancePercent,
    expectedPowerKw: Number(expectedPowerKw.toFixed(2)),
    expectedPowerHp: Number(expectedMechanicalHp.toFixed(2)),
    relativeErrorPercent: Number(bestErr.toFixed(2)),
  };
}

/**
 * Runs Generation-2 Zero-Token Automotive Physical & Engineering Guards on a text/markdown unit.
 * Never deletes data: returns structured quarantine warnings so the unit is routed to 'staging'
 * and displayed with a clear technical explanation in the UI.
 */
export function evaluateAutomotivePhysicalGuards(rawText: string): AutomotivePhysicalGuardReport {
  const ascii = toAsciiDigits(rawText || '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/٫/g, '.');
  const issues: AutomotivePhysicalGuardIssue[] = [];

  // Split by sentences or table rows for local co-occurrence checks
  const clauses = ascii
    .split(/(?:\r?\n|[.!؟؛])+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);

  for (let idx = 0; idx < clauses.length; idx++) {
    const clause = clauses[idx];

    // 1. Fuel System Rail Pressure Guard (PFI vs GDI vs CRDi)
    const mentionsRail =
      /(?:فشار\s*(?:ریل|سوخت|پمپ\s*بالا)|rail\s*pressure|fuel\s*pressure)/i.test(clause);
    if (mentionsRail) {
      const barMatches = Array.from(
        clause.matchAll(/(\d+(?:\.\d+)?)\s*(?:bar|بار)\b/gi)
      ).map((m) => Number(m[1]));

      const isPfiOnly =
        /\b(?:pfi|mpi|پاشش\s*غیر\s*مستقیم|پاشش\s*منیفولد|tu5|xu7|me7\.4\.[459]|s2000|j34)\b/i.test(
          clause
        ) && !/\b(?:gdi|t-?gdi|crdi|med17|edc17|پاشش\s*مستقیم|دیزل)\b/i.test(clause);

      const isGdiHighPressure =
        /\b(?:gdi|t-?gdi|med17|پاشش\s*مستقیم)\b/i.test(clause) &&
        !/\b(?:low\s*pressure|پمپ\s*داخل\s*باک|فشار\s*پایین|مدار\s*اولیه)\b/i.test(clause);

      for (const barVal of barMatches) {
        if (isPfiOnly && barVal > 12) {
          issues.push({
            id: `phys-rail-pfi-${idx}-${barVal}`,
            kind: 'pfi_gdi_rail_pressure_mismatch',
            severity: 'quarantine_warning',
            titleFa: 'عدم تطابق فیزیکی فشار ریل سوخت PFI/MPI',
            messageFa: `فشار ریل ${barVal} بار برای سیستم پاشش منیفولدی (PFI/MPI) از نظر فیزیکی ناممکن است (احتمال جابه‌جایی با داده‌های GDI یا CRDi).`,
            detectedValue: `${barVal} bar`,
            expectedReferenceFa: 'سیستم PFI/MPI: ۲.۵ تا ۶.۰ بار (۳۶ تا ۸۷ PSI) · سیستم GDI: ۴۰ تا ۳۵۰+ بار',
            quarantineToStaging: true,
          });
        } else if (isGdiHighPressure && (barVal < 15 || barVal > 450)) {
          issues.push({
            id: `phys-rail-gdi-${idx}-${barVal}`,
            kind: 'pfi_gdi_rail_pressure_mismatch',
            severity: 'quarantine_warning',
            titleFa: 'خروج فشار ریل پرفشار GDI از دامنه فیزیکی',
            messageFa: `فشار ریل پرفشار ${barVal} بار برای سیستم پاشش مستقیم بنزینی (GDI) خارج از دامنه استاندارد کاری است.`,
            detectedValue: `${barVal} bar`,
            expectedReferenceFa: 'ریل پرفشار GDI: ۴۰ تا ۳۵۰+ بار (مدار اولیه داخل باک: ۴ تا ۷ بار)',
            quarantineToStaging: true,
          });
        }
      }
    }

    // 2. Stoichiometric Equation Guard (AFR = Stoich * Lambda)
    const afrMatch =
      clause.match(/\bAFR\s*[:=≈]?\s*(\d+(?:\.\d+)?)(?:\s*:\s*1)?\b/i) ||
      clause.match(/(\d+(?:\.\d+)?)\s*:\s*1\s*AFR\b/i);
    const lambdaMatch =
      clause.match(/\b(?:lambda|λ|لامبدا)\s*[:=≈]?\s*(\d+(?:\.\d+)?)\b/i) ||
      clause.match(/(\d+(?:\.\d+)?)\s*(?:lambda|λ|لامبدا)\b/i);

    if (afrMatch && lambdaMatch) {
      const afrVal = Number(afrMatch[1]);
      const lambdaVal = Number(lambdaMatch[1]);
      if (afrVal >= 6 && afrVal <= 28 && lambdaVal >= 0.4 && lambdaVal <= 2.0) {
        const fuelSearchCtx = `${ascii}\n${clause}`;
        const hasExplicitFuel =
          /\b(?:gasoline|petrol|e85|cng|lpg|diesel|crdi|edc1[567])\b|بنزین|اتانول|گاز\s*سوز|گاز\s*طبیعی|دوگانه\s*سوز|گاز\s*مایع|دیزل|گازوئیل/i.test(
            fuelSearchCtx
          );
        const fuel = detectFuelContext(fuelSearchCtx);
        const expectedAfr = fuel.stoich * lambdaVal;
        const relDiff = Math.abs(afrVal - expectedAfr) / expectedAfr;
        // Only fall back to matching other fuels when NO explicit fuel was stated in the text
        const matchesOtherFuel =
          !hasExplicitFuel &&
          Object.values(FUEL_STOICH_MAP).some(
            (f) => Math.abs(afrVal - f.stoich * lambdaVal) / (f.stoich * lambdaVal) <= 0.035
          );
        if (relDiff > 0.035 && !matchesOtherFuel) {
          issues.push({
            id: `phys-stoich-${idx}`,
            kind: 'stoichiometric_afr_lambda_mismatch',
            severity: 'quarantine_warning',
            titleFa: 'تناقض ریاضی در معادله استوکیومتری (AFR = Stoich × Lambda)',
            messageFa: `مقدار AFR=${afrVal} با Lambda=${lambdaVal} در معادله استوکیومتری ${fuel.labelFa} صدق نمی‌کند (مقدار مورد انتظار: AFR ${expectedAfr.toFixed(2)}).`,
            detectedValue: `AFR ${afrVal} @ λ=${lambdaVal}`,
            expectedReferenceFa: `AFR = ${fuel.stoich} × ${lambdaVal} = ${expectedAfr.toFixed(2)}`,
            quarantineToStaging: true,
          });
        }
      }
    }

    // 3. Electrical & Multiplex Bus Physics Guard (LIN-Bus vs CAN termination & Injector Impedance & Coil Diode)
    const mentionsLinBus = /\b(?:lin-?bus|لین\s*باس|شبکه\s*لین)\b/i.test(clause);
    const mentionsCanBus = /\b(?:can-?bus|can-?fd|کن\s*باس)\b/i.test(clause);
    if (
      mentionsLinBus &&
      !mentionsCanBus &&
      /\b(?:60|120)\s*(?:Ω|ohm|اهم)\b/i.test(clause) &&
      !/(?:ندارد|فاقد|بدون|never|no\s+terminat)/i.test(clause)
    ) {
      issues.push({
        id: `phys-lin-term-${idx}`,
        kind: 'electrical_or_bus_physics_mismatch',
        severity: 'quarantine_warning',
        titleFa: 'خطای الکتریکی شبکه مالتی‌پلکس (مقاومت پایانی ۱۲۰/۶۰ اهم در LIN-Bus)',
        messageFa:
          'شبکه LIN-Bus یک باس تک‌سیم ۱۲ ولت است و برخلاف شبکه CAN-HS هرگز دارای مقاومت پایانی ۱۲۰ اهم (یا ۶۰ اهم موازی) نیست.',
        detectedValue: 'LIN-Bus + 60Ω/120Ω',
        expectedReferenceFa: 'CAN-HS: دو مقاومت ۱۲۰ اهم (۶۰ اهم موازی) · LIN-Bus: تک‌سیم ۱۲ ولت با پول‌آپ داخلی بدون مقاومت ۱۲۰ اهم',
        quarantineToStaging: true,
      });
    }

    // High-Z Injector impedance mismatch
    const mentionsHighZ = /\b(?:high-?z|انژکتور\s*امپدانس\s*بالا|انژکتور\s*معمولی\s*پرت)\b/i.test(clause);
    if (mentionsHighZ) {
      const ohmMatch = clause.match(/(\d+(?:\.\d+)?)\s*(?:Ω|ohm|اهم)\b/i);
      if (ohmMatch) {
        const ohmVal = Number(ohmMatch[1]);
        if (ohmVal > 0 && (ohmVal < 7 || ohmVal > 22)) {
          issues.push({
            id: `phys-inj-highz-${idx}`,
            kind: 'electrical_or_bus_physics_mismatch',
            severity: 'quarantine_warning',
            titleFa: 'عدم تطابق مقاومت انژکتور High-Z',
            messageFa: `مقاومت ${ohmVal} اهم برای انژکتور High-Z (اشباعی) غیرمعتبر است (احتمال اشتباه با انژکتور Low-Z Peak-and-Hold).`,
            detectedValue: `${ohmVal} Ω`,
            expectedReferenceFa: 'انژکتور High-Z: ۱۱ تا ۱۶ اهم · انژکتور Low-Z: ۱ تا ۴ اهم',
            quarantineToStaging: true,
          });
        }
      }
    }

    // 4. Dyno Mechanical Power-Torque Coupling Guard (P_kW = T_Nm * RPM / 9549)
    const rpmMatch =
      clause.match(/(\d{3,5})\s*(?:rpm|دور\s*بر\s*دقیقه|دور)\b/i) ||
      clause.match(/\bRPM\s*[:=]?\s*(\d{3,5})\b/i);
    const torqueMatch = clause.match(
      /(\d{2,4}(?:\.\d+)?)\s*(nm|n\.m|lb-ft|ft-lb|نیوتن[\s\u200c]*متر)\b/i
    );
    const powerMatch = clause.match(
      /(\d{2,4}(?:\.\d+)?)\s*(kw|hp|bhp|whp|کیلووات|اسب[\s\u200c]*بخار)\b/i
    );

    if (rpmMatch && torqueMatch && powerMatch) {
      const rpm = Number(rpmMatch[1]);
      const torqueVal = Number(torqueMatch[1]);
      const rawTUnit = torqueMatch[2].toLowerCase();
      const torqueUnit: 'nm' | 'lb-ft' = rawTUnit.includes('lb') || rawTUnit.includes('ft') ? 'lb-ft' : 'nm';
      const powerVal = Number(powerMatch[1]);
      const rawPUnit = powerMatch[2].toLowerCase();
      const powerUnit: 'kw' | 'hp' =
        rawPUnit === 'kw' || rawPUnit.includes('کیلووات') ? 'kw' : 'hp';

      // Only evaluate when sentence describes a single RPM operating point (not a range like "max torque at 3000 RPM and max power at 6000 RPM")
      const rpmMentions = Array.from(
        clause.matchAll(/\b\d{3,5}\s*(?:rpm|دور\s*بر\s*دقیقه|دور)\b/gi)
      );
      if (rpmMentions.length <= 1 && rpm >= 1000 && rpm <= 12000 && torqueVal >= 30 && powerVal >= 15) {
        const dynoCheck = verifyDynoTorquePowerCoupling({
          rpm,
          torqueValue: torqueVal,
          torqueUnit,
          powerValue: powerVal,
          powerUnit,
          tolerancePercent: 3.5,
        });
        if (!dynoCheck.valid) {
          issues.push({
            id: `phys-dyno-${idx}-${rpm}`,
            kind: 'dyno_power_torque_decoupling',
            severity: 'quarantine_warning',
            titleFa: 'عدم صدق اعداد توان و گشتاور در معادله فیزیکی داینو',
            messageFa: `در دور ${rpm} RPM با گشتاور ${torqueVal} ${torqueUnit.toUpperCase()}، توان فیزیکی برابر ${dynoCheck.expectedPowerKw} kW (${dynoCheck.expectedPowerHp} HP) است، اما مقدار ${powerVal} ${powerUnit.toUpperCase()} ثبت شده است (${dynoCheck.relativeErrorPercent}٪ انحراف فیزیکی).`,
            detectedValue: `${powerVal} ${powerUnit.toUpperCase()} @ ${rpm} RPM / ${torqueVal} ${torqueUnit.toUpperCase()}`,
            expectedReferenceFa: `P(kW) = (T_Nm × RPM) / 9549 = ${dynoCheck.expectedPowerKw} kW (${dynoCheck.expectedPowerHp} HP)`,
            quarantineToStaging: true,
          });
        }
      }
    }
  }

  const quarantineRecommended = issues.some((it) => it.quarantineToStaging);
  return {
    passed: !quarantineRecommended,
    quarantineRecommended,
    issues,
  };
}

// ============================================================================
// DETERMINISTIC TELEMETRY BRIEF ENGINE (CSV DATALOG & DYNO COMPRESSOR)
// ============================================================================

export type OperatingRegimeId = 'idle' | 'cruise' | 'wot' | 'overrun';

export interface TelemetryAnomalyEvent {
  type:
    | 'wot_lean'
    | 'wot_rich'
    | 'knock_retard'
    | 'boost_deviation'
    | 'rail_pressure_drop'
    | 'dyno_decoupling';
  severity: 'critical' | 'warning';
  rpm: number;
  loadOrTps: number | null;
  measuredValue: string;
  referenceValue: string;
  descriptionFa: string;
}

export interface TelemetryBriefReport {
  isTelemetryDatalog: boolean;
  totalRowsParsed: number;
  detectedColumns: string[];
  rpmRange: { min: number; max: number } | null;
  regimeCounts: Record<OperatingRegimeId, number>;
  peakPowerPoint: { rpm: number; powerKw: number; powerHp: number; torqueNm: number | null } | null;
  peakTorquePoint: { rpm: number; torqueNm: number; powerKw: number | null } | null;
  peakKnockRetardDeg: { deg: number; rpm: number; load: number | null } | null;
  wotAfrSummary: { minLambda: number; maxLambda: number; avgLambda: number } | null;
  anomalies: TelemetryAnomalyEvent[];
  physicalGuardReport: AutomotivePhysicalGuardReport;
  estimatedRawTokens: number;
  estimatedBriefTokens: number;
  tokenSavingsPercent: number;
  markdownBrief: string;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function detectDelimiter(headerLine: string): string {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semiCount = (headerLine.match(/;/g) || []).length;
  const tabCount = (headerLine.match(/\t/g) || []).length;
  if (tabCount > commaCount && tabCount >= semiCount) return '\t';
  if (semiCount > commaCount) return ';';
  return ',';
}

/**
 * Checks if a CSV file is a vehicle live telemetry datalog or dyno run sheet
 * (rather than a static WinOLS map address catalog).
 */
export function isTelemetryDatalogCsv(csvText: string): boolean {
  const firstLines = (csvText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (firstLines.length < 2) return false;
  const header = firstLines[0].toLowerCase();
  const hasAddressCol = /\b(?:hex|address|addr|آدرس)\b/.test(header);
  if (hasAddressCol) return false;

  const telemetrySignals = [
    /\b(?:rpm|engine\s*speed|دور\s*موتور)\b/,
    /\b(?:lambda|afr|o2|سوخت|لامبدا)\b/,
    /\b(?:knock|retard|timing|advance|spark|ناک|آوانس)\b/,
    /\b(?:boost|map|manifold|بوست|فشار\s*منیفولد)\b/,
    /\b(?:tps|throttle|pedal|load|دریچه\s*گاز|بار)\b/,
    /\b(?:torque|power|hp|kw|گشتاور|توان)\b/,
    /\b(?:rail\s*pressure|fuel\s*pressure|فشار\s*ریل)\b/,
  ];
  let matched = 0;
  for (const sig of telemetrySignals) {
    if (sig.test(header)) matched += 1;
  }
  return matched >= 2;
}

/**
 * Deterministic Zero-Token Telemetry Brief Engine:
 * Parses thousands of CSV datalog or dyno rows in pure TypeScript, segments operating regimes
 * (Idle, Cruise, WOT, Overrun), extracts WOT Lean/Rich, Knock Retard, Boost Error, Rail Pressure Drop,
 * and Dyno Torque-Power coupling anomalies, and compresses everything into a < 1,500-token engineering brief.
 */
export function analyzeAutomotiveDatalogCsv(
  csvText: string,
  fileName = 'datalog.csv'
): TelemetryBriefReport {
  const lines = toAsciiDigits(csvText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  const estimatedRawTokens = Math.max(1, Math.ceil((csvText || '').length / 3.2));

  if (lines.length < 2 || !isTelemetryDatalogCsv(csvText)) {
    return {
      isTelemetryDatalog: false,
      totalRowsParsed: 0,
      detectedColumns: [],
      rpmRange: null,
      regimeCounts: { idle: 0, cruise: 0, wot: 0, overrun: 0 },
      peakPowerPoint: null,
      peakTorquePoint: null,
      peakKnockRetardDeg: null,
      wotAfrSummary: null,
      anomalies: [],
      physicalGuardReport: { passed: true, quarantineRecommended: false, issues: [] },
      estimatedRawTokens,
      estimatedBriefTokens: 0,
      tokenSavingsPercent: 0,
      markdownBrief: '',
    };
  }

  const delimiter = detectDelimiter(lines[0]);
  const rawHeaders = splitCsvLine(lines[0], delimiter);
  const headers = rawHeaders.map((h) => h.toLowerCase());
  const fuelContext = detectFuelContext(`${fileName}\n${lines.slice(0, 5).join('\n')}`);
  const stoichRatio = fuelContext.stoich;

  const findCol = (patterns: RegExp[]): number =>
    headers.findIndex((h) => patterns.some((p) => p.test(h)));

  const rpmIdx = findCol([/\brpm\b/, /engine\s*speed/, /دور\s*موتور/]);
  const tpsIdx = findCol([/\btps\b/, /throttle/, /pedal/, /دریچه\s*گاز/]);
  const loadIdx = findCol([/\bload\b/, /rl_w/, /بار\s*موتور/]);
  const lambdaIdx = findCol([/\blambda\b/, /\bλ\b/, /لامبدا/]);
  const afrIdx = findCol([/\bafr\b/, /air\s*fuel/]);
  const targetLambdaIdx = findCol([/target\s*lambda/, /lamsbg/, /لامبدا.*هدف/]);
  const knockIdx = findCol([/\bknock\b/, /retard/, /wkrma/, /ناک/]);
  const boostIdx = findCol([/\bboost\b/, /map\s*\(bar\)/, /pvdks/, /بوست/]);
  const targetBoostIdx = findCol([/target\s*boost/, /plsol/, /بوست\s*هدف/]);
  const railIdx = findCol([/rail\s*pressure/, /fuel\s*rail/, /فشار\s*ریل/]);
  const targetRailIdx = findCol([/target\s*rail/, /فشار\s*ریل\s*هدف/]);
  const torqueNmIdx = findCol([/torque.*nm/, /\btorque\b/, /گشتاور/]);
  const powerKwIdx = findCol([/power.*kw/, /\bkw\b/, /توان.*کیلووات/]);
  const powerHpIdx = findCol([/power.*hp/, /\bhp\b/, /\bwhp\b/, /\bbhp\b/, /توان.*اسب/]);

  const regimeCounts: Record<OperatingRegimeId, number> = {
    idle: 0,
    cruise: 0,
    wot: 0,
    overrun: 0,
  };

  let minRpm = Number.POSITIVE_INFINITY;
  let maxRpm = Number.NEGATIVE_INFINITY;
  let totalRowsParsed = 0;

  const wotLambdas: number[] = [];
  let peakKnock: { deg: number; rpm: number; load: number | null } | null = null;
  let peakTorque: { rpm: number; torqueNm: number; powerKw: number | null } | null = null;
  let peakPower: { rpm: number; powerKw: number; powerHp: number; torqueNm: number | null } | null =
    null;

  const anomalies: TelemetryAnomalyEvent[] = [];
  const physicalIssues: AutomotivePhysicalGuardIssue[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delimiter);
    const num = (idx: number): number | null => {
      if (idx < 0 || idx >= cells.length) return null;
      const v = Number(cells[idx].replace(/[^\d.+-]/g, ''));
      return Number.isFinite(v) ? v : null;
    };

    const rpm = num(rpmIdx);
    if (rpm === null || rpm <= 0) continue;

    totalRowsParsed += 1;
    if (rpm < minRpm) minRpm = rpm;
    if (rpm > maxRpm) maxRpm = rpm;

    const tps = num(tpsIdx);
    const load = num(loadIdx);
    const rawLambda = num(lambdaIdx);
    const rawAfr = num(afrIdx);
    const lambda =
      rawLambda !== null
        ? rawLambda
        : rawAfr !== null && rawAfr > 5
        ? Number((rawAfr / stoichRatio).toFixed(4))
        : null;
    const targetLambda = num(targetLambdaIdx);
    const knockRaw = num(knockIdx);
    const knockDeg = knockRaw !== null ? Math.abs(knockRaw) : null;
    const boost = num(boostIdx);
    const targetBoost = num(targetBoostIdx);
    const rail = num(railIdx);
    const targetRail = num(targetRailIdx);
    const torqueNm = num(torqueNmIdx);
    const rawKw = num(powerKwIdx);
    const rawHp = num(powerHpIdx);

    // Determine operating regime
    const effectiveLoadOrTps = tps ?? load ?? 50;
    let regime: OperatingRegimeId = 'cruise';
    if (rpm < 1150 && effectiveLoadOrTps < 15) {
      regime = 'idle';
    } else if (rpm > 1600 && effectiveLoadOrTps < 4 && (lambda === null || lambda > 1.25)) {
      regime = 'overrun';
    } else if ((tps !== null && tps >= 70) || (load !== null && load >= 85)) {
      regime = 'wot';
    }
    regimeCounts[regime] += 1;

    if (regime === 'wot' && lambda !== null) {
      wotLambdas.push(lambda);

      // WOT Lean excursion check
      const isLeanByTarget = targetLambda !== null && lambda - targetLambda > 0.05;
      const isLeanAbsolute = rpm >= 3200 && lambda > 0.93;
      if ((isLeanByTarget || isLeanAbsolute) && anomalies.filter((a) => a.type === 'wot_lean').length < 4) {
        anomalies.push({
          type: 'wot_lean',
          severity: lambda > 0.97 ? 'critical' : 'warning',
          rpm,
          loadOrTps: effectiveLoadOrTps,
          measuredValue: `λ=${lambda.toFixed(3)} (AFR ${(lambda * stoichRatio).toFixed(1)})`,
          referenceValue:
            targetLambda !== null ? `λ_target=${targetLambda.toFixed(3)}` : 'λ ≤ 0.88 (WOT Safe)',
          descriptionFa: `فقر سوخت در بار کامل (WOT Lean) در دور ${rpm} RPM: خطر افزایش دمای اتاق احتراق (EGT) و ناک.`,
        });
      }

      // WOT Rich excursion check
      if (lambda < 0.74 && anomalies.filter((a) => a.type === 'wot_rich').length < 3) {
        anomalies.push({
          type: 'wot_rich',
          severity: 'warning',
          rpm,
          loadOrTps: effectiveLoadOrTps,
          measuredValue: `λ=${lambda.toFixed(3)} (AFR ${(lambda * stoichRatio).toFixed(1)})`,
          referenceValue: '0.78 ≤ λ ≤ 0.88',
          descriptionFa: `غنای بیش از حد سوخت (Over-Rich) در بار کامل در دور ${rpm} RPM: افت توان و شست‌وشوی فیلم روغن سیلندر.`,
        });
      }
    }

    // Knock Retard check
    if (knockDeg !== null && knockDeg > 0) {
      if (!peakKnock || knockDeg > peakKnock.deg) {
        peakKnock = { deg: knockDeg, rpm, load: load ?? tps };
      }
      if (knockDeg >= 3.0 && anomalies.filter((a) => a.type === 'knock_retard').length < 4) {
        anomalies.push({
          type: 'knock_retard',
          severity: knockDeg >= 5.0 ? 'critical' : 'warning',
          rpm,
          loadOrTps: load ?? tps,
          measuredValue: `-${knockDeg.toFixed(1)}° KR`,
          referenceValue: '0.0° تا -2.0° مجاز موقت',
          descriptionFa: `ریتارد ناک شدید (-${knockDeg.toFixed(1)} درجه) در دور ${rpm} RPM؛ نیاز به اصلاح جدول KFZW یا بهبود اکتان سوخت.`,
        });
      }
    }

    // Boost Deviation check
    if (boost !== null && targetBoost !== null) {
      const diff = boost - targetBoost;
      if (Math.abs(diff) >= 0.22 && anomalies.filter((a) => a.type === 'boost_deviation').length < 3) {
        anomalies.push({
          type: 'boost_deviation',
          severity: diff > 0.3 ? 'critical' : 'warning',
          rpm,
          loadOrTps: load ?? tps,
          measuredValue: `${boost.toFixed(2)} bar`,
          referenceValue: `${targetBoost.toFixed(2)} bar`,
          descriptionFa:
            diff > 0
              ? `اوربوست (Overboost +${diff.toFixed(2)} bar) در دور ${rpm} RPM؛ کنترل سیکل کاری N75 / Wastegate بررسی شود.`
              : `افت بوست (Underboost ${diff.toFixed(2)} bar) در دور ${rpm} RPM؛ احتمال نشتی مسیر اینترکولر یا ضعف توربو.`,
        });
      }
    }

    // Rail Pressure Drop check
    if (rail !== null && targetRail !== null && targetRail > 0) {
      const dropRatio = (targetRail - rail) / targetRail;
      if (dropRatio >= 0.15 && anomalies.filter((a) => a.type === 'rail_pressure_drop').length < 3) {
        anomalies.push({
          type: 'rail_pressure_drop',
          severity: dropRatio >= 0.25 ? 'critical' : 'warning',
          rpm,
          loadOrTps: load ?? tps,
          measuredValue: `${rail.toFixed(1)} bar`,
          referenceValue: `${targetRail.toFixed(1)} bar`,
          descriptionFa: `افت فشار ریل سوخت (${Math.round(dropRatio * 100)}٪ کمتر از هدف) در دور ${rpm} RPM (احتمال ضعف پمپ پرفشار HPFP یا پمپ داخل باک).`,
        });
      }
    }

    // Dyno Torque & Power tracking + Physical Equation verification
    const resolvedKw =
      rawKw !== null ? rawKw : rawHp !== null ? Number((rawHp * 0.745699872).toFixed(2)) : null;
    const resolvedHp =
      rawHp !== null ? rawHp : rawKw !== null ? Number((rawKw * 1.34102209).toFixed(2)) : null;

    if (torqueNm !== null && (!peakTorque || torqueNm > peakTorque.torqueNm)) {
      peakTorque = { rpm, torqueNm, powerKw: resolvedKw };
    }
    if (resolvedKw !== null && resolvedHp !== null && (!peakPower || resolvedKw > peakPower.powerKw)) {
      peakPower = { rpm, powerKw: resolvedKw, powerHp: resolvedHp, torqueNm };
    }

    if (torqueNm !== null && (rawKw !== null || rawHp !== null) && rpm >= 1500) {
      const check = verifyDynoTorquePowerCoupling({
        rpm,
        torqueValue: torqueNm,
        torqueUnit: 'nm',
        powerValue: rawKw !== null ? rawKw : (rawHp as number),
        powerUnit: rawKw !== null ? 'kw' : 'hp',
        tolerancePercent: 3.5,
      });
      if (!check.valid && anomalies.filter((a) => a.type === 'dyno_decoupling').length < 3) {
        const measuredStr =
          rawKw !== null ? `${rawKw} kW` : `${rawHp} HP`;
        anomalies.push({
          type: 'dyno_decoupling',
          severity: 'warning',
          rpm,
          loadOrTps: load ?? tps,
          measuredValue: `${measuredStr} @ ${torqueNm} Nm`,
          referenceValue: `${check.expectedPowerKw} kW (${check.expectedPowerHp} HP)`,
          descriptionFa: `انحراف ${check.relativeErrorPercent}٪ بین گشتاور و توان داینو در دور ${rpm} RPM نسبت به معادله فیزیکی P = (T × RPM) / 9549.`,
        });
        physicalIssues.push({
          id: `phys-csv-dyno-${i}-${rpm}`,
          kind: 'dyno_power_torque_decoupling',
          severity: 'quarantine_warning',
          titleFa: 'عدم تطابق فیزیکی توان و گشتاور در جدول داینو',
          messageFa: `در ردیف دور ${rpm} RPM با گشتاور ${torqueNm} Nm، توان اندازه‌گیری‌شده (${measuredStr}) با فرمول فیزیکی داینو (${check.expectedPowerKw} kW / ${check.expectedPowerHp} HP) حدود ${check.relativeErrorPercent}٪ اختلاف دارد.`,
          detectedValue: `${measuredStr} @ ${rpm} RPM`,
          expectedReferenceFa: `${check.expectedPowerKw} kW (${check.expectedPowerHp} HP)`,
          quarantineToStaging: true,
        });
      }
    }
  }

  const wotAfrSummary =
    wotLambdas.length > 0
      ? {
          minLambda: Number(Math.min(...wotLambdas).toFixed(3)),
          maxLambda: Number(Math.max(...wotLambdas).toFixed(3)),
          avgLambda: Number(
            (wotLambdas.reduce((s, v) => s + v, 0) / wotLambdas.length).toFixed(3)
          ),
        }
      : null;

  const rpmRange =
    totalRowsParsed > 0 && Number.isFinite(minRpm) && Number.isFinite(maxRpm)
      ? { min: minRpm, max: maxRpm }
      : null;

  const mdLines: string[] = [
    `## خلاصه مهندسی دیتالاگ و تلمتری خودرو (${fileName})`,
    '',
    `- **تعداد کل نمونه‌های پردازش‌شده (لایه ۰ بدون مصرف توکن):** ${totalRowsParsed} ردیف`,
    `- **ستون‌های شناسایی‌شده:** ${rawHeaders.join('، ')}`,
  ];

  if (rpmRange) {
    mdLines.push(`- **بازه دور موتور (RPM Range):** ${rpmRange.min} تا ${rpmRange.max} RPM`);
  }

  mdLines.push(
    `- **تفکیک رژیم‌های کاری موتور:** دور آرام (Idle): ${regimeCounts.idle} نمونه · کروز (Cruise): ${regimeCounts.cruise} نمونه · بار کامل (WOT): ${regimeCounts.wot} نمونه · کات‌آف/Overrun: ${regimeCounts.overrun} نمونه`
  );

  if (wotAfrSummary) {
    mdLines.push(
      `- **پروفایل سوخت بار کامل (WOT Mixture — ${fuelContext.labelFa}):** میانگین Lambda=${wotAfrSummary.avgLambda} (AFR ${(wotAfrSummary.avgLambda * stoichRatio).toFixed(2)}) · کمینه=${wotAfrSummary.minLambda} · بیشینه=${wotAfrSummary.maxLambda}`
    );
  }

  if (peakTorque) {
    mdLines.push(
      `- **پیک گشتاور (Peak Torque):** ${peakTorque.torqueNm} Nm در ${peakTorque.rpm} RPM`
    );
  }
  if (peakPower) {
    mdLines.push(
      `- **پیک توان (Peak Power):** ${peakPower.powerKw} kW (${peakPower.powerHp} HP) در ${peakPower.rpm} RPM`
    );
  }
  if (peakKnock) {
    mdLines.push(
      `- **بیشینه ریتارد ناک (Peak Knock Retard):** -${peakKnock.deg.toFixed(1)} deg در ${peakKnock.rpm} RPM${peakKnock.load !== null ? ` (بار/دریچه: ${peakKnock.load}%)` : ''}`
    );
  }

  if (anomalies.length > 0) {
    mdLines.push(
      '',
      '### رخدادهای کلیدی و هشدارهای کالیبراسیون استخراج‌شده از لاگ',
      '',
      '| نوع رخداد | دور موتور (RPM) | بار / TPS | مقدار ثبت‌شده | مرجع استاندارد | تحلیل مهندسی |',
      '| --- | --- | --- | --- | --- | --- |'
    );
    for (const a of anomalies) {
      mdLines.push(
        `| ${a.type} | ${a.rpm} RPM | ${a.loadOrTps !== null ? `${a.loadOrTps}%` : '—'} | ${a.measuredValue} | ${a.referenceValue} | ${a.descriptionFa} |`
      );
    }
  } else {
    mdLines.push(
      '',
      '> **نتیجه ممیزی تلمتری:** هیچ انحراف بحرانی در AFR بار کامل، ریتارد ناک، فشار بوست یا معادله فیزیکی داینو در این لاگ مشاهده نشد.'
    );
  }

  const markdownBrief = mdLines.join('\n');
  const estimatedBriefTokens = Math.max(1, Math.ceil(markdownBrief.length / 2.2));
  const tokenSavingsPercent =
    estimatedRawTokens > estimatedBriefTokens
      ? Math.min(
          99,
          Math.max(
            0,
            Math.round(((estimatedRawTokens - estimatedBriefTokens) / estimatedRawTokens) * 100)
          )
        )
      : 0;

  return {
    isTelemetryDatalog: true,
    totalRowsParsed,
    detectedColumns: rawHeaders,
    rpmRange,
    regimeCounts,
    peakPowerPoint: peakPower,
    peakTorquePoint: peakTorque,
    peakKnockRetardDeg: peakKnock,
    wotAfrSummary,
    anomalies,
    physicalGuardReport: {
      passed: physicalIssues.length === 0,
      quarantineRecommended: physicalIssues.some((i) => i.quarantineToStaging),
      issues: physicalIssues,
    },
    estimatedRawTokens,
    estimatedBriefTokens,
    tokenSavingsPercent,
    markdownBrief,
  };
}
