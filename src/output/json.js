import { writeFile } from 'fs/promises';

export function generateJSON(reportData) {
  const cleaned = {
    ...reportData,
    files: reportData.files.map(f => {
      const { content, ...rest } = f;
      return rest;
    })
  };

  return JSON.stringify(cleaned, null, 2);
}

export async function writeJSON(reportData, outputPath) {
  const json = generateJSON(reportData);
  await writeFile(outputPath, json, 'utf-8');
  return outputPath;
}
