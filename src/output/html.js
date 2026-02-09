import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEMPLATE_DIR = join(__dirname, 'template');

async function readTemplate(filename) {
  return readFile(join(TEMPLATE_DIR, filename), 'utf-8');
}

export async function generateHTML(reportData) {
  const [template, styles, script] = await Promise.all([
    readTemplate('index.html'),
    readTemplate('styles.css'),
    readTemplate('app.js'),
  ]);

  // Strip file contents from the data payload - they're large and not needed in the browser
  const cleaned = {
    ...reportData,
    files: reportData.files.map(function (f) {
      const { content, fullPath, ...rest } = f;
      return rest;
    })
  };

  const dataScript = 'window.__DEEP_SVELTEKIT__ = ' + JSON.stringify(cleaned) + ';';

  const projectName = (reportData.meta && reportData.meta.name) || 'project';
  const version = (reportData.meta && reportData.meta.version) || '0.1.0';

  let html = template;
  html = html.replace('{{STYLES}}', styles);
  html = html.replace('{{SCRIPT}}', script);
  html = html.replace('{{DATA}}', dataScript);
  html = html.replaceAll('{{PROJECT_NAME}}', projectName);
  html = html.replaceAll('{{VERSION}}', version);

  return html;
}

export async function writeHTML(reportData, outputPath) {
  const html = await generateHTML(reportData);
  await writeFile(outputPath, html, 'utf-8');
  return outputPath;
}
