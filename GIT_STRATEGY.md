# Git- og Branch-strategi: Bifrost

Her beskrives vores Git-workflow. Formålet er at sikre et stabilt udviklingsmiljø, en overskuelig commit-historik uden lokal merge-spaghetti og optimal udnyttelse af vores automatiserede AI Pull Request (PR) review.

---

## 1. Kom godt i gang (Setup)
Når du har clonet repositoriet, køres følgende kommandoer **én gang** for at aktivere projektets delte aliases, rebase-indstillinger og Jira-hooks:

```bash
git config --local include.path ../.gitconfig
git config --local core.hooksPath .githooks
chmod +x .githooks/prepare-commit-msg 2>/dev/null || true
```

*(Bemærk: `--local` isolerer indstillingerne til dette repository. På Windows i Git Bash/PowerShell er `chmod` automatisk håndteret).*

---

## 2. Branch-struktur

* **`main` (Produktion):** Kun stabile releases. Ingen direkte commits.
* **`dev` (Integration):** Vores primære default branch, hvor alt arbejde integreres via PRs.
* **`feature/*` (Nye funktioner):** Oprettes ud fra `dev` (f.eks. `feature/BF-012-jwt-auth`).
* **`fix/*` (Fejlrettelser):** Oprettes ud fra `dev` til bugfixes (f.eks. `fix/BF-045-null-token`).

---

## 3. Commit-konventioner & Automatisk Jira-linking

Vi benytter **Conventional Commits** for at gøre historikken letlæselig for både teamet og vores AI-reviewer, som bruger præfikserne til at afkode hensigten med ændringerne:

* `feat:` Ny funktionalitet til brugeren/systemet.
* `fix:` Fejlrettelse i eksisterende kode.
* `refactor:` Kodeændringer, der hverken retter bugs eller tilføjer features (oprydning/arkitektur).
* `test:` Tilføjelse eller rettelse af tests.
* `docs:` Ændringer i dokumentation eller README.
* `chore:` Vedligeholdelse af build-scripts, dependencies eller config-filer.

Bruges GitHub Copilot til at oprette commit-beskeder plejer den selv at foreslå Conventional Commit-præfik

### Automatisk Jira-præfiks
Hvis dit branch-navn indeholder et Jira-nummer (f.eks. `feature/BF-012-tilføj-auth`), tilføjer vores Git-hook automatisk sagsnummeret foran din commit-besked:

* **Du skriver:** `git commit -m "feat: add token validation middleware"`
* **Git gemmer:** `[BF-012] feat: add token validation middleware`

Det gør det nemt at spore commits tilbage til Jira-issues.

---

## 4. Dagligt Workflow (Undgå lokal merge-spaghetti)

For at undgå unødvendige lokale "Merge branch 'dev' into feature/..." commits, **rebaser vi altid lokalt** frem for at merge:

```bash
git sync  # Henter dev og rebaser din branch (alias for: git fetch origin && git rebase origin/dev)
git pf    # Pusher sikkert efter rebase (alias for: git push --force-with-lease)
```

---


## 5. Arbejde på afhængige features (Stacked Branches)

Hvis du har en branch (`feature/A`), der venter på PR-review, og du skal bruge koden derfra i `feature/B`:

### Scenarie 1: feature/B er helt ny
Hvis du starter på en frisk feature, der bygger ovenpå A:
```bash
git checkout feature/A
git checkout -b feature/B
# Arbejd og commit som normalt
```

### Scenarie 2: feature/B eksisterer allerede
Hvis du allerede var i gang med B og pludselig mangler koden fra A:
```bash
git checkout feature/B
git rebase feature/A      # Flytter B, så den nu ligger oven på A
git pf                    # Pusher opdateringen til dit remote repository
```

---

### Fælles: Når feature/A er godkendt og merged ind i `dev`
Når PR'en for A er blevet merget ind i `dev`, skal B blot synkroniseres:

```bash
git checkout feature/B
git sync  # Henter nyeste dev og flytter dine feature/B-commits direkte over på dev
git pf    # Pusher opdateringen til GitHub
```
*(Git registrerer automatisk, at commits fra A nu ligger på `dev`, og efterlader udelukkende dine nye B-commits oven på `dev`).*

---

## 6. Integration via Pull Request

1. Opret en PR på GitHub med base `dev`.
2. Start AI-reviewet ved at skrive en kommentar på PR'en:
   ```text
   /review
   ```
3. Scriptet analyserer koden, opdaterer PR-beskrivelsen, foretager eventuelle automatiske opdateringer i `docs/PROJECT_CONTEXT.md` og indsender sit review (`APPROVE` eller `REQUEST_CHANGES`).
4. Ret eventuelle fund og genkør `/review` ved behov.
5. Når PR'en er godkendt og alle CI checks er grønne, foretages et standard **Merge Commit** ind i `dev`.

Jo, absolut! Det er et meget almindeligt scenarie: `feature/B` eksisterede allerede, men har pludselig brug for noget kode fra `feature/A`, som stadig ligger i en PR.

Her er forklaringen på, hvad der sker, samt hvordan afsnit 5 i jeres strategidokument skal se ud med begge scenarier.

---

### Hvad `git rebase feature/A` gør i dette tilfælde

Hvis både `feature/A` og `feature/B` oprindeligt startede ud fra `dev`:
```text
dev:             ───●───●
                     \   \
feature/A (PR):       \   ●───● (ny kode du mangler)
                       \
feature/B (i gang):     ●───● (din eksisterende branch)
```

Når du står på `feature/B` og kører `git rebase feature/A`, flytter Git hele din `feature/B` over, så den nu **hviler oven på `feature/A`**:

```text
dev:             ───●───●
                         \
feature/A (PR):           ●───● 
                               \
feature/B (rebased):            ●'───●' (har nu koden fra A)
```

Når `feature/A` senere merges ind i `dev`, kører du bare `git sync` som normalt på `feature/B`. Git finder selv ud af, at A's commits nu er en del af `dev`, og rydder automatisk op.

---
