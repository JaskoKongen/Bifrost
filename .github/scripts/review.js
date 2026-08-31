const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const API_KEY = process.env.GEMINI_API_KEY_REVIEW;
const PR_NUMBER = process.env.PR_NUMBER;
const REPO = process.env.GITHUB_REPOSITORY;
const CONTEXT_FILE_PATH = path.join(process.cwd(), "docs", "PROJECT_CONTEXT.md");

const GITHUB_API = "https://api.github.com";

// Model Pools
const FAST_MODEL = "gemini-3.5-flash-lite";
const HEAVY_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash"
];
const FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemma-4-31b-it",
  "gemma-4-26b-a4b-it"
];

async function githubFetch(endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `${GITHUB_API}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "Bifrost-AI-Reviewer",
      ...options.headers
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API request failed (${response.status} ${response.statusText}):${errorText}`);
  }

  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return await response.json();
  }
  return await response.text();
}

function extractAndCleanJson(rawText) {
  if (!rawText) return null;

  let cleaned = rawText
    .replace(/<\|channel\>thought[\s\S]*?<channel\|>/g, "")
    .replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, "$1")
    .replace(/`(\{[^`]*\})`/g, "$1")
    .trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // Ignore parse error
    }
  }
  return null;
}

async function requestGeminiModel(model, prompt, systemInstruction, expectJson = true) {
  const generationConfig = {
    temperature: 0.2
  };

  if (expectJson) {
    generationConfig.responseMimeType = "application/json";
  }

  if (model.startsWith("gemini-3")) {
    generationConfig.thinkingConfig = { thinkingLevel: "MEDIUM" };
  }

  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(API_KEY);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Model ${model} returned status ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!expectJson) {
    return rawText ? rawText.trim() : null;
  }

  return extractAndCleanJson(rawText);
}

function buildSystemInstruction(allowEscalation) {
  const escalationRule = allowEscalation
    ? `6. **Eskalering:** Hvis denne PR indeholder usædvanlig høj kompleksitet (f.eks. dybe arkitektoniske refactoringer på tværs af mange moduler, indviklede algoritmer eller subtile concurrency/race conditions), og du vurderer, at en tungere ræsonneringsmodel bør overtage analysen, SKAL du sætte "verdict": "ESCALATE". Vær ærlig og brug kun ESCALATE ved reel høj kompleksitet.`
    : `6. **Ingen eskalering:** Du SKAL levere en fuld anmeldelse med verdict "APPROVE", "REQUEST_CHANGES" eller "COMMENT". Du må IKKE eskalere.`;

  const verdictEnum = allowEscalation
    ? `"APPROVE" | "REQUEST_CHANGES" | "COMMENT" | "ESCALATE"`
    : `"APPROVE" | "REQUEST_CHANGES" | "COMMENT"`;

  return `
Du er en erfaren softwarearkitekt og tech lead, der anmelder et bachelorprojekt i softwareteknologi (Bifrost).

## Sprog & Tone
* Selve anmeldelsen og forklaringerne skrives på **dansk**, men alle tekniske begreber holdes på **engelsk** (f.eks. "Dependency Injection", "PR", "Controller", "Domain Model", "Repository", "DTO", "Race Condition").
* Benyt sandwich-modellen:
  1. Start med ros for gode løsninger (kun hvis der rent faktisk er noget at rose). HOLD DET HELT KORT (max to linjer!).
  2. Gennemgå konkrete fejl, mangler eller arkitekturbrud.
  3. Afslut med en opmuntrende og konstruktiv bemærkning (igen helt kort (ikke mere end en linje)).
* **INGEN STØJ:** Find ALDRIG på ligegyldige nitpicks. Hvis koden er god, så godkend den kortfattet.

## Fokusområder
1. **Engelsk i kodebasen:** Verificer at alle kodekommentarer, logbeskeder, fejltekster, variabel-/klassenavne og dokumentation i koden er skrevet 100% på **engelsk**.
2. **Logiske fejl & Bugs:** Off-by-one errors, manglende fejlhåndtering, race conditions, async/await-fejl, ubeskyttede nulls.
3. **Clean Architecture & Mappestruktur:** Tjek at afhængigheder peger indad. Ingen databasekald i controllers eller forretningslogik i forkerte lag.
4. **Tests (Non-blocking):** Gør venligt opmærksom på manglende tests ved ændret kerneforretningslogik.
5. **Opfølgning på historik:** Tjek om tidligere påpegede fejl er blevet udbedret.
${escalationRule}

## Output Format (JSON)
Du SKAL svare i dette JSON-skema:
{
  "pr_summary_description": "Kort struktureret beskrivelse af PR'ens formål og ændringer (på dansk)",
  "verdict": ${verdictEnum},
  "summary": "Den samlede anmeldelse med sandwich-modellen (Markdown)",
  "inline_comments": [
    {
      "path": "sti/til/fil.ts",
      "snippet": "den specifikke linje kode der har en fejl",
      "comment": "Konstruktiv forklaring og forslag til rettelse (Markdown)"
    }
  ]
}
`;
}

async function performReview(prompt) {
  // Phase 1: Fast triage with gemini-3.5-flash-lite
  console.log(`Evaluating PR with fast triage model (${FAST_MODEL})...`);
  try {
    const fastInstruction = buildSystemInstruction(true);
    const result = await requestGeminiModel(FAST_MODEL, prompt, fastInstruction, true);

    if (result && result.verdict === "ESCALATE") {
      console.log(`⚡ ${FAST_MODEL} requested escalation due to high PR complexity. Escalating to heavy reasoning models...`);
    } else if (result) {
      console.log(`✅ Review successfully completed by ${FAST_MODEL}`);
      return result;
    }
  } catch (err) {
    console.warn(`Fast triage with ${FAST_MODEL} failed (${err.message}). Proceeding to model queue...`);
  }

  // Phase 2: Try Heavy Models
  for (const model of HEAVY_MODELS) {
    try {
      console.log(`Attempting deep review with heavy model: ${model}...`);
      const heavyInstruction = buildSystemInstruction(false);
      const result = await requestGeminiModel(model, prompt, heavyInstruction, true);
      if (result) {
        console.log(`✅ Review successfully completed by heavy model: ${model}`);
        return result;
      }
    } catch (err) {
      console.warn(`Heavy model ${model} unavailable (${err.message}). Trying next...`);
    }
  }

  // Phase 3: Fallback queue with forced review (no escalation allowed)
  console.log("Heavy models unavailable. Falling back to standard model queue with forced review...");
  for (const model of FALLBACK_MODELS) {
    try {
      console.log(`Attempting fallback review with: ${model}...`);
      const fallbackInstruction = buildSystemInstruction(false);
      const result = await requestGeminiModel(model, prompt, fallbackInstruction, true);
      if (result) {
        console.log(`✅ Review successfully completed by fallback model: ${model}`);
        return result;
      }
    } catch (err) {
      console.warn(`Fallback model ${model} failed (${err.message}). Trying next...`);
    }
  }

  throw new Error("All review models in all tiers failed.");
}

function filterDiff(diffText) {
  return diffText
    .split(/(?=^diff --git )/m)
    .filter((chunk) => !chunk.includes("docs/PROJECT_CONTEXT.md"))
    .join("");
}

function parseDiffLines(diffText) {
  const fileLinesMap = new Map();
  const fileDiffs = diffText.split(/^diff --git /m);

  for (const fileDiff of fileDiffs) {
    if (!fileDiff.trim()) continue;
    const match = fileDiff.match(/^[a-b]\/(.+?)\s+[a-b]\/(.+)/m);
    if (!match) continue;
    const filePath = match[2].trim();

    const addedLines = [];
    let currentNewLine = 0;
    const lines = fileDiff.split("\n");

    for (const line of lines) {
      const hunkHeader = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (hunkHeader) {
        currentNewLine = parseInt(hunkHeader[1], 10);
        continue;
      }

      if (line.startsWith("+") && !line.startsWith("+++")) {
        addedLines.push({
          line: currentNewLine,
          content: line.substring(1).trim()
        });
        currentNewLine++;
      } else if (!line.startsWith("-")) {
        currentNewLine++;
      }
    }

    fileLinesMap.set(filePath, addedLines);
  }
  return fileLinesMap;
}

function matchSnippetToLine(fileLinesMap, filePath, snippet) {
  const addedLines = fileLinesMap.get(filePath);
  if (!addedLines || !snippet) return null;

  const normalizedSnippet = snippet.trim();
  const exactMatch = addedLines.find((item) => item.content === normalizedSnippet);
  if (exactMatch) return exactMatch.line;

  const partialMatch = addedLines.find(
    (item) => item.content.includes(normalizedSnippet) || normalizedSnippet.includes(item.content)
  );
  return partialMatch ? partialMatch.line : null;
}

async function updateContextFile(diff, prBranch) {
  let currentContext = "";
  if (fs.existsSync(CONTEXT_FILE_PATH)) {
    currentContext = fs.readFileSync(CONTEXT_FILE_PATH, "utf-8");
  }

  const systemInstruction = `
You are a software architecture documentation assistant for the Bifrost project.
Your task is to evaluate if this Pull Request introduces high-level architecture changes, new modules, domain models, APIs, external integrations, or structural patterns that belong in 'docs/PROJECT_CONTEXT.md'.

Rules:
1. If the PR ONLY contains bugfixes, refactoring, documentation, tests, minor UI tweaks, or code that fits within existing architecture, return EXACTLY: [NO_CHANGES]
2. ONLY if significant new architectural concepts, domain models, entities, database tables, or modules are introduced: Output the COMPLETE updated Markdown file.
3. Write 100% in English without markdown code blocks (\`\`\`markdown ... \`\`\`).
4. Maintain high-level architectural value. Do NOT log commit histories or small implementation details.
`;

  const prompt = `
Existing PROJECT_CONTEXT.md:
${currentContext}

PR Git Diff:
\`\`\`diff
${diff}
\`\`\`
`;

  try {
    console.log("Evaluating whether docs/PROJECT_CONTEXT.md requires updates...");
    let response = null;
    let usedModel = null;

    for (const model of [FAST_MODEL, ...FALLBACK_MODELS]) {
      try {
        response = await requestGeminiModel(model, prompt, systemInstruction, false);
        if (response) {
          usedModel = model;
          break;
        }
      } catch (err) {
        console.warn(`Context evaluation with ${model} failed (${err.message}). Trying next...`);
      }
    }

    if (!response) {
      console.warn("Could not evaluate PROJECT_CONTEXT.md updates with available models.");
      return;
    }

    if (response.includes("[NO_CHANGES]")) {
      console.log(`[${usedModel}] No architectural changes detected. Skipping PROJECT_CONTEXT.md update.`);
      return;
    }

    const cleanedContext = response
      .replace(/^```markdown\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    if (cleanedContext && cleanedContext !== currentContext.trim()) {
      execSync(`git fetch origin ${prBranch}`);
      execSync(`git checkout -B ${prBranch} FETCH_HEAD`);

      fs.mkdirSync(path.dirname(CONTEXT_FILE_PATH), { recursive: true });
      fs.writeFileSync(CONTEXT_FILE_PATH, cleanedContext + "\n", "utf-8");

      execSync("git config user.name 'github-actions[bot]'");
      execSync("git config user.email 'github-actions[bot]@users.noreply.github.com'");
      execSync("git add docs/PROJECT_CONTEXT.md");
      execSync("git commit -m 'docs: auto-update PROJECT_CONTEXT.md [skip review]'");
      execSync(`git push origin ${prBranch}`);
      console.log(`[${usedModel}] docs/PROJECT_CONTEXT.md updated and committed to ${prBranch}.`);
      return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    }
  } catch (err) {
    console.warn("Could not automatically update PROJECT_CONTEXT.md:", err.message);
  }
  return null;
}

async function run() {
  const pr = await githubFetch(`/repos/${REPO}/pulls/${PR_NUMBER}`);
  const diff = await githubFetch(`/repos/${REPO}/pulls/${PR_NUMBER}`, {
    headers: { "Accept": "application/vnd.github.v3.diff" }
  });

  const previousComments = await githubFetch(`/repos/${REPO}/pulls/${PR_NUMBER}/comments`);
  const historicalFeedback = Array.isArray(previousComments)
    ? previousComments.map((c) => `[File: ${c.path} Line: ${c.line}]: ${c.body}`).join("\n")
    : "";

  let projectContext = "";
  if (fs.existsSync(CONTEXT_FILE_PATH)) {
    projectContext = fs.readFileSync(CONTEXT_FILE_PATH, "utf-8");
  }

  const reviewDiff = filterDiff(diff);

  const prompt = `
PR Title: ${pr.title}
PR Author: ${pr.user.login}

Project Context:
${projectContext || "No additional project context provided."}

Historical Review Feedback:
${historicalFeedback || "No previous review comments."}

Git Diff:
\`\`\`diff
${reviewDiff}
\`\`\`
`;

  const aiResult = await performReview(prompt);

  if (!pr.body || pr.body.trim().length === 0) {
    if (aiResult.pr_summary_description) {
      await githubFetch(`/repos/${REPO}/pulls/${PR_NUMBER}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: `### 📋 PR Beskrivelse (Autogenereret)\n\n${aiResult.pr_summary_description}`
        })
      });
    }
  }

  const fileLinesMap = parseDiffLines(reviewDiff);
  const validComments = [];
  const unmatchedComments = [];

  if (Array.isArray(aiResult.inline_comments)) {
    for (const item of aiResult.inline_comments) {
      const line = matchSnippetToLine(fileLinesMap, item.path, item.snippet);
      if (line) {
        validComments.push({
          path: item.path,
          line: line,
          side: "RIGHT",
          body: item.comment
        });
      } else {
        unmatchedComments.push(`* **${item.path}:** ${item.comment}`);
      }
    }
  }

  let finalSummary = aiResult.summary || "Review completed.";
  if (unmatchedComments.length > 0) {
    finalSummary += `\n\n### 💬 Yderligere bemærkninger\n${unmatchedComments.join("\n")}`;
  }

  // Update documentation before submitting review to prevent stale approval dismissal
  const newCommitSha = await updateContextFile(diff, pr.head.ref);
  const targetCommitSha = newCommitSha || pr.head.sha;

  let reviewEvent = aiResult.verdict || "COMMENT";

  try {
    await githubFetch(`/repos/${REPO}/pulls/${PR_NUMBER}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commit_id: targetCommitSha,
        event: reviewEvent,
        body: finalSummary,
        comments: validComments
      })
    });
  } catch (err) {
    if (reviewEvent === "APPROVE" && err.message.includes("422")) {
      console.warn("GitHub Actions is restricted from submitting formal APPROVE. Falling back to COMMENT review event...");
      await githubFetch(`/repos/${REPO}/pulls/${PR_NUMBER}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commit_id: targetCommitSha,
          event: "COMMENT",
          body: `> **Status: ✅ Approved by AI Reviewer**\n\n${finalSummary}`,
          comments: validComments
        })
      });
    } else {
      throw err;
    }
  }

  console.log(`Review submitted with verdict: ${reviewEvent}`);
}

run().catch((err) => {
  console.error("Workflow failed:", err);
  process.exit(1);
});