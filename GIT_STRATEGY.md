# Git- og Branch-strategi: Bifrost

Her beskrives vores Git-workflow. Målet er en stabil og gennemskuelig struktur, optimal udnyttelse af AI Pull Request (PR) reviews og en ren historik uden merge-støj.

## 1. Kom godt i gang (Setup)
Når du har clonet repositoriet, køres følgende kommando **én gang** i terminalen for at aktivere projektets delte aliases, rebase-indstillinger og Jira-hooks:

```bash
git config --local include.path ../.gitconfig
chmod +x .githooks/prepare-commit-msg
```

*(Bemærk: `--local` isolerer ændringerne udelukkende til dette repository og rører ikke dine globale Git-indstillinger).*

## 2. Branch-struktur

* **main (Produktion):** Kun stabile releases. Ingen direkte commits.
* **dev (Integration):** Vores primære default branch, hvor alt arbejde integreres.
* **feature/* (Nye funktioner):** Branches oprettet ud fra `dev` til ny funktionalitet (f.eks. `feature/BF-012-jwt-auth`).
* **fix/* (Fejlrettelser):** Branches oprettet ud fra `dev` til bugfixes (f.eks. `fix/BF-045-null-user-token`).

## 3. Commit-konventioner & Automatisk Jira-linking

Vi benytter **Conventional Commits** for at gøre historikken letlæselig for både mennesker og AI-revieweren (CodeRabbit), som bruger præfikserne til lynhurtigt at afkode hensigten med ændringerne:

* `feat:` Ny funktionalitet til brugeren/systemet.
* `fix:` Fejlrettelse i eksisterende kode.
* `refactor:` Kodeændringer, der hverken retter bugs eller tilføjer features (oprydning/arkitektur).
* `test:` Tilføjelse eller rettelse af tests.
* `docs:` Ændringer i dokumentation eller README.
* `chore:` Vedligeholdelse af build-scripts, dependencies eller config-filer.

### Automatisk Jira-præfiks

Hvis dit branch-navn indeholder en Jira-nummeret (f.eks. `BF-012`), sørger vores lokale Git-hook automatisk for at tilføje `[BF-012]` foran din commit-besked, hvilket giver et godt overblik over hvilke Jira-sager, der er relateret til hvilke commits.

* **Du skriver:** `git commit -m "feat: add token validation middleware"`
* **Git gemmer:** `[BF-012] feat: add token validation middleware`

## 4. Dagligt Workflow

Når der sker ændringer på `dev` undervejs, rebaser vi lokalt i stedet for at merge:

```bash
git sync  # Henter dev og rebaser din branch (alias for: git fetch origin && git rebase origin/dev)
git pf    # Pusher sikkert efter rebase (alias for: git push --force-with-lease)
```

## 5. Integration via Pull Request
1. Opret PR med base `dev`.
2. Start AI-reviewet ved at skrive en kommentar på PR'en:
```text
   /review
```
3. Scriptet analyserer koden med ræsonnering (thinking mode), opdaterer PR-beskrivelsen hvis den er tom, indsætter inline-kommentarer ved fund og indsender et formelt GitHub Review (`APPROVE` eller `REQUEST_CHANGES`).
4. Ret eventuelle fund og genkør `/review` ved behov.
5. Foretag et standard **Merge Commit** på GitHub.