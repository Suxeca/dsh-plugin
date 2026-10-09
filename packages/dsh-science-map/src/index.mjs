/**
 * @suxeca/dsh-science-map
 * 科研思维与计算流演化地图 DSH 插件与服务
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Service } from '@deepseek-ai/cordis';
import { validateScienceMap } from './validator.mjs';
import { compileScienceMapToHtml } from './compiler.mjs';

export const name = '@suxeca/dsh-science-map';

export class ScienceMapService extends Service {
  static inject = [];

  constructor(ctx) {
    super(ctx, 'scienceMap');
  }

  validate(spec, options = {}) {
    return validateScienceMap(spec, options);
  }

  compile(spec, options = {}) {
    return compileScienceMapToHtml(spec, options);
  }

  validateFile(filePath, options = {}) {
    const fullPath = resolve(filePath);
    const raw = readFileSync(fullPath, 'utf-8');
    const spec = JSON.parse(raw);
    return validateScienceMap(spec, options);
  }

  compileFile(inputPath, outputPath, options = {}) {
    const fullIn = resolve(inputPath);
    const raw = readFileSync(fullIn, 'utf-8');
    const spec = JSON.parse(raw);
    const validation = validateScienceMap(spec);
    if (!validation.ok && validation.summary?.errors > 0) {
      throw new Error('Science Map validation failed: ' + JSON.stringify(validation.diagnostics));
    }
    const html = compileScienceMapToHtml(spec, options);
    if (outputPath) {
      writeFileSync(resolve(outputPath), html, 'utf-8');
    }
    return html;
  }
}

export function apply(ctx) {
  ctx.plugin(ScienceMapService);
}

export default { name, apply };
