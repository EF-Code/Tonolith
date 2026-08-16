import { readFile } from "node:fs/promises";
import { assemble, type AssemblyResult } from "./assembler.js";

export async function assembleFile(path: string): Promise<AssemblyResult> {
  return assemble(await readFile(path, "utf8"));
}
