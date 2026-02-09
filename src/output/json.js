import { writeFile } from 'fs/promises';

export function generateJSON(reportData) {
  // strip file contents from the output - they're huge and not useful in the report
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
