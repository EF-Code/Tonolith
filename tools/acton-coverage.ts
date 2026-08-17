import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

type CoverageLine = {
    file: string;
    line: number;
    covered: boolean;
};

type CoverageBranch = {
    file: string;
    line: number;
    site: number;
    side: "a" | "b";
    covered: boolean;
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coverageMinimum = 89;

function findActonTests(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                return findActonTests(path);
            }
            return entry.name.endsWith(".test.tolk") ? [path] : [];
        })
        .sort();
}

function parseCoverageReport(path: string): {
    lines: CoverageLine[];
    branches: CoverageBranch[];
} {
    const lines: CoverageLine[] = [];
    const branches: CoverageBranch[] = [];
    let currentFile: string | null = null;

    for (const rawLine of readFileSync(path, "utf8").split("\n")) {
        if (rawLine.startsWith("File: ")) {
            currentFile = rawLine.slice("File: ".length).trim();
            continue;
        }
        if (
            currentFile === null ||
            (!rawLine.includes("hits:") && !rawLine.includes("branches:"))
        ) {
            continue;
        }

        const fields = rawLine.trim().split(/\s+/);
        const lineField = fields[0];
        if (fields.length < 2 || lineField === undefined || !/^\d+$/.test(lineField) || !rawLine.includes("|")) {
            continue;
        }

        const line = Number(lineField);
        lines.push({
            file: currentFile,
            line,
            covered: rawLine.slice(0, rawLine.indexOf("|")).includes("✓"),
        });

        const branchPattern =
            /(?:branches:)?site(\d+)\s+(?:true|throw)=(\d+)\s+(?:false|continue)=(\d+)/g;
        for (const match of rawLine.matchAll(branchPattern)) {
            const site = Number(match[1]);
            branches.push({
                file: currentFile,
                line,
                site,
                side: "a",
                covered: Number(match[2]) > 0,
            });
            branches.push({
                file: currentFile,
                line,
                site,
                side: "b",
                covered: Number(match[3]) > 0,
            });
        }
    }

    return { lines, branches };
}

function mergeLines(reports: string[]): Map<string, CoverageLine> {
    const merged = new Map<string, CoverageLine>();
    for (const report of reports) {
        for (const entry of parseCoverageReport(report).lines) {
            const key = `${entry.file}:${entry.line}`;
            const existing = merged.get(key);
            if (existing === undefined) {
                merged.set(key, entry);
            } else {
                existing.covered ||= entry.covered;
            }
        }
    }
    return merged;
}

function mergeBranches(reports: string[]): Map<string, CoverageBranch> {
    const merged = new Map<string, CoverageBranch>();
    for (const report of reports) {
        for (const entry of parseCoverageReport(report).branches) {
            const key = `${entry.file}:${entry.line}:${entry.site}:${entry.side}`;
            const existing = merged.get(key);
            if (existing === undefined) {
                merged.set(key, entry);
            } else {
                existing.covered ||= entry.covered;
            }
        }
    }
    return merged;
}

function percentage(covered: number, total: number): string {
    return total === 0 ? "n/a" : `${((covered / total) * 100).toFixed(2)}%`;
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "tonolith-acton-coverage-"));
try {
    const testFiles = findActonTests(join(projectRoot, "tests"));
    const reports: string[] = [];

    for (const [index, testFile] of testFiles.entries()) {
        const report = join(temporaryDirectory, `suite-${index}.txt`);
        const result = spawnSync(
            "acton",
            [
                "test",
                "--coverage",
                "--coverage-format",
                "text",
                "--coverage-file",
                report,
                "--coverage-minimum-percent",
                "0",
                "--fuzz-seed",
                "42",
                testFile,
            ],
            { cwd: projectRoot, stdio: "inherit" },
        );
        if (result.status !== 0) {
            process.exitCode = result.status ?? 1;
            throw new Error(`Acton coverage suite failed: ${testFile}`);
        }
        reports.push(report);
    }

    const lines = mergeLines(reports);
    const branches = mergeBranches(reports);
    const coveredLines = [...lines.values()].filter((entry) => entry.covered).length;
    const coveredBranches = [...branches.values()].filter((entry) => entry.covered).length;
    const linePercent = (coveredLines / lines.size) * 100;
    const branchPercent = (coveredBranches / branches.size) * 100;
    const blendedPercent = ((coveredLines + coveredBranches) / (lines.size + branches.size)) * 100;

    console.log("\nActon source-level union coverage");
    console.log(`  executable lines: ${coveredLines}/${lines.size} (${percentage(coveredLines, lines.size)})`);
    console.log(`  branch edges:     ${coveredBranches}/${branches.size} (${percentage(coveredBranches, branches.size)})`);
    console.log(`  blended score:    ${blendedPercent.toFixed(2)}%`);

    if (linePercent < 98 || blendedPercent < coverageMinimum) {
        throw new Error(
            `coverage gate failed: lines ${linePercent.toFixed(2)}%, blended ${blendedPercent.toFixed(2)}%`,
        );
    }
} finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
}
