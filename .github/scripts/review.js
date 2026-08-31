const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const API_KEY = process.env.GEMINI_API_KEY_REVIEW;
const PR_NUMBER = process.env.PR_NUMBER;
const REPO = process.env.GITHUB_REPOSITORY;
const CONTEXT_FILE_PATH = path.join(process.cwd(), "docs", "PROJECT_CONTEXT.md");

const GITHUB_API = "https://api.github.com";

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

// Verified models ordered by quota and stability
const MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemma-4-31b-it",
  "gemma-4-26b-a4b-it",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash"
];

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

async function callGemini(prompt, systemInstruction, expectJson = true) {
  for (const model of MODELS) {
    try {
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

      if (response.status === 429 || response.status === 503) {
        console.warn(`Model ${model} hit rate limit (${response.status}). Trying fallback...`);
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`Model ${model} returned error ${response.status}: ${errorText}. Trying fallback...`);
        continue;
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!expectJson) {
        return rawText ? rawText.trim() : null;
      }

      const parsed = extractAndCleanJson(rawText);
      if (parsed) {
        return parsed;
      }

      console.warn(`Model ${model} returned invalid JSON payload. Trying fallback...`);
    } catch (err) {
      console.warn(`Error during API call to ${model}:`, err.message);
    }
  }
  throw new Error("All model fallbacks were exhausted or failed.");
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
    console.log("Evaluating whether PROJECT_CONTEXT.md requires updates...");
    const response = await callGemini(prompt, systemInstruction, false);
    if (!response) return;

    if (response.includes("[NO_CHANGES]")) {
      console.log("No architectural changes detected. Skipping PROJECT_CONTEXT.md update.");
      return;
    }

    const cleanedContext = response
      .replace(/^```markdown\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    if (cleanedContext && cleanedContext !== currentContext.trim()) {
      fs.mkdirSync(path.dirname(CONTEXT_FILE_PATH), { recursive: true });
      fs.writeFileSync(CONTEXT_FILE_PATH, cleanedContext + "\n", "utf-8");

      execSync("git config user.name 'github-actions[bot]'");
      execSync("git config user.email 'github-actions[bot]@users.noreply.github.com'");
      execSync(`git checkout ${prBranch}`);
      execSync("git add docs/PROJECT_CONTEXT.md");
      execSync("git commit -m 'docs: auto-update PROJECT_CONTEXT.md [skip review]'");
      execSync(`git push origin ${prBranch}`);
      console.log("PROJECT_CONTEXT.md updated and committed to PR branch.");
    }
  } catch (err) {
    console.warn("Could not automatically update PROJECT_CONTEXT.md:", err.message);
  }
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

  const systemInstruction = `
Du er en erfaren softwarearkitekt og tech lead, der anmelder et bachelorprojekt i softwareteknologi (Bifrost).

## Sprog & Tone
* Selve anmeldelsen og forklaringerne skrives på **dansk**, men alle tekniske begreber holdes på **engelsk** (f.eks. "Dependency Injection", "PR", "Controller", "Domain Model", "Repository", "DTO", "Race Condition").
* Benyt sandwich-modellen:
  1. Start med reel ros for gode løsninger (kun hvis der rent faktisk er noget at rose).
  2. Gennemgå konkrete fejl, mangler eller arkitekturbrud.
  3. Afslut med en opmuntrende og konstruktiv bemærkning.
* **INGEN STØJ:** Find ALDRIG på ligegyldige nitpicks. Hvis koden er god, så godkend den kortfattet.

## Fokusområder
1. **Engelsk i kodebasen:** Verificer at alle kodekommentarer, logbeskeder, fejltekster, variabel-/klassenavne og dokumentation i koden er skrevet 100% på **engelsk**. Gør opmærksom på eventuelle danske kommentarer eller fejltekster i koden.
2. **Logiske fejl & Bugs:** Off-by-one errors, manglende fejlhåndtering, race conditions, async/await-fejl, ubeskyttede nulls.
3. **Clean Architecture & Mappestruktur:** Tjek at afhængigheder peger indad. Ingen databasekald i controllers eller forretningslogik i forkerte lag.
4. **Tests (Non-blocking):** Gør venligt opmærksom på manglende tests ved ændret kerneforretningslogik (ignorer DTO'er, configs, ren boilerplate).
5. **Opfølgning på historik:** Hvis der tidligere er påpeget fejl, tjek om de er rettet i den nye diff og anerkend udbedringen.

## Output Format (JSON)
Du SKAL svare i dette JSON-skema:
{
  "pr_summary_description": "Kort struktureret beskrivelse af PR'ens formål og ændringer (på dansk)",
  "verdict": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
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

  const prompt = `
PR Title: ${pr.title}
PR Author: ${pr.user.login}

Project Context:
${projectContext || "No additional project context provided."}

Historical Review Feedback:
${historicalFeedback || "No previous review comments."}

Git Diff:
\`\`\`diff
${diff}
\`\`\`
`;

  console.log("Analyzing PR with AI reviewer...");
  const aiResult = await callGemini(prompt, systemInstruction, true);

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

  const fileLinesMap = parseDiffLines(diff);
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

  let reviewEvent = aiResult.verdict || "COMMENT";

  try {
    await githubFetch(`/repos/${REPO}/pulls/${PR_NUMBER}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commit_id: pr.head.sha,
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
          commit_id: pr.head.sha,
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

  // Auto-update PROJECT_CONTEXT.md directly on the PR branch
  await updateContextFile(diff, pr.head.ref);
}

run().catch((err) => {
  console.error("Workflow failed:", err);
  process.exit(1);
});