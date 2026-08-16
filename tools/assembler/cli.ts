import { writeFile } from "node:fs/promises";
import { assembleFile } from "./file.js";

const [sourcePath, outputPath] = process.argv.slice(2);
if (sourcePath === undefined || outputPath === undefined) {
  console.error("usage: npm run assemble:fibonacci -- <source.tasm> <output.json>");
  process.exitCode = 2;
} else {
  const result = await assembleFile(sourcePath);
  await writeFile(
    outputPath,
    `${JSON.stringify({
      schema: "tonolith-program-v1",
      isa: "tonolith-isa-v1",
      words: result.words.map((word) => word.toString(16).padStart(4, "0")),
      labels: result.labels,
      sourceMap: result.sourceMap,
    }, null, 2)}\n`,
    "utf8",
  );
}
